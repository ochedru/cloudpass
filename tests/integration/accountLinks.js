const assert = require('assert');
const BluebirdPromise = require('sequelize').Promise;
const init = require('./init');

describe('account links', () => {
    let application;
    let defaultDirectoryId;
    let otherDirectoryId;
    let defaultDirectoryAccount;
    let otherDirectoryAccount;

    before(async () => {
        //create application & default directory
        application = (
            await init.postRequest('applications')
                .query({createDirectory: 'true', expand: 'directories'})
                .send({name: init.randomName()})
                .expect(200)
        ).body;
        defaultDirectoryId = application.directories.items[0].id;

        //create another directory and link it to the application
        otherDirectoryId = (
            await init.postRequest('directories')
                .send({name: init.randomName()})
                .expect(200)
        ).body.id;
        await init.postRequest('accountStoreMappings')
            .send({
                application: {href: `/applications/${application.id}`},
                accountStore: {href: `/directories/${otherDirectoryId}`},
                isDefaultAccountStore: false
            })
            .expect(200);

        //create an account in both directories
        defaultDirectoryAccount = (
            await init.postRequest(`directories/${defaultDirectoryId}/accounts`)
                .send({
                    email: 'test1@example.com',
                    password: 'Aa123456',
                    givenName: init.randomName(),
                    surname: init.randomName()
                })
                .expect(200)
        ).body;
        otherDirectoryAccount = (
            await init.postRequest(`directories/${otherDirectoryId}/accounts`)
                .send({
                    email: 'test2@example.com',
                    password: 'Aa123456',
                    givenName: init.randomName(),
                    surname: init.randomName()
                })
                .expect(200)
        ).body;
    });

    describe('Manual Account linking', () => {
        it('Links should be symetrical', async () => {
            await init.postRequest('accountLinks')
                .send({
                    leftAccount: defaultDirectoryAccount,
                    rightAccount: otherDirectoryAccount
                })
                .expect(200);
            assert.strictEqual((await (init.getRequest(`accounts/${defaultDirectoryAccount.id}/accountLinks`).expect(200))).body.size, 1);
            assert.strictEqual((await (init.getRequest(`accounts/${otherDirectoryAccount.id}/accountLinks`).expect(200))).body.size, 1);

            const defaultDirectoryAccountLinkedAccounts = (await (init.getRequest(`accounts/${defaultDirectoryAccount.id}/linkedAccounts`).expect(200))).body;
            assert.strictEqual(defaultDirectoryAccountLinkedAccounts.size, 1);
            assert.strictEqual(defaultDirectoryAccountLinkedAccounts.items[0].id, otherDirectoryAccount.id);

            const otherDirectoryAccountLinkedAccounts = (await (init.getRequest(`accounts/${otherDirectoryAccount.id}/linkedAccounts`).expect(200))).body;
            assert.strictEqual(otherDirectoryAccountLinkedAccounts.size, 1);
            assert.strictEqual(otherDirectoryAccountLinkedAccounts.items[0].id, defaultDirectoryAccount.id);
        });
    });

    describe('Login with account linking policy disabled', () => {
        it('should return the initial account', async () => {
            assert.strictEqual(
                (
                    await init.postRequest(`applications/${application.id}/loginAttempts`)
                        .query({expand: 'account'})
                        .send({
                            type: 'basic',
                            value: Buffer.from('test2@example.com:Aa123456', 'utf8').toString('base64')
                        })
                        .expect(200)
                ).body.id,
                otherDirectoryAccount.id
            );
        });
    });

    describe('Login with account linking policy enabled and without automatic provisioning', () => {
        before(() => init.postRequest(`accountLinkingPolicies/${application.accountLinkingPolicyId}`)
            .send({status: "ENABLED"})
            .expect(200));

        it('should return the linked account if the initial account is not in the default account store', async () => {
            assert.strictEqual(
                (
                    await init.postRequest(`applications/${application.id}/loginAttempts`)
                        .query({expand: 'account'})
                        .send({
                            type: 'basic',
                            value: Buffer.from('test2@example.com:Aa123456', 'utf8').toString('base64')
                        })
                        .expect(200)
                ).body.id,
                defaultDirectoryAccount.id
            );
        });

        it('should return the initial account if it is in the default account store', async () => {
            assert.strictEqual(
                (
                    await init.postRequest(`applications/${application.id}/loginAttempts`)
                        .query({expand: 'account'})
                        .send({
                            type: 'basic',
                            value: Buffer.from('test1@example.com:Aa123456', 'utf8').toString('base64')
                        })
                        .expect(200)
                ).body.id,
                defaultDirectoryAccount.id
            );
        });

        it('should return the inital account if not linked account exists in the default account store', async () => {
            await init.deleteRequest(`accountLinks/${(await (init.getRequest('accounts/' + defaultDirectoryAccount.id + '/accountLinks').expect(200))).body.items[0].id}`)
                .expect(204);
            assert.strictEqual(
                (
                    await init.postRequest(`applications/${application.id}/loginAttempts`)
                        .query({expand: 'account'})
                        .send({
                            type: 'basic',
                            value: Buffer.from('test2@example.com:Aa123456', 'utf8').toString('base64')
                        })
                        .expect(200)
                ).body.id,
                otherDirectoryAccount.id
            );
        });

    });

    describe('Login with account linking policy and automatic provisioning enabled ', () => {
        before(() => init.postRequest(`accountLinkingPolicies/${application.accountLinkingPolicyId}`)
            .send({automaticProvisioning: "ENABLED"})
            .expect(200));

        it('should create and return linked account in the default account store', async () => {
            let loggedInAccount = (
                await init.postRequest(`applications/${application.id}/loginAttempts`)
                    .query({expand: 'account'})
                    .send({
                        type: 'basic',
                        value: Buffer.from('test2@example.com:Aa123456', 'utf8').toString('base64')
                    })
                    .expect(200)
            ).body;

            assert.notStrictEqual(loggedInAccount.id, otherDirectoryAccount.id);
            assert.notStrictEqual(loggedInAccount.id, defaultDirectoryAccount.id);
            assert.strictEqual(loggedInAccount.directoryId, defaultDirectoryId);
            assert.strictEqual(loggedInAccount.email, otherDirectoryAccount.email);
            assert.strictEqual(loggedInAccount.givenName, otherDirectoryAccount.givenName);
            assert.strictEqual(loggedInAccount.surname, otherDirectoryAccount.surname);

            const otherDirectoryAccountLinkedAccounts = (await (init.getRequest('accounts/' + otherDirectoryAccount.id + '/linkedAccounts').expect(200))).body;
            assert.strictEqual(otherDirectoryAccountLinkedAccounts.size, 1);
            assert.strictEqual(otherDirectoryAccountLinkedAccounts.items[0].id, loggedInAccount.id);
        });
    });
});