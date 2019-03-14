"use strict";

const ModelDecorator = require('./helpers/ModelDecorator');

module.exports = function (sequelize, DataTypes) {
    return new ModelDecorator(
        sequelize.define(
            'emailTemplate',
            {
                id: {
                    primaryKey: true,
                    type: DataTypes.UUID,
                    allowNull: false,
                    defaultValue: DataTypes.UUIDV4
                },
                policyId: {
                    type: DataTypes.UUID,
                    validate: {isUUID: 4},
                    allowNull: false
                },
                workflowStep: {
                    type: DataTypes.STRING(30),
                    validate: {isIn: [['passwordReset', 'passwordResetSuccess', 'emailVerification', 'emailVerificationSuccess', 'welcome', 'invitation', 'accountLocked']]},
                    allowNull: false
                },
                fromEmailAddress: {
                    type: DataTypes.STRING,
                    validate: {isEmail: true},
                    allowNull: false,
                    defaultValue: 'change-me@example.com'
                },
                fromName: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    defaultValue: 'Change Me'
                },
                subject: {
                    type: DataTypes.STRING(78),
                    validate: {len: [1, 78]},
                    allowNull: false
                },
                htmlBody: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: ''
                },
                textBody: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: ''
                },
                mimeType: {
                    type: DataTypes.ENUM('text/plain', 'text/html'),
                    allowNull: false,
                    defaultValue: 'text/plain'
                },
                linkBaseUrl: {
                    type: DataTypes.STRING,
                    validate: {isURL: {require_tld: false}},
                    roles: { defaultModel : true }
                },
                mandrillTemplate: {
                    type: DataTypes.STRING,
                    allowNull: true
                }
            },
            {
                indexes: [{ fields: ['policyId', 'tenantId'] }],
                getterMethods: {
                    defaultModel: function(){
                        const linkBaseUrl = this.get('linkBaseUrl', {role: 'defaultModel'});
                        return linkBaseUrl? {linkBaseUrl : linkBaseUrl}: undefined;
                    }
                },
                setterMethods: {
                    defaultModel: function(value){
                        if(value.linkBaseUrl){
                            this.set('linkBaseUrl', value.linkBaseUrl, {role: 'defaultModel'});
                        }
                    }
                },
                instanceMethods: {
                    getUrlTokens : function(cpToken){
                        const cpTokenNameValuePair = 'cpToken='+cpToken;
                        return{
                            url: this.get('linkBaseUrl', {role: 'defaultModel'}) + '?'+cpTokenNameValuePair,
                            cpToken: cpToken,
                            cpTokenNameValuePair: cpTokenNameValuePair
                        };
                    }
                },
                classMethods: {
                     associate: function(models) {
                         models.emailTemplate.belongsTo(models.tenant, {onDelete: 'cascade'});
                     }
                }
            }
        )
    )
    .withInstanceMethods({
        getUrlTokens : function(cpToken){
            const cpTokenNameValuePair = 'cpToken='+cpToken;
            return{
                url: this.get('linkBaseUrl', {role: 'defaultModel'}) + '?'+cpTokenNameValuePair,
                cpToken: cpToken,
                cpTokenNameValuePair: cpTokenNameValuePair
            };
        }
    })
    .withClassMethods({
        associate: function(models) {
            models.emailTemplate.belongsTo(models.tenant, {onDelete: 'cascade'});
        }
    })
    .withSettableAttributes('fromEmailAddress', 'fromName', 'subject', 'htmlBody', 'textBody', 'mimeType', 'defaultModel', 'linkBaseUrl', 'mandrillTemplate')
    .end();
};
