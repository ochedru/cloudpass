'use strict';

const _ = require('lodash');
const BluebirdPromise = require('sequelize').Promise;
const compression = require('compression');
const express = require('express');
const morgan = require('morgan');
const nocache = require('nocache');
const bodyParser = require('body-parser');
const config = require('config');
const passport = require('passport');
const Optional = require('optional-js');
const BasicStrategy = require('passport-http').BasicStrategy;
const JwtCookieComboStrategy = require('passport-jwt-cookiecombo');
const authorization = require('auth-header');
const SAuthc1Strategy = require('./authentication/SAuthc1Strategy');
const JwtStrategy = require('./authentication/JwtStrategy');
const scopeChecker = require('./helpers/scopeChecker');
const SwaggerExpress = BluebirdPromise.promisifyAll(require('swagger-express-mw'));
const getApiKey = require('./helpers/getApiKey');
const ssaclAuthenticate = require('./helpers/ssaclAuthenticate');
const applyIdSiteMiddleware = require('./helpers/applyIdSiteMiddleware');
const errorHandler = require('./helpers/errorHandler');
const logger = require('../helpers/loggingHelper').logger;

module.exports = function (secret) {

    // register SAuthc1 authentication strategy
    passport.use(new SAuthc1Strategy(config.get('server.rootUrl')));

    //ID sites send request with a JWT in the authorization header
    passport.use(
        'bearer-jwt',
        new JwtStrategy(
            req => Optional.ofNullable(req.headers.authorization)
                .map(_.bindKey(authorization, 'parse'))
                .filter(auth => auth.scheme === 'Bearer')
                .map(_.property('token'))
                .orElse(null),
            _.property('payload.sub')
        )
    );

    //applications can redirect to their IdP with an access token in the 'accessToken' query parameter
    passport.use(
        'access-token-jwt',
        new JwtStrategy(
            _.property('query.accessToken'),
            _.property('header.kid')
        )
    );

    //SAML identity providers use the 'RelayState' POST param
    passport.use(
        'relay-state-jwt',
        new JwtStrategy(
            _.property('body.RelayState'),
            _.property('payload.sub')
        )
    );

    //admins can be authenticated by a cookie set by the /login endpoint
    passport.use(new JwtCookieComboStrategy(
        {
            secretOrPublicKey: secret,
            jwtCookieName: 'sessionToken',
            jwtVerifyOptions: {
                algorithms: ["HS256"],
                audience: 'admin'
            }
        },
        function (payload, done) {
            return done(null, payload);
        }
    ));

    // basic authentication with API key & secret
    passport.use(new BasicStrategy(
        function (apiKeyId, providedSecret, done) {
            getApiKey(apiKeyId)
                .then(function (apiKey) {
                    done(
                        null,
                        Optional.ofNullable(apiKey)
                            .filter(_.flow(_.property('secret'), _.partial(_.eq, providedSecret)))
                            .orElse(false)
                    );
                    return null;
                })
                .catch(done);
        }
    ));

    return SwaggerExpress
        .createAsync({
            appRoot: process.cwd() + '/src',
            configDir: '../config',
            swaggerFile: 'swagger/swagger.yaml'
        })
        .then(function (swaggerExpress) {

            const app = express();
            app.disable('x-powered-by');
            app.use(morgan('tiny', {
                stream: {
                    write: message => message.split('\n').filter(l => l.length > 0).forEach(l => logger('http').info(l))
                }
            }));
            //Sauthc1 needs the raw body
            app.use(bodyParser.json({
                verify: function (req, res, buf) {
                    req.rawBody = buf;
                }
            }));
            app.use(nocache());
            app.use(compression());
            app.use(bodyParser.urlencoded({extended: false}));
            app.use(passport.initialize());

            //redirects to SAML idP can either be initiated from the application (with an access token)
            //or from the ID site (with an authorization bearer)
            app.use('/applications/:id/saml/sso/idpRedirect', ssaclAuthenticate('access-token-jwt', 'bearer-jwt'));
            //SAML SSO post endpoint can only be used by IdPs (with a 'relay state' post param)
            app.use('/directories/:id/saml/sso/post', ssaclAuthenticate('relay-state-jwt'));
            //use SAuthc1, bearer, cookie or basic authentication for all other requests
            app.use(ssaclAuthenticate('sauthc1', 'bearer-jwt', 'jwt-cookiecombo', 'basic'));

            //check if the authorized request scope match the current request
            app.use(scopeChecker);

            //apply special behaviour for ID sites
            applyIdSiteMiddleware(app);

            // register swagger API
            swaggerExpress.register(app);

            // Custom error handler that return JSON errors
            app.use(errorHandler);

            return app;
        });
};