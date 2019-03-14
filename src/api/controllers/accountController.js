"use strict";

const _ = require('lodash');
const BluebirdPromise = require('sequelize').Promise;
const Optional = require('optional-js');
const config = require('config');
const controllerHelper = require('../helpers/controllerHelper');
const baseController = require('../helpers/baseController');
const models = require('../../models');
const ApiError = require('../../ApiError');
const email = require('../../helpers/email');

const controller = baseController(models.account);

controller.getCurrent = function (req, res) {
    res.status(302)
            .location(
                Optional.ofNullable(config.get('server.rootUrl'))
                    .map(_.method('concat', '/v1/accounts/', req.user.accountId))
                    .orElse(req.user.accountId)
            )
            .json();
};

controller.getApiKeys = _.partial(controllerHelper.getCollection, models.account, 'apiKeys');
controller.createApiKey = function(req, res){
    return controllerHelper.createAndExpand(
            models.apiKey,
            {tenantId: req.user.tenantId, accountId: req.swagger.params.id.value},
            req, res);
};

controller.getFactors = _.partial(controllerHelper.getCollection, models.account, 'factors');
controller.createFactor = function(req, res){
    const accountId = req.swagger.params.id.value;
    const factorAttributes = req.swagger.params.attributes.value;
    //if accountName is not set, take the account email
    BluebirdPromise.resolve(
      Optional.ofNullable(factorAttributes.accountName)
        .orElseGet(() => models.account.findByPk(accountId, {attributes: ['email']})
                        .tap(ApiError.assertFound)
                        .get('email'))
    ).then(email => {
        factorAttributes.accountName = email;
        return controllerHelper.createAndExpand(
            models.factor,
            {tenantId: req.user.tenantId, accountId: accountId},
            req, res);
    });
};

controller.consumeEmailVerificationToken = function(req, res){
    models.sequelize.transaction(function(){
        //account creation policy cannot be eagerly loaded here
        //see https://github.com/sequelize/sequelize/issues/2084
        return models.emailVerificationToken.findByPk(
            req.swagger.params.tokenId.value,
            {
                include: [{
                    model: models.account,
                    include: [{
                        model: models.directory
                    }]
                }]
            }
        )
        .then(function(token){
            ApiError.assert(token, ApiError.NOT_FOUND);
            //enable the account and delete the token
            return models.sequelize.Promise.join(
                        token.account.update({status: 'ENABLED'}),
                        token.destroy()
                    );
        });
    })
    .spread(function(account){
        account.directory.getAccountCreationPolicy()
                .then(function(policy){
                    //send verification success & welcome emails if they are enabled
                    if(policy.verificationSuccessEmailStatus === 'ENABLED'){
                        policy
                            .getVerificationSuccessEmailTemplates({limit: 1})
                            .spread(function(template){
                                email.send(
                                    account,
                                    account.directory,
                                    template);
                            });
                    }
                    if(policy.welcomeEmailStatus === 'ENABLED'){
                        policy
                            .getWelcomeEmailTemplates({limit : 1})
                            .spread(function(template){
                                email.send(
                                    account,
                                    account.directory,
                                    template);
                            });
                    }
                });

        //send the whole account only if the expand parameter is set
        res.json(req.swagger.params.expand.value?account:_.pick(account, 'href'));
    })
    .catch(req.next);
};

controller.getProviderData = _.partial(controller.getComputedSubResource, 'getProviderData');

controller.changePassword = function(req, res){
    models.account.findByPk(
        req.swagger.params.id.value,
        {
            include: [{
                model: models.directory,
                include: [{model: models.passwordPolicy}]
            }]
        }
    )
    .tap(ApiError.assertFound)
    .tap(account =>
        account.verifyPassword(req.swagger.params.attributes.value.currentPassword)
            .then(_.partial(ApiError.assert, _, ApiError, 400, 7100, 'Password change failed because the specified password is incorrect.'))
    )
    .then(account => account.update({password: req.swagger.params.attributes.value.newPassword}))
    .then(account => {
        if (account.directory.passwordPolicy.resetSuccessEmailStatus === 'ENABLED') {
            account.directory.passwordPolicy
                .getResetSuccessEmailTemplates({limit: 1})
                .spread(template => email.send(account, account.directory, template));
        }
        res.status(204).json();
    })
    .catch(req.next);
};

//only for ID site, the actual work is made in applyIdSiteMiddleware
controller.selectOrganization = (req, res) =>  res.json({
    account: models.account.build({id: req.swagger.params.id.value}),
    organization: models.organization.build({id: req.swagger.params.organizationId.value})
});

module.exports = controller;