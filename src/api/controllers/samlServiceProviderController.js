"use strict";

const samlHelper = require('../helpers/samlHelper');
const models = require('../../models');
const ApiError = require('../../ApiError');

exports.get = function(req, res){
    // SAML service provider ID = application ID
    models.application
        .findByPk(req.swagger.params.id.value)
        .tap(ApiError.assertFound)
        .call('getSamlPolicy')
        .call('getServiceProvider')
        .then(res.json.bind(res))
        .catch(req.next);
};

exports.generateDefaultRelayState = function(req, res){
    //An API key is necessary to sign callback JWTs.
    //But after cookie authentication (i.e. from the UI), no API key is
    //associated to the request.
    ApiError.assert(req.user.id, ApiError.FORBIDDEN);
    samlHelper.getRelayState(
        req.user,
        {
            cb_uri: req.swagger.params.properties.value.callbackUri,
            state: req.swagger.params.properties.value.state,
            app_href: models.application.getHref(req.swagger.params.id.value),
            onk: req.swagger.params.properties.value.onk
        }
    )
    .then(function(relayState){
        res.json({defaultRelayState: relayState});
    });
};