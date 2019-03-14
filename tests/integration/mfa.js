"use strict";

const assert = require("assert");
const speakeasy = require("speakeasy");
const init = require('./init');

describe('Multi-factor authentication', function () {

    let account;
    before(function () {
        //get the admin directory
        return init.getRequest('tenants/' + init.apiKey.tenantId + '/directories')
            .query({name: 'Cloudpass Administrators', limit: 1, expand: 'accountCreationPolicy'})
            .expect(200)
            .then(function (res) {
                //create an account
                return init.postRequest('accountCreationPolicies/' + res.body.items[0].accountCreationPolicy.id)
                    .send({welcomeEmailStatus: 'DISABLED'})
                    .expect(200)
                    .then(function () {
                        return init.postRequest('directories/' + res.body.items[0].id + '/accounts')
                            .query({registrationWorkflowEnabled: false})
                            .send({
                                email: init.randomName() + '@example.com',
                                password: 'Aa123456',
                                givenName: init.randomName(),
                                surname: init.randomName()
                            })
                            .expect(200);
                    });

            })
            .then(function (res) {
                account = res.body;
            });
        ;
    });

    describe('Factor creation', function () {
        it('With account name', function () {
            let accountName = init.randomName() + '@example.com';
            return init.postRequest('accounts/' + account.id + '/factors')
                .send({
                    type: 'google-authenticator',
                    accountName,
                    issuer: init.randomName()
                })
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.type, 'google-authenticator');
                    assert.strictEqual(res.body.status, 'ENABLED');
                    assert.strictEqual(res.body.verificationStatus, 'UNVERIFIED');
                    assert.strictEqual(res.body.accountName, accountName);
                    assert(res.body.issuer);
                    assert(res.body.secret);
                    assert(res.body.keyUri);
                    assert(res.body.base64QRImage);
                });
        });

        it('Without account name', function () {
            return init.postRequest('accounts/' + account.id + '/factors')
                .send({type: 'google-authenticator'})
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.type, 'google-authenticator');
                    assert.strictEqual(res.body.accountName, account.email);
                });
        });

        it('With invalid type', function () {
            return init.postRequest('accounts/' + account.id + '/factors')
                .send({type: 'foo'})
                .expect(400);
        });

    });

    describe('Factor verification', function () {

        let factor;

        before(function () {
            return init.postRequest('accounts/' + account.id + '/factors')
                .send({type: 'google-authenticator'})
                .expect(200)
                .then(function (res) {
                    factor = res.body;
                });
        });

        it('Challenge creation', function () {
            return init.postRequest('factors/' + factor.id + '/challenges')
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.status, 'CREATED');
                });
        });

        it('Challenge verification failure', function () {
            return init.postRequest('factors/' + factor.id + '/challenges')
                .send({code: init.randomName()})
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.status, 'FAILED');
                    //the factor should still be unverified
                    return init.getRequest('factors/' + factor.id)
                        .expect(200)
                        .then(function (res) {
                            assert.strictEqual(res.body.verificationStatus, 'UNVERIFIED');
                        });
                });
        });

        it('Challenge verification success', function () {
            return init.postRequest('factors/' + factor.id + '/challenges')
                .send({code: speakeasy.totp({secret: factor.secret, encoding: 'base32'})})
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.status, 'SUCCESS');
                    //the factor should now be verified
                    return init.getRequest('factors/' + factor.id)
                        .expect(200)
                        .then(function (res) {
                            assert.strictEqual(res.body.verificationStatus, 'VERIFIED');
                        });
                });
        });
    });
});
