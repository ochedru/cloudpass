//helper methods to create new accounts or groups in resources mapped to account store
//its simply delegates the creation to the default account stores
"use strict";

const _ = require('lodash');
const ApiError = require('../../ApiError');

function getProviders(accountStoreWrapper) {
    return accountStoreWrapper.getDirectories({
        attributes: ['id', 'name'],
        where: {status: 'ENABLED'},
        include: [{
            model: accountStoreWrapper.sequelize.models.directoryProvider,
            as: 'provider',
            attributes: ['providerId', 'directoryId']
        }]
    })
        .filter(_.flow([_.iteratee('provider.providerId'), _.negate(_.isEmpty)]))
        .map(directory => ({
                providerId: directory.provider.providerId,
                accountStore: {
                    href: directory.href,
                    name: directory.name
                }
            })
        );
}

function getLogoUrl(accountStoreWrapper) {
    return accountStoreWrapper.getTenant({
        attributes: [],
        include: [{
            model: accountStoreWrapper.sequelize.models.idSite,
            attributes: ['logoUrl']
        }]
    })
        .get('idSites')
        .get(0)
        .get('logoUrl');
}

function getDefaultPasswordStrengthPolicy(accountStoreWrapper) {
    return getDefaultPasswordPolicy(accountStoreWrapper)
        .then(function (passwordPolicy) {
            if (!passwordPolicy) {
                return null;
            }
            const passwordStrength = passwordPolicy.getStrength();
            return {
                minLength: passwordStrength.minLength,
                maxLength: passwordStrength.maxLength,
                requireLowerCase: passwordStrength.minLowerCase > 0,
                requireUpperCase: passwordStrength.minUpperCase > 0,
                requireNumeric: passwordStrength.minNumeric > 0,
                requireSymbol: passwordStrength.minSymbol > 0,
                requireDiacritic: passwordStrength.minDiacritic > 0
            };
        });
}

//return the password strength policy applied in the default account store
function getDefaultPasswordPolicy(accountStoreWrapper) {
    const models = accountStoreWrapper.sequelize.models;
    return accountStoreWrapper.getDefaultAccountStoreMapping()
        .then(function (asm) {
            if (!asm) {
                return null;
            }
            switch (asm.accountStoreType) {
                case 'directory':
                    return asm
                        .getAccountStore({
                            attributes: ['passwordPolicyId'],
                            include: [models.passwordPolicy]
                        })
                        .get('passwordPolicy');
                case 'group':
                    return asm
                        .getAccountStore({
                            attributes: ['directoryId'],
                            include: [{
                                model: models.directory,
                                attributes: ['passwordPolicyId'],
                                include: [models.passwordPolicy]
                            }]
                        })
                        .get('directory')
                        .get('passwordPolicy');
                default: //organization
                    return asm
                        .getAccountStore({attributes: ['defaultAccountStoreMappingId']})
                        .then(getDefaultPasswordPolicy);
            }
        });
}

function createNewAccount(attributes, registrationWorflowEnabled, authInfo, apiKey) {
    return this.getDefaultAccountStoreMapping()
        .tap(ApiError.assertOrError(400, 5101, 'The account storage location is unspecified'))
        .then(_.method('getAccountStore'))
        .then(_.method('createNewAccount', attributes, registrationWorflowEnabled, authInfo, apiKey));
}

function createNewGroup(attributes) {
    return this.getDefaultGroupStoreMapping()
        .tap(ApiError.assertOrError(400, 5102, 'The group storage location is unspecified.'))
        .then(_.method('getAccountStore'))
        .then(_.method('createNewGroup', attributes));
}

function getIdSiteModel() {
    return this.sequelize.Promise.join(
        getProviders(this),
        getDefaultPasswordStrengthPolicy(this),
        getLogoUrl(this)
    ).spread(function (providers, passwordPolicy, logoUrl) {
        return {
            href: this.href + '/idSiteModel',
            providers: providers,
            passwordPolicy: passwordPolicy,
            logoUrl: logoUrl
        };
    }.bind(this));
}

module.exports = {createNewAccount, createNewGroup, getIdSiteModel};