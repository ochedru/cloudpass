'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const moment = require('moment');
const BluebirdPromise = require('sequelize').Promise;
const jwt = BluebirdPromise.promisifyAll(require('jsonwebtoken'));
const _ = require('lodash');
const passport = require('passport');
const Optional = require('optional-js');
const url = require('url');
const config = require('config');
const UrlMatch = require('@fczbkk/url-match').default;
const models = require('../models');
const scopeHelper = require('../helpers/scopeHelper');
const idSiteHelper = require('./helpers/idSiteHelper');
const ssaclAuthenticate = require('./helpers/ssaclAuthenticate');
const sendJwtResponse = require('./helpers/sendJwtResponse');
const errorHandler = require('./helpers/errorHandler');
const ApiError = require('../ApiError');
const JwtStrategy = require('./authentication/JwtStrategy');
const hrefHelper = require('../helpers/hrefHelper');


function ssoStrategy(queryParameter, apiKeyIdPath) {
    return new JwtStrategy(
        _.property('query.' + queryParameter),
        _.property(apiKeyIdPath),
        {
            model: models.tenant,
            include: [{
                model: models.idSite,
                limit: 1
            }]
        }
    );
}

passport.use('sso-jwt-request', ssoStrategy('jwtRequest', 'payload.iss'));
passport.use('sso-jwt-response', ssoStrategy('jwtResponse', 'header.kid'));

const app = express();
app.use(cookieParser());
app.use(passport.initialize());
app.use('/', ssaclAuthenticate('sso-jwt-request', 'sso-jwt-response'));
app.use('/logout', ssaclAuthenticate('sso-jwt-request'));

const cookiePath = url.parse(Optional.ofNullable(config.get('server.rootUrl')).orElse('') + '/sso').pathname;

function handleRequest(req, res) {
    if (req.query.jwtRequest) {
        // the user was redirected from the application to here, and we must redirect it back to the ID site

        //check that the requested redirect URI is authorized
        if (new UrlMatch(req.user.tenant.idSites[0].authorizedRedirectURIs).test(req.authInfo.cb_uri)) {
            const application = hrefHelper.resolveHref(req.authInfo.sub);
            //get the account store in where to login
            //and the invited email (if exists)
            BluebirdPromise.join(
                application.getLookupAccountStore(req.authInfo.onk),
                Optional.ofNullable(req.authInfo.inv_href).map(href => hrefHelper.resolveHref(href).reload().then(_.property('email'))).orElse(null)
            ).spread(function (accountStore, invitationEmail) {
                const cookie = req.cookies[req.user.tenantId];
                if (cookie) {
                    //the user already authenticated for this tenant
                    //check if his account belongs to the requested account store
                    return jwt.verifyAsync(cookie, req.app.get('secret'), {algorithms: ["HS256"]})
                        .then(cookieJwt => BluebirdPromise.join(
                            cookieJwt.mfa,
                            accountStore.getAccounts({where: {id: cookieJwt.sub}, limit: 1}).get(0),
                            cookieJwt.org_href
                            )
                        )
                        .spread((verifiedMfa, account, orgHref) => {
                            ApiError.assert(account, Error, 'account not found in account store');
                            ApiError.assert(!invitationEmail || _.eq(invitationEmail.toLowerCase(), account.email), Error, 'user not logged with the invited email');
                            return _.cond([
                                [
                                    //if the user didn't authenticate with one of the requested factor, redirect to ID site with factors scope
                                    authInfo => !_.isEmpty(authInfo.require_mfa) && !_.includes(authInfo.require_mfa, verifiedMfa),
                                    authInfo => redirectToIdSite(
                                        res,
                                        req.user,
                                        application,
                                        accountStore,
                                        authInfo,
                                        invitationEmail,
                                        {
                                            scope: idSiteHelper.getFactorsScope(account.id),
                                            org_href: orgHref
                                        }
                                    )
                                ],
                                [
                                    //if the settings page is requested, redirect to ID site with the right scope
                                    _.matchesProperty('path', '/#/settings'),
                                    authInfo => redirectToIdSite(
                                        res,
                                        req.user,
                                        application,
                                        accountStore,
                                        authInfo,
                                        invitationEmail,
                                        {
                                            scope: idSiteHelper.getSecuritySettingsScope(account.id),
                                            authenticated: true,
                                            require_mfa: ['google-authenticator'],
                                            org_href: orgHref
                                        }
                                    )
                                ],
                                [
                                    //else redirect to the application directly
                                    _.stubTrue,
                                    () => idSiteHelper.getJwtResponse(
                                        req.user,
                                        account.href,
                                        {
                                            isNewSub: false,
                                            status: "AUTHENTICATED",
                                            cb_uri: req.authInfo.cb_uri,
                                            irt: req.authInfo.jti,
                                            state: req.authInfo.state,
                                            inv_href: req.authInfo.inv_href,
                                            org_href: orgHref
                                        }
                                    )
                                        .then(sendJwtResponse(res, req.authInfo.cb_uri))
                                ]
                            ])(req.authInfo);
                        })
                        // Either jwt expired or the account does not belong to the account store
                        //  => re-authentication required
                        .catch(() => redirectToIdSite(res, req.user, application, accountStore, req.authInfo, invitationEmail));
                }
                return redirectToIdSite(res, req.user, application, accountStore, req.authInfo, invitationEmail);
            })
                .catch(req.next);
        } else {
            //callaback URL not authorized (don't throw because errorHandler would redirect to the unauthorized URL)
            res.status(400).send("Unauthorized Callback URI: " + req.authInfo.cb_uri);
        }

    } else if (req.query.jwtResponse) {
        //the user was redirected from the ID site to here, and we must redirect it back to the application
        //make a jwt cookie from the account ID
        jwt.signAsync(
            {
                mfa: req.authInfo.mfa,
                org_href: req.authInfo.org_href
            },
            req.app.get('secret'),
            {
                subject: hrefHelper.resolveHref(req.authInfo.sub).id,
                expiresIn: moment.duration(req.user.tenant.idSites[0].sessionTtl).asSeconds()
            }
        )
            .then(function (cookieToken) {
                const cookieOptions = {
                    httpOnly: true,
                    path: cookiePath
                };
                if (req.user.tenant.idSites[0].sessionCookiePersistent) {
                    cookieOptions.maxAge = moment.duration(req.user.tenant.idSites[0].sessionTtl).asMilliseconds();
                }
                res.cookie(req.user.tenant.id, cookieToken, cookieOptions);
                sendJwtResponse(res, req.authInfo.cb_uri)(req.query.jwtResponse);
            })
            .catch(req.next);
    } else {
        req.next();
    }
}

