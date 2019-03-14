"use strict";

const _ = require('lodash');
const BluebirdPromise = require('sequelize').Promise;
const Op = require('sequelize').Op;
const Optional = require('optional-js');
const moment = require('moment');
const models = require('../../models');
const ApiError = require('../../ApiError');
const email = require('../../helpers/email');
const hrefHelper = require('../../helpers/hrefHelper');


exports.getSubAccountStore = function(accountStore, subAccountStoreHref){
    return Optional.ofNullable(subAccountStoreHref)
            .map(ash => {
                const subAccountStore = hrefHelper.resolveHref(ash);
                //if account store & sub account store are the same, just return the former
                if(subAccountStore instanceof accountStore.constructor){
                    ApiError.assert(accountStore.id === subAccountStore.id, ApiError, 400, 2014, 'The provided %s have different ID (%s and %s)', accountStore.constructor.options.name.plural, accountStore.id, subAccountStore.id);
                    return BluebirdPromise.resolve(accountStore);
                }
                //check that the sub account store actually is an account store
                ApiError.assert(_.find([models.organization, models.directory, models.group], i => subAccountStore instanceof i), ApiError, 400, 2014, 'Cannot lookup accounts in %s', subAccountStoreHref);
                //check if the sub-account store belongs to the account store
                return accountStore['get'+_.upperFirst(subAccountStore.constructor.options.name.plural)]({
                        where: {id : subAccountStore.id},
                        limit: 1
                    })
                    .then(_.head)
                    .tap(_.partial(ApiError.assert, _, ApiError, 400, 2014, '%s %s does not belong to %s %s', subAccountStore.constructor.name, subAccountStore.id, accountStore.constructor.name, accountStore.id));
            })
            .orElse(accountStore);
};

exports.findCloudAccount = function(login, applicationId, organizationName, accountStoreHref, ...directoryIncludes){
    //username and password are persisted lowercased to allow for case insensitive search
    const lowerCaseLogin = login.toLowerCase();
    return models.application.build({id: applicationId}, {isNewRecord: false})
            .getLookupAccountStore(organizationName)
            .then(as => exports.getSubAccountStore(as, accountStoreHref))
            .then(as => as.getAccounts({
                where: {
                    '$directory.provider.id$': null, //cloud directories don't have associated providers
                    [Op.or]: [{email: lowerCaseLogin}, {username: lowerCaseLogin} ]
                },
                limit: 1,
                include: [
                    {
                        model: models.directory,
                        required: true,
                        attributes: ['id'],
                        include: [
                            ...directoryIncludes,
                            {
                                model: models.directoryProvider,
                                as: 'provider',
                                attributes: ['id']
                            }
                        ]
                    }
                ]
            }))
            .get(0);
};

exports.authenticateAccount = function(login, password, applicationId, organizationName, accountStoreHref){
    return exports.findCloudAccount(
            login,
            applicationId,
            organizationName,
            accountStoreHref,
            {model : models.accountLockingPolicy}
        )
        .then(function(account){
           ApiError.assert(account, ApiError, 400, 7104, 'Login attempt failed because there is no Account in the Application’s associated Account Stores with the specified username or email.');
           ApiError.assert(account.status === 'ENABLED', ApiError, 400, 7101, 'Login attempt failed because the Account is not enabled.');
           ApiError.assert(account.passwordAuthenticationAllowed, ApiError, 400, 7101, 'Login attempt failed because password authentication is disabled for this account.');
           ApiError.assert(
                account.failedLoginAttempts < account.directory.accountLockingPolicy.maxFailedLoginAttempts ||
                moment(account.lastLoginAttempt).add(moment.duration(account.directory.accountLockingPolicy.accountLockDuration)).isBefore(moment()),
                ApiError, 400, 7103, 'Login attempt failed because the Account is locked.');

           return account
                   .verifyPassword(password)
                   .then(result => {
                       if(result){
                           //authentication successful: reset failed login attempts
                           return account.update({
                               failedLoginAttempts: 0,
                               lastLoginAttempt: new Date()
                           });
                       } else {
                            //authentication failed: increment failedLoginAttempts
                            //can't use account.update(...) here because we will need the value of account.failedLoginAttempts later
                            return account.update({
                                failedLoginAttempts: account.failedLoginAttempts + 1,
                                lastLoginAttempt: new Date()
                            })
                           .then(() => {
                               //if it was the last try, send a email to notify of account locking
                               if(account.failedLoginAttempts >= account.directory.accountLockingPolicy.maxFailedLoginAttempts &&
                                  account.directory.accountLockingPolicy.accountLockedEmailStatus === 'ENABLED'){
                                   account.directory.accountLockingPolicy
                                        .getAccountLockedEmailTemplates({limit: 1})
                                        .spread(template =>
                                            email.send(
                                              account,
                                              account.directory,
                                              template,
                                              null,
                                              {accountLockDuration: moment.duration(account.directory.accountLockingPolicy.accountLockDuration).asMinutes()}
                                            )
                                        );
                               }
                               throw new ApiError(400, 7100, 'Login attempt failed because the specified password is incorrect.');
                           });

                       }
                   })
                   .then(a => exports.getLinkedAccount(a, applicationId));
        });
};

// ignore until jshint  supports async/await, c.f. https://github.com/jshint/jshint/issues/2604
/* jshint ignore:start */
exports.getLinkedAccount = async (account, applicationId) =>
    //check that account linking policy is enabled and that the default account store is a directory
    Optional.ofNullable(await models.application.findByPk(
            applicationId,
            {
                attributes: [],
                include: [
                    {
                        model: models.accountStoreMapping,
                        as: 'defaultAccountStoreMapping',
                        attributes: ['accountStoreId'],
                        required: true,
                        where: { accountStoreType: 'directory' }
                    },
                    {
                        model: models.accountLinkingPolicy,
                        attributes: ['status', 'automaticProvisioning'],
                        required: true,
                        where: {status: 'ENABLED'}
                    }
                ]
            }
    ))
    //return the authenticated account if it belongs to the default directory
    .filter(application => application.defaultAccountStoreMapping.accountStoreId !== account.directoryId)
    .map(async application =>
        //look for a linked account in the default directory
        Optional.ofNullable (
            await account.getLinkedAccounts({
                where: { directoryId: application.defaultAccountStoreMapping.accountStoreId },
                limit: 1
            })
        )
        .map(_.head)
        .orElseGet(() =>
            //no linked account, create one if automatic provisioning is enabled
            Optional.of(application.accountLinkingPolicy)
                .filter(alp => alp.automaticProvisioning === 'ENABLED')
                .map(async () => {
                    const linkedAccount = (await models.account.findOrCreate({
                        where: {
                            email: account.email,
                            directoryId: application.defaultAccountStoreMapping.accountStoreId
                        },
                        defaults: _.omit(account.dataValues, ['id', 'directoryId', 'createdAt', 'modifiedAt'])
                    }))[0];
                    await models.accountLink.create({
                        leftAccountId: account.id,
                        rightAccountId: linkedAccount.id,
                        tenantId: linkedAccount.tenantId
                    });
                    return linkedAccount;
                })
                .orElse(account)
        )
    )
    .orElse(account);
/* jshint ignore:end */