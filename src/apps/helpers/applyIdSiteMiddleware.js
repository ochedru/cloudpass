'use strict';

const _ = require('lodash');
const BluebirdPromise = require('sequelize').Promise;
const signJwt = BluebirdPromise.promisify(require('jsonwebtoken').sign);
const shimmer = require('shimmer');
const Optional = require('optional-js');
const getApiKey = require('./getApiKey');
const idSiteHelper = require('./idSiteHelper');
const models = require('../../models');
const hrefHelper = require('../../helpers/hrefHelper');
const scopeHelper = require('../../helpers/scopeHelper');

function applyToIdSiteRequests(middleware) {
    return function (req, res) {
        if (_.get(req, 'authInfo.aud') === 'idSite') {
            return middleware(req, res);
        } else {
            req.next();
        }
    };
}

function setAuthorizationBearer(req, res) {
    return signJwt(
        _.omit(req.authInfo, ['jti', 'iat', 'exp']),
        req.user.secret,
        {expiresIn: '1h'}
    )
        .then(function (token) {
            res.set('Authorization', 'Bearer ' + token)
                .set('Access-Control-Expose-Headers', ['Authorization']);
        });
}

//send an updated Authorization header
const updateBearer = applyToIdSiteRequests(function (req, res) {
    return setAuthorizationBearer(req, res)
        .then(req.next)
        .catch(req.next);
});

//set a special header instead of redirecting directly
//because ID sites use ajax calls to request cloudpass
const handleRedirects = applyToIdSiteRequests(function (req, res) {
    shimmer.wrap(res, 'redirect', _.constant(
        function (redirectUrl) {
            this.set('Access-Control-Expose-Headers', ['Stormpath-SSO-Redirect-Location'])
                .set('Stormpath-SSO-Redirect-Location', redirectUrl)
                .send();
        }
    ));
    req.next();
});

const afterAuthentication = function (accountHrefGetter, isNewSub, factorTypeGetter, orgHrefGetter) {
    return applyToIdSiteRequests(function (req, res) {
        shimmer.wrap(res, 'json', function (original) {
            return function (result) {
                //check if an account has been returned
                let accountHref = accountHrefGetter(result, req);
                if (accountHref) {
                    const accountId = /\/accounts\/(.*)$/.exec(accountHref)[1];
                    //request a 2nd factor if the user is not already authenticated
                    // and the user already configured any or the application requested it
                    BluebirdPromise.resolve(
                        Optional.ofNullable(req.authInfo.authenticated ? [] : req.authInfo.require_mfa)
                            .orElseGet(() =>
                                models.factor.findAll({
                                    where: {
                                        accountId,
                                        status: 'ENABLED',
                                        verificationStatus: 'VERIFIED'
                                    }
                                })
                                    .map(_.property('type'))
                                    .then(_.uniq)
                            )
                    )
                        .then(requireMfa => {
                            const secondFactor = Optional.ofNullable(factorTypeGetter)
                                .map(_.method('call', null, result))
                                .orElse(req.authInfo.verified_mfa);
                            //ask for a second factor if requested
                            if (!_.isEmpty(requireMfa) && !_.includes(requireMfa, secondFactor)) {
                                req.authInfo.require_mfa = requireMfa;
                                //add 2nd factors into the request scope
                                req.authInfo.scope = scopeHelper.pathsToScope(_.merge(
                                    scopeHelper.scopeToPaths(req.authInfo.scope),
                                    idSiteHelper.getFactorsScope(accountId)
                                ));
                                req.authInfo.isNewSub = isNewSub;
                                return setAuthorizationBearer(req, this)
                                    .then(() => original.call(this, result));
                            } else {
                                //the user is authenticated
                                // check if organization selection was requested
                                return BluebirdPromise.resolve(
                                    Optional.ofNullable(orgHrefGetter)
                                        .map(_.method('call', null, result))
                                        .orElseGet(() =>
                                            //look for orgId in authInfo (account settings or missing 2nd factor)
                                            Optional.ofNullable(req.authInfo.org_href)
                                                .orElseGet(() => {
                                                    //ros => request organization selection
                                                    if (req.authInfo.ros) {
                                                        return models.account.build({id: accountId}).countOrganizations()
                                                            .then(_.cond([
                                                                //no org => no need for selection
                                                                [_.partial(_.eq, 0), _.constant(null)],
                                                                //only one org => just take this one
                                                                [_.partial(_.eq, 1), () => models.account.build({id: accountId}).getOrganizations({
                                                                    limit: 1,
                                                                    attributes: ['id']
                                                                }).get(0).get('href')],
                                                                //more than one: selection needed
                                                                [_.stubTrue, _.stubFalse]
                                                            ]));
                                                    } else {
                                                        //no org requested
                                                        return null;
                                                    }
                                                })
                                        ))
                                    .then(orgHref => {
                                        if (orgHref === false) {
                                            //organization requested but not chosen yet
                                            //add available organizations to the scope
                                            req.authInfo.scope = idSiteHelper.getAccountOrganizationsScope(accountId);
                                            req.authInfo.verified_mfa = secondFactor;
                                            req.authInfo.isNewSub = isNewSub;
                                            return setAuthorizationBearer(req, this).then(() => original.call(this, result));
                                        } else {
                                            return getApiKey(
                                                req.authInfo.sub, {
                                                    model: models.tenant,
                                                    include: [{
                                                        model: models.idSite,
                                                        limit: 1
                                                    }]
                                                }
                                            )
                                                .then(function (apiKey) {
                                                    return idSiteHelper.getJwtResponse(
                                                        apiKey,
                                                        accountHref,
                                                        {
                                                            isNewSub: isNewSub || req.authInfo.isNewSub || false,
                                                            status: "AUTHENTICATED",
                                                            cb_uri: req.authInfo.cb_uri,
                                                            irt: req.authInfo.init_jti,
                                                            state: req.authInfo.state,
                                                            mfa: secondFactor,
                                                            inv_href: req.authInfo.inv_href,
                                                            email: req.authInfo.email,
                                                            org_href: orgHref
                                                        }
                                                    );
                                                })
                                                //don't redirect directly to the app, redirect first to cloudpass so it can set a cookie
                                                .then(jwtResponse => this.redirect(hrefHelper.getRootUrl(req.authInfo.app_href) + "/sso?jwtResponse=" + jwtResponse));
                                        }
                                    });
                            }
                        })
                        .catch(req.next);
                } else {
                    return original.call(this, result);
                }
            };
        });
        req.next();
    });
};

const suppressOutput = applyToIdSiteRequests(function (req, res) {
    shimmer.wrap(res, 'json', original => function () {
        return original.call(this, {});
    });
    req.next();
});

//remove the current path from the scope if the request was successful
const alterScope = function (newPathsGetter) {
    return applyToIdSiteRequests(function (req, res) {
        shimmer.wrap(res, 'json', function (original) {
            return function (result) {
                BluebirdPromise.try(() => {
                    if (_.inRange(this.statusCode, 200, 400)) {
                        req.authInfo.scope = scopeHelper.pathsToScope(newPathsGetter(scopeHelper.scopeToPaths(req.authInfo.scope), req, result));
                        return setAuthorizationBearer(req, this);
                    }
                })
                    .then(() => original.call(this, result))
                    .catch(req.next);
            };
        });
        req.next();
    });
};

//remove the current path from the scope if the request was successful
const removeCurrentPathFromScope = alterScope((oldPaths, req) => _.omit(oldPaths, req.path));
//remove paths to the scope if the request was successful
const addPathsToScope = function (newPathsGetter) {
    return alterScope((oldPaths, req, result) => _.merge(oldPaths, newPathsGetter(result, req)));
};

const hideFactorSecrets = applyToIdSiteRequests(function (req, res) {
    shimmer.wrap(res, 'json', function (original) {
        return function (result) {
            result.items.forEach(_.unary(_.partial(_.assign, _, {secret: null, keyUri: null, base64QRImage: null})));
            return original.call(this, result);
        };
    });
    return req.next();
});

module.exports = function (app) {
    app.use(['/applications/*', '/organizations/*', '/accounts/*', '/factors/*', '/challenges/*'], updateBearer, handleRedirects);
    //handle successful 1st factor: either redirect to application or ask for a 2nd factor
    app.post('/applications/:id/loginAttempts', afterAuthentication(_.property('account.href'), false));
    //after account creation, redirect to the application if the email verification workflow is not enabled
    app.post(
        ['/applications/:id/accounts', '/organizations/:id/accounts'],
        afterAuthentication(result => Optional.ofNullable(result.href).filter(_.constant(result.status === 'ENABLED')).orElseGet(_.stubFalse), true)
    );
    //tokens should not be exposed to the user
    app.post('/applications/:id/passwordResetTokens', suppressOutput);
    //password reset tokens can only be used once
    app.post('/applications/:applicationId/passwordResetTokens/:tokenId', removeCurrentPathFromScope);
    //allow challenging newly created factors
    app.post('/accounts/:id/factors', addPathsToScope(r => ({['/factors/' + r.id + '/challenges']: ['post']})));
    //Hide configured factor sercrets
    app.get('/accounts/:id/factors', hideFactorSecrets);
    //after getting factors:
    // - allow deleting them if the user is authenticated (security settings view)
    // - allow challenging verified factors if he is not authenticated yet
    app.get('/accounts/:id/factors', addPathsToScope(
        (r, req) => req.authInfo.authenticated ?
            _(r.items)
                .map(f => ({['/factors/' + f.id]: ['delete']}))
                .reduce(_.merge) :
            _(r.items)
                .filter(_.matches({verificationStatus: 'VERIFIED'}))
                .map(f => ({['/factors/' + f.id + '/challenges']: ['post']}))
                .reduce(_.merge)
    ));
    //allow veryfing created challenges
    app.post('/factors/:id/challenges', addPathsToScope(_.cond([[_.matches({status: 'CREATED'}), c => ({['challenges/' + c.id]: ['post']})], [_.stubTrue, _.stubObject]])));
    //handle successful 2nd factor: redirect to application if the user is not yet authenticated
    app.post(['/challenges/:id', '/factors/:id/challenges'], afterAuthentication(
        (result, req) => !req.authInfo.authenticated && result.status === 'SUCCESS' ? result.account.href : null,
        false,
        _.property('type')
    ));
    //redirect to application once the user is done setting up his account (password or multi factor change)
    app.get('/accounts/:id', afterAuthentication(_.property('href'), false));
    //allow the user to choose any of his organization
    app.get('/accounts/:id/organizations', addPathsToScope((r, req) => _(r.items).map(o => ({[`${req.path}/${o.id}`]: 'post'})).reduce(_.merge)));
    //handle organization choice
    app.post('/accounts/:accountId/organizations/:organizationId',
        afterAuthentication(
            _.property('account.href'),
            null,
            null,
            _.property('organization.href')
        )
    );
};