app.get('/', handleRequest);
app.post('/', handleRequest);

app.get('/logout', function (req, res) {
    //clear cookie and redirect to ID Site with a restricted scope
    res.clearCookie(req.user.tenant.id, {path: cookiePath});
    req.authInfo.path = '/#/logoutSuccess';
    redirectToIdSite(
        res,
        req.user,
        null, null,
        req.authInfo,
        null,
        {
            scope: {
                applications: {
                    [hrefHelper.resolveHref(req.authInfo.sub).id]: [
                        'get',
                        {customData: ['get']},
                        {idSiteModel: ['get']}
                    ]
                }
            }
        }
    );
});

app.use(errorHandler);

function redirectToIdSite(res, apiKey, application, accountStore, jwtPayload, invitationEmail, content) {
    const baseUrl = hrefHelper.getBaseUrl(jwtPayload.sub);
    return jwt.signAsync(
        _.merge(
            {
                init_jti: jwtPayload.jti,
                scope: scopeHelper.getIdSiteScope(application, accountStore),
                app_href: jwtPayload.sub,
                cb_uri: jwtPayload.cb_uri,
                state: jwtPayload.state,
                asnk: jwtPayload.onk, //account store name key
                sof: jwtPayload.sof, //show organization field
                ros: jwtPayload.ros, //require organization selection
                require_mfa: jwtPayload.require_mfa,
                //qualify the account store & invitation hrefs
                ash: Optional.ofNullable(accountStore).map(_.property('href')).map(hrefHelper.unqualifyHref).map(_.bindKey(baseUrl, 'concat')).orElse(null),
                inv_href: jwtPayload.inv_href,
                email: invitationEmail,
                //only to not make stormpath.js crash
                sp_token: 'null'
            },
            content
        ),
        apiKey.secret,
        {
            expiresIn: 60,
            subject: jwtPayload.iss,
            audience: 'idSite'
        }
    ).then(token => res.status(302).location(apiKey.tenant.idSites[0].url + _.defaultTo(jwtPayload.path, '/#/') + '?jwt=' + token).send());
}

module.exports = app;