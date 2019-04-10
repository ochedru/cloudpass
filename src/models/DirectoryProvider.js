"use strict";

const _ = require('lodash');
const pem = require('sequelize').Promise.promisifyAll(require('pem'));
const Optional = require('optional-js');
const config = require('config');
const url = require('url');
const ApiError = require('../ApiError');
const ModelDecorator = require('./helpers/ModelDecorator');

module.exports = function (sequelize, DataTypes) {
    return new ModelDecorator(
            sequelize.define(
            'directoryProvider',
            {
                id: {
                    primaryKey: true,
                    type: DataTypes.UUID,
                    allowNull: false,
                    defaultValue: DataTypes.UUIDV4
                },
                providerId: {
                    type: DataTypes.STRING(9),
                    validate: {isIn: [['cloudpass', 'saml']]},
                    allowNull: false
                },
                // OAuth, not supported yet
                clientId:{
                    type: DataTypes.STRING,
                    allowNull: true
                },
                clientSecret: {
                    type: DataTypes.STRING,
                    allowNull: true
                },
                // SAML
                ssoLoginUrl: {
                    type: DataTypes.STRING,
                    validate: {isURL: {require_tld: false}},
                    allowNull: true
                },
                ssoLogoutUrl: {
                    type: DataTypes.STRING,
                    validate: {isURL: {require_tld: false}},
                    allowNull: true
                },
                encodedX509SigningCert: {
                    type: DataTypes.TEXT,
                    validate:{
                        isPem: function(value){
                            ApiError.assert(
                                _.startsWith(value, '-----BEGIN CERTIFICATE-----'),
                                'Certificate must be in PEM format');
                        }
                    },
                    allowNull: true
                }
            },
            {
                validate: {
                    samlProvider: function(){
                        if(this.providerId === 'saml'){
                            ApiError.assert(this.ssoLoginUrl, 'Missing IdP SSO Login URL');
                            // ssoLogoutUrl is optional
                            ApiError.assert(this.encodedX509SigningCert, 'Missing IdP certificate');
                        }
                    }
                },
                getterMethods: {
                    href: function () {
                        return this.sequelize.models.directory.getHref(this.directoryId)+'/provider';
                    }
                },
                hooks: {
                    beforeCreate: function(instance){
                        if(instance.providerId === 'saml'){
                            return instance.sequelize.Promise.join(
                                //generate a certificate
                                pem.createCertificateAsync({
                                    commonName: Optional.ofNullable(config.get('server.rootUrl'))
                                                    .map(function(rootUrl){
                                                        return url.format(rootUrl).hostname;
                                                    })
                                                    .orElse('localhost'),
                                    days: 7300,
                                    selfSigned: true,
                                    keyBitsize: 2048
                                })
                                .then(function(generated){
                                    return instance.sequelize.models.samlServiceProviderMetadata.create({
                                        privateKey: generated.clientKey,
                                        x509SigningCert: generated.certificate,
                                        directoryId: instance.directoryId,
                                        tenantId: instance.tenantId
                                    })
                                    .then(function(metadata){
                                        instance.set('samlServiceProviderMetadataId', metadata.id);
                                    });
                                }),
                                //create empty statement mapping rules
                                instance.sequelize.models.attributeStatementMappingRules.create({tenantId: instance.tenantId})
                                    .then(function(rules){
                                        instance.set('attributeStatementMappingRulesId', rules.id);
                                    })
                            );
                        }
                    },
                    afterDestroy: function(instance){
                        return instance.sequelize.Promise.join(
                            this.sequelize.models.samlServiceProviderMetadata.destroy({where: {id: instance.samlServiceProviderMetadataId}}),
                            this.sequelize.models.attributeStatementMappingRules.destroy({where: {id: instance.attributeStatementMappingRulesId}})
                        );
                    }
                }
            }
        )
    )
    .withClassMethods({
        associate: function(models){
            models.directoryProvider.belongsTo(models.tenant, {onDelete: 'cascade'});
            models.directoryProvider.belongsTo(models.directory, {onDelete: 'cascade'});
            models.directoryProvider.belongsTo(models.attributeStatementMappingRules, {onDelete: 'cascade', foreignKey: 'attributeStatementMappingRulesId'});
            models.directoryProvider.belongsTo(models.samlServiceProviderMetadata, {onDelete: 'cascade', foreignKey: 'samlServiceProviderMetadataId'});
        }
    })
    .withSettableAttributes('clientId', 'clientSecret', 'ssoLoginUrl', 'ssoLogoutUrl', 'encodedX509SigningCert')
    .end();
};