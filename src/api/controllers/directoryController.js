"use strict";

const BluebirdPromise = require('sequelize').Promise;
const _ = require('lodash');
const jsonwebtoken = require('jsonwebtoken');
const signJwt = BluebirdPromise.promisify(jsonwebtoken.sign);
const decodeJwt = jsonwebtoken.decode;
const Optional = require('optional-js');
const accountStoreController = require('../helpers/accountStoreController');
const controllerHelper = require('../helpers/controllerHelper');
const samlHelper = require('../helpers/samlHelper');
const accountHelper = require('../helpers/accountHelper');
const models = require('../../models');
const sendJwtResponse = require('../../apps/helpers/sendJwtResponse');
const ApiError = require('../../ApiError');
const hrefHelper = require('../../helpers/hrefHelper');
const logger = require('../../helpers/loggingHelper').logger;
const isemail = require('isemail');
const scopeHelper = require('../../helpers/scopeHelper')
const idSiteHelper = require('../../apps/helpers/idSiteHelper');

const controller = accountStoreController(models.directory, ['create', 'delete']);

controller.create = function (req, res) {
    const attributes = req.swagger.params.attributes.value;
    controllerHelper.queryAndExpand(
        () => controllerHelper.create(
            models.directory,
            {tenantId: req.user.tenantId},
            attributes,
            true
        )
            .tap(function (newDirectory) {
                //'cloudpass' provider doesn't require storing additional data
                if (attributes.provider && attributes.provider.providerId !== 'cloudpass') {
                    return controllerHelper.create(
                        models.directoryProvider,
                        {
                            tenantId: req.user.tenantId,
                            directoryId: newDirectory.id,
                            providerId: attributes.provider.providerId
                        },
                        attributes.provider,
                        true
                    );
                }
            }),
        req,
        res,
        true
    );
};

controller.getProvider = _.partial(controller.getSubResource, 'getProvider');

controller.updateProvider = function (req, res) {
    controllerHelper.queryAndExpand(
        () => models.directory.build({id: req.swagger.params.id.value, tenantId: req.user.tenantId})
            .getProvider()
            .tap(provider => {
                //'cloudpass' provider is not persited in database and cannot be updated
                if (provider.providerId !== 'cloudpass') {
                    return provider.update(
                        req.swagger.params.newAttributes.value,
                        //the providerId cannot be changed
                        {fields: _.without(models.directoryProvider.settableAttributes, 'providerId')}
                    );
                }
            }),
        req,
        res
    );
};

function getEmail(samlResponse) {
    const user = samlResponse.user;
    if (isemail.validate(_.toLower(user.name_id))) {
        return _.toLower(user.name_id);
    } else {
        // name_id is not an email address: search for email in attributes
        const emails = new Set();
        for (const key in user.attributes) {
            if (user.attributes.hasOwnProperty(key)) {
                for (const v of user.attributes[key]) {
                    if (isemail.validate(_.toLower(v))) {
                        emails.add(_.toLower(v));
                    }
                }
            }
        }
        if (emails.size === 1) {
            return emails.values().next().value;
        } else {
            // multiple email addresses are present in attributes: search for specific attributes
            for (const key of ['email', 'mail']) {
                if (user.attributes.hasOwnProperty(key) && isemail.validate(_.toLower(user.attributes[key]))) {
                    return _.toLower(user.attributes[key]);
                }
            }
            logger('sso').error('cannot find user email in SAML response: %s', JSON.stringify(samlResponse));
            throw new ApiError(400, 400, "User email not found in SAML assertion");
        }
    }
}

controller.consumeSamlAssertion = function (req, res) {
    models.directoryProvider.findOne({
        where: {directoryId: req.swagger.params.id.value},
        include: [models.samlServiceProviderMetadata, models.attributeStatementMappingRules]
    })
        .then(provider =>
            BluebirdPromise.join(
                samlHelper.getSamlResponse(provider, req.body),
                provider.attributeStatementMappingRules
            )
        )
        .spread((samlResponse, mappingRules) =>
            models.sequelize.requireTransaction(() => {
                logger('sso').debug('incoming SAML response: %s', JSON.stringify(samlResponse));
                const email = getEmail(samlResponse);
                logger('sso').debug('found email from SAML response: %s', email);
                return models.account.findOrCreate({
                    where: {
                        email: email,
                        directoryId: req.swagger.params.id.value
                    },
                    defaults: {
                        tenantId: req.user.tenantId,
                        //disable password authentication by default for SAML accounts
                        passwordAuthenticationAllowed: false
                    }
                })
                    .spread((account, created) => {
                        logger('sso').debug('found or created account %s in directory %s from SAML response', account.id, req.swagger.params.id.value);
                        const providerData = _.defaults({providerId: 'saml'}, _.mapValues(samlResponse.user.attributes, _.head));
                        const application = hrefHelper.resolveHref(req.authInfo.app_href);
                        return BluebirdPromise.join(
                            account.update(
                                //'_.fromPairs' doesn't support property paths (customData.xxx), so we use zipObjectDeep(zip) instead
                                _.spread(_.zipObjectDeep)(_.spread(_.zip)(
                                    _(mappingRules.items)
                                    //get account attribute lists and their new value
                                        .map(_.over(_.property('accountAttributes'), _.flow(_.property('name'), _.propertyOf(providerData))))
                                        //make pairs of account attribute/value (obviously)
                                        .flatMap(_.spread(_.overArgs(_.map, [_.identity, _.flow(_.constant, _.partial(_.over, _.identity))])))
                                        //add provider data
                                        .tap(_.method('push', ['providerData', providerData]))
                                        .value()
                                ))
                            )
                                .then(account => accountHelper.getLinkedAccount(account, application.id)),
                            created,
                            application.getLookupAccountStore(req.authInfo.onk)
                        );
                    });
            })
        )
        .tap(([account, created, accountStore]) => { // eslint-disable-line no-unused-vars
                //check that the account belongs to the required application or organization
                return accountStore.getAccounts({
                    where: {id: account.id},
                    limit: 1,
                    attributes: ['id']
                })
                    .get(0)
                    .then(foundAccount => {
                        if (foundAccount) {
                            logger('sso').debug('found account %s in account store %s', account.id, accountStore.id);
                        } else {
                            logger('sso').error('cannot find account %s in account store %s', account.id, accountStore.id);
                        }
                        return ApiError.assert(foundAccount, ApiError, 400, 7104, 'This account does not belong to the required account store');
                    })
            }
        )
        .spread((account, created, accountStore) =>
            BluebirdPromise.join(account, account.countOrganizations(), created, accountStore)
        )
        .spread((account, nbOrganizations, created, accountStore) => {
                logger('sso').debug('found %s organizations for account %s', nbOrganizations, account.id);
                if (nbOrganizations > 1) {
                    // redirect to id site to choose organization
                    const relayState = decodeJwt(req.body.RelayState);
                    const application = hrefHelper.resolveHref(req.authInfo.app_href);
                    return BluebirdPromise.join(
                        models.idSite.findOne({
                            where: {
                                tenantId: req.user.tenantId
                            },
                            attributes: ['url'],
                            limit: 1
                        }),
                        signJwt(
                            {
                                isNewSub: created,
                                cb_uri: req.authInfo.cb_uri,
                                irt: req.authInfo.init_jti,
                                state: req.authInfo.state,
                                inv_href: req.authInfo.inv_href,

                                sofa: true,     // select organization for account
                                scope: _.merge(
                                    scopeHelper.getIdSiteScope(application, accountStore),
                                    idSiteHelper.getAccountOrganizationsScope(account.id)
                                ),
                                app_href: application.href,
                                init_jti: req.authInfo.init_jti,
                                asnk: accountStore.name, //account store name key
                                //sof: true, //show organization field
                                ros: true, //require organization selection
                                ash: application.href,
                                //only to not make stormpath.js crash
                                sp_token: 'null'
                            },
                            req.user.secret,
                            {
                                expiresIn: 60,
                                issuer: req.authInfo.app_href,
                                subject: relayState.sub,
                                audience: 'idSite'
                            }
                        )
                    )
                        .spread((idSite, token) => {
                                const location = idSite.url + '/#/?jwt=' + token;
                                logger('sso').debug('choose organization, redirect to %s', location);
                                return res.status(302).location(location).send();
                            }
                        );
                } else {
                    // only one organization: redirect to application
                    return signJwt(
                        {
                            isNewSub: created,
                            status: "AUTHENTICATED",
                            cb_uri: req.authInfo.cb_uri,
                            irt: req.authInfo.init_jti,
                            state: req.authInfo.state,
                            inv_href: req.authInfo.inv_href,
                            org_href: Optional.of(accountStore).filter(as => as instanceof models.organization).map(_.property('href')).orElse(null)
                        },
                        req.user.secret,
                        {
                            expiresIn: 60,
                            issuer: req.authInfo.app_href,
                            subject: account.href,
                            audience: req.user.id,
                            header: {
                                kid: req.user.id,
                                stt: 'assertion'
                            }
                        }
                    )
                        .then(sendJwtResponse(res, req.authInfo.cb_uri));
                }
            }
        )
        .catch(req.next);
};

module.exports = controller;