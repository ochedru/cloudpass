const assert = require("assert");
const init = require('./init');
const BluebirdPromise = require('sequelize').Promise;

describe('Account workflows', function () {
    let directory;
    let mailServer;
    before(function () {
        //start the SMTP server
        mailServer = init.getMailServer();
        //get a directory and its account creation policy
        return init.getRequest('tenants/' + init.apiKey.tenantId + '/directories')
            .query({
                name: 'Cloudpass Administrators',
                limit: 1,
                expand: 'accountCreationPolicy,passwordPolicy,applications'
            })
            .expect(200)
            .then(function (res) {
                directory = res.body.items[0];
            });
    });

    after(function () {
        //stop the SMTP server
        mailServer.stop();
    });

    describe('Registration', function () {

        it('Welcome e-mail should be sent if they are enabled', function () {
            //enable the welcome email
            return BluebirdPromise.resolve(
                init.postRequest('accountCreationPolicies/' + directory.accountCreationPolicy.id)
                    .send({
                        verificationEmailStatus: 'DISABLED',
                        verificationSuccessEmailStatus: 'DISABLED',
                        welcomeEmailStatus: 'ENABLED'
                    })
                    .expect(200)
            )
                .then(function () {
                    const address = init.randomName() + '@example.com';
                    return BluebirdPromise.join(
                        init.getEmailPromise(mailServer, address.toLowerCase()),
                        init.postRequest('directories/' + directory.id + '/accounts')
                            .send({
                                email: address,
                                password: 'Aa123456',
                                givenName: init.randomName(),
                                surname: init.randomName()
                            })
                            .expect(200)
                    );
                })
                .spread(function (email, res) {
                    assert.strictEqual(email.headers.subject, 'Your registration was successful');
                    assert.strictEqual(res.body.status, 'ENABLED');
                });
        });

        it('Verification and verification success emails should be sent if they are enabled', function () {
            //enable the verification and verification success emails
            return BluebirdPromise.resolve(
                init.postRequest('accountCreationPolicies/' + directory.accountCreationPolicy.id)
                    .send({
                        verificationEmailStatus: 'ENABLED',
                        verificationSuccessEmailStatus: 'ENABLED',
                        welcomeEmailStatus: 'DISABLED'
                    })
                    .expect(200)
            )
                .then(function () {
                    const address = init.randomName() + '@example.com';
                    return BluebirdPromise.join(
                        init.getEmailPromise(mailServer, address.toLowerCase()),
                        init.postRequest('directories/' + directory.id + '/accounts')
                            .send({
                                email: address,
                                password: 'Aa123456',
                                givenName: init.randomName(),
                                surname: init.randomName()
                            })
                            .expect(200)
                    );
                })
                .spread(function (email, res) {
                    assert.strictEqual(email.headers.subject, 'Verify your account');
                    assert.strictEqual(res.body.status, 'UNVERIFIED');
                    //ask to resend the email
                    return BluebirdPromise.join(
                        init.getEmailPromise(mailServer, res.body.email),
                        init.postRequest('applications/' + directory.applications.items[0].id + '/verificationEmails')
                            .send({login: res.body.email})
                            .expect(204)
                    );
                })
                .spread(function (email, res) {
                    assert.strictEqual(email.headers.subject, 'Verify your account');
                    const tokenId = /cpToken=(.*?)\n/.exec(email.body)[1];
                    return BluebirdPromise.join(
                        init.getEmailPromise(mailServer, email.headers.to),
                        init.postRequest('accounts/emailVerificationTokens/' + tokenId)
                            .query({expand: 'account'})
                            .expect(200)
                    );
                })
                .spread(function (email, res) {
                    assert.strictEqual(email.headers.subject, 'Your account has been confirmed');
                    assert.strictEqual(res.body.status, 'ENABLED');
                });
        });

        it('Registration workflow must be disabled if explicitly required', function () {
            return init.postRequest('accountCreationPolicies/' + directory.accountCreationPolicy.id)
                .send({
                    verificationEmailStatus: 'ENABLED',
                    verificationSuccessEmailStatus: 'DISABLED',
                    welcomeEmailStatus: 'DISABLED'
                })
                .expect(200)
                .then(function () {
                    return init.postRequest('directories/' + directory.id + '/accounts')
                        .query({registrationWorkflowEnabled: false})
                        .send({
                            email: init.randomName() + '@example.com',
                            password: 'Aa123456',
                            givenName: init.randomName(),
                            surname: init.randomName()
                        })
                        .expect(200);
                })
                .then(function (res) {
                    //the account should be directly enabled
                    assert.strictEqual(res.body.status, 'ENABLED');
                });
        });
    });

    describe('Password reset', function () {

        let account;

        before(function () {
            return init.getRequest('directories/' + directory.id + '/accounts')
                .expect(200)
                .then(function (res) {
                    account = res.body.items[0];
                });
        });

        it('Password reset and password reset success email should be sent if they are enabled', function () {
            //enable password workflows
            return BluebirdPromise.resolve(
                init.postRequest('passwordPolicies/' + directory.passwordPolicy.id)
                    .send({
                        resetEmailStatus: 'ENABLED',
                        resetSuccessEmailStatus: 'ENABLED'
                    })
                    .expect(200)
            )
                .then(function () {
                    //send a password reset request
                    return BluebirdPromise.join(
                        init.getEmailPromise(mailServer, account.email),
                        init.postRequest('applications/' + directory.applications.items[0].id + '/passwordResetTokens')
                            .send({email: account.email})
                            .expect(200)
                    );
                })
                .spread(function (email, res) {
                    assert.strictEqual(email.headers.subject, 'Reset your Password');
                    assert.strictEqual(/cpToken=(.*?)\n/.exec(email.body)[1], res.body.id);
                    //check if the token is valid
                    return init.getRequest('applications/' + directory.applications.items[0].id + '/passwordResetTokens/' + res.body.id)
                        .expect(200);
                })
                .then(function (res) {
                    //consume the token
                    return BluebirdPromise.join(
                        init.getEmailPromise(mailServer, account.email),
                        init.postRequest('applications/' + directory.applications.items[0].id + '/passwordResetTokens/' + res.body.id)
                            .send({password: 'Aa123456'})
                            .expect(200)
                    );
                })
                .spread(function (email, res) {
                    assert.strictEqual(email.headers.subject, 'Your password has been changed');
                    assert(res.body.account);
                    assert(res.body.account.href);
                });
        });

        it('Password resets should fail if they are disabled', function () {
            //disable password workflows
            return init.postRequest('passwordPolicies/' + directory.passwordPolicy.id)
                .send({
                    resetEmailStatus: 'DISABLED',
                    resetSuccessEmailStatus: 'DISABLED'
                })
                .expect(200)
                .then(function () {
                    //send a password reset request
                    return init.postRequest('applications/' + directory.applications.items[0].id + '/passwordResetTokens')
                        .send({email: account.email})
                        .expect(400);
                })
                .then(function (res) {
                    assert.strictEqual(res.body.status, 400);
                    assert.strictEqual(res.body.code, 400);
                });
        });
    });
});