"use strict";

const _ = require('lodash');
const Optional = require('optional-js');
const accountStoreWrapperMethods = require('./helpers/accountStoreWrapperMethods');
const addAccountStoreAccessors = require('./helpers/addAccountStoreAccessors');
const hrefHelper = require('../helpers/hrefHelper');
const ApiError = require('../ApiError');
const ModelDecorator = require('./helpers/ModelDecorator');

module.exports = function (sequelize, DataTypes) {
    return new ModelDecorator(
        sequelize.define(
            'application',
            {
                id: {
                    primaryKey: true,
                    type: DataTypes.UUID,
                    allowNull: false,
                    defaultValue: DataTypes.UUIDV4
                },
                name: {
                    type: DataTypes.STRING,
                    validate: {len: [1, 255]},
                    allowNull: false
                },
                description: {
                    type: DataTypes.TEXT,
                    defaultValue: ''
                },
                status: {
                    type: DataTypes.STRING(8),
                    validate: {isIn: [['ENABLED', 'DISABLED']]},
                    allowNull: false,
                    defaultValue: 'ENABLED'
                }
            },
            {
                indexes: [{
                    unique: true,
                    fields: ['name', 'tenantId']
                }],
                hooks: {
                    beforeCreate: function (instance) {
                        return instance.sequelize.Promise.join(
                            this.sequelize.models.invitationPolicy.create({tenantId: instance.tenantId}),
                            this.sequelize.models.accountLinkingPolicy.create({tenantId: instance.tenantId})
                        )
                            .spread((invitationPolicy, accountLinkingPolicy) => {
                                instance.set('invitationPolicyId', invitationPolicy.id);
                                instance.set('accountLinkingPolicyId', accountLinkingPolicy.id);
                            });
                    }
                },
                getterMethods: {
                    loginAttempts: function () {
                        return {href: this.href + '/loginAttempts'};
                    },
                    verificationEmails: function () {
                        return {href: this.href + '/verificationEmails'};
                    },
                    idSiteModel: function () {
                        return {href: this.href + '/idSiteModel'};
                    },
                    samlPolicy: function () {
                        return {href: hrefHelper.baseUrl + 'samlPolicies/' + this.id};
                    }
                }
            }
        )
    )
        .withInstanceMethods(
            _.assign(
                {
                    getSamlPolicy: function () {
                        const applicationHref = this.href;
                        return {
                            id: this.id,
                            href: hrefHelper.baseUrl + 'samlPolicies/' + this.id,
                            createdAt: this.createdAt,
                            modifiedAt: this.createdAt,
                            serviceProvider: {href: hrefHelper.baseUrl + 'samlServiceProviders/' + this.id},
                            getServiceProvider: function () {
                                return {
                                    id: this.id,
                                    href: hrefHelper.baseUrl + 'samlServiceProviders/' + this.id,
                                    createdAt: this.createdAt,
                                    modifiedAt: this.createdAt,
                                    ssoInitiationEndpoint: {href: applicationHref + '/saml/sso/idpRedirect'},
                                    defaultRelayStates: {href: hrefHelper.baseUrl + 'samlServiceProviders/' + this.id + '/defaultRelayStates'}
                                };
                            }
                        };
                    },
                    getLookupAccountStore: function (organizationName) {
                        //if organizationName is specified, try to find an organization
                        //mapped to this application with that name.
                        //Else return this application
                        return Optional.ofNullable(organizationName)
                            .map(o => this.getOrganizations({
                                attributes: ['id'],
                                where: {name: o},
                                limit: 1
                            })
                                .then(_.head)
                                .tap(_.partial(ApiError.assert, _, ApiError, 404, 2014, 'Organization %s is not linked to application %s', organizationName, this.id)))
                            .orElse(this.sequelize.Promise.resolve(this));
                    }
                },
                accountStoreWrapperMethods
            )
        )
        .withClassMethods({
            associate: models => {
                models.application.hasMany(models.accountStoreMapping, {onDelete: 'cascade'});
                models.application.hasMany(models.invitation, {onDelete: 'cascade'});
                models.application.belongsTo(models.accountStoreMapping, {
                    as: 'defaultAccountStoreMapping',
                    constraints: false
                });
                models.application.belongsTo(models.accountStoreMapping, {
                    as: 'defaultGroupStoreMapping',
                    constraints: false
                });
                models.application.hasMany(models.passwordResetToken, {onDelete: 'cascade'});
                models.application.belongsTo(models.tenant, {onDelete: 'cascade'});
                models.application.belongsToMany(
                    models.organization, {
                        through: {
                            model: models.accountStoreMapping,
                            unique: false,
                            scope: {
                                accountStoreType: 'organization'
                            }
                        },
                        foreignKey: 'applicationId'
                    }
                );
                models.application.belongsTo(models.invitationPolicy, {onDelete: 'cascade'});
                models.application.belongsTo(models.accountLinkingPolicy, {onDelete: 'cascade'});
            },
            afterAssociate: models => {
                addAccountStoreAccessors(models.application, models.account);
                addAccountStoreAccessors(models.application, models.group);
                addAccountStoreAccessors(models.application, models.directory);
            },
            getIdSiteScope: _.constant(
                [
                    'get',
                    {customData: ['get']},
                    {idSiteModel: ['get']},
                    {loginAttempts: ['post']},
                    {accounts: ['post']},
                    {passwordResetTokens: ["post"]},
                    {saml: {sso: {idpRedirect: ['get']}}}
                ]
            )
        })
        .withSearchableAttributes('id', 'name', 'description', 'status')
        .withSettableAttributes('name', 'description', 'status', 'customData')
        .withCustomData()
        .end();
};
