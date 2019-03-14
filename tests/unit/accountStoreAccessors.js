const assert = require("assert");
const models = require('../../src/models');
const addAccountStoreAccessors = require('rewire')('../../src/models/helpers/addAccountStoreAccessors');

describe('addAccountStoreAccessors', function () {
    describe('findPaths', function () {
        const findPaths = addAccountStoreAccessors.__get__('findPaths');
        it('should correctly find how two account stores are connected', function () {

            //3 ways to connect an organization to an account
            assert.deepStrictEqual(
                findPaths(models.organization, models.account),
                [
                    //organization -> directory -> group -> account
                    [
                        models.organization.associations.accountStoreMappings,
                        models.organizationAccountStoreMapping.associations.directory,
                        models.directory.associations.groups, models.group.associations.accountMemberships,
                        models.groupMembership.associations.account
                    ],
                    //organization -> directory -> account
                    [
                        models.organization.associations.accountStoreMappings,
                        models.organizationAccountStoreMapping.associations.directory,
                        models.directory.associations.accounts
                    ],
                    //organization -> group -> account
                    [
                        models.organization.associations.accountStoreMappings,
                        models.organizationAccountStoreMapping.associations.group,
                        models.group.associations.accountMemberships,
                        models.groupMembership.associations.account
                    ]
                ]
            );

            //6 ways to connect an account to an application
            assert.deepStrictEqual(
                findPaths(models.account, models.application),
                [
                    // account -> directory -> application
                    [
                        models.account.associations.directory,
                        models.directory.associations.applicationMappings,
                        models.accountStoreMapping.associations.application
                    ],
                    //account -> directory -> organization -> application
                    [
                        models.account.associations.directory,
                        models.directory.associations.organizationMappings,
                        models.organizationAccountStoreMapping.associations.organization,
                        models.organization.associations.applicationMappings,
                        models.accountStoreMapping.associations.application
                    ],
                    //account -> group -> directory -> application
                    [
                        models.account.associations.groupMemberships,
                        models.groupMembership.associations.group,
                        models.group.associations.directory,
                        models.directory.associations.applicationMappings,
                        models.accountStoreMapping.associations.application
                    ],
                    //account -> group -> directory -> organization -> application
                    [
                        models.account.associations.groupMemberships,
                        models.groupMembership.associations.group,
                        models.group.associations.directory,
                        models.directory.associations.organizationMappings,
                        models.organizationAccountStoreMapping.associations.organization,
                        models.organization.associations.applicationMappings,
                        models.accountStoreMapping.associations.application
                    ],
                    //account -> group -> application
                    [
                        models.account.associations.groupMemberships,
                        models.groupMembership.associations.group,
                        models.group.associations.applicationMappings,
                        models.accountStoreMapping.associations.application
                    ],
                    //account -> group -> organization -> application
                    [
                        models.account.associations.groupMemberships,
                        models.groupMembership.associations.group,
                        models.group.associations.organizationMappings,
                        models.organizationAccountStoreMapping.associations.organization,
                        models.organization.associations.applicationMappings,
                        models.accountStoreMapping.associations.application
                    ]
                ]
            );
        });
    });
});