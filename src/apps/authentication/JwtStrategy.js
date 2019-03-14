"use strict";

const util = require('util');
const passport = require('passport');
const _ = require('lodash');
const BluebirdPromise = require('sequelize').Promise;
const jwt = require('jsonwebtoken');
const verifyJwt = BluebirdPromise.promisify(jwt.verify);
const ApiError = require('../../ApiError.js');
const getApiKey = require('../helpers/getApiKey');


function JwtStrategy(jwtExtractor, apiKeyIdExtractor, ...apiKeyIncludes) {
    this.name = 'jwt';
    //the jwt extractor extracts the JWT from the request
    this.jwtExtractor = jwtExtractor;
    //the API key extractor extracts the API key ID from the decoded jwt
    this.apiKeyIdExtractor = apiKeyIdExtractor;
    this.apiKeyIncludes = apiKeyIncludes;
}

util.inherits(JwtStrategy, passport.Strategy);

JwtStrategy.prototype.authenticate = function (req) {
    BluebirdPromise.try(() => {
        const token = this.jwtExtractor(req);
        ApiError.assert(token, 'No auth token');
        const apiKeyId = this.apiKeyIdExtractor(jwt.decode(token, {complete: true}));
        ApiError.assert(apiKeyId, 'no API key Id');
        return getApiKey(apiKeyId, ...this.apiKeyIncludes)
            .tap(_.partial(ApiError.assert, _, 'no API key'))
            .then(apiKey => verifyJwt(token, apiKey.secret).then(_.partial(this.success, apiKey)));
    })
        .catch(this.fail);
};

module.exports = JwtStrategy;