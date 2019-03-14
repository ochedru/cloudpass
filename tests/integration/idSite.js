'use strict';

const assert = require("assert");
const BluebirdPromise = require('sequelize').Promise;
const jwt = require('jsonwebtoken');
const request = require('supertest');
const speakeasy = require("speakeasy");
const init = require('./init');

describe('idSite', () => {
    let applicationId;
    const idSiteUrl = 'http://www.example.com';
    const callbackUrl = 'http://www.example.com/callback';
    let mailServer;

    before(() => {
        //start the SMTP server
        mailServer = init.getMailServer();
        //set the ID site URL
        return init.getRequest('tenants/' + init.apiKey.tenantId + '/idSites')
            .query({limit: 1})
            .expect(200)
            .then(res =>
                init.postRequest('idSites/' + res.body.items[0].id)
                    .send({
                        url: idSiteUrl,
                        authorizedRedirectURIs: ['*://*.example.com/*']
                    })
                    .expect(200)
            ).then(() =>
                //get the admin application
                init.getRequest('tenants/' + init.apiKey.tenantId + '/applications')
                    .query({name: 'Cloudpass', limit: 1, expand: 'defaultAccountStoreMapping'})
                    .expect(200)
                    .then(res => {
                        applicationId = res.body.items[0].id;
                        return init.getRequest('directories/' + res.body.items[0].defaultAccountStoreMapping.accountStoreId)
                            .query({expand: 'passwordPolicy,accountCreationPolicy'})
                            .expect(200);
                    })
                    .then(res =>
                        //enable password reset workflow
                        init.postRequest('passwordPolicies/' + res.body.passwordPolicy.id)
                            .send({
                                resetEmailStatus: 'ENABLED',
                                resetSuccessEmailStatus: 'ENABLED'
                            })
                            .expect(200)
                            .then(() =>
                                init.postRequest('accountCreationPolicies/' + res.body.accountCreationPolicy.id)
                                    .send({verificationEmailStatus: 'ENABLED'})
                                    .expect(200)
                            )
                    )
            );
    });

    after(() => {
        //stop the SMTP server
        mailServer.stop();
    });

    function createAccount() {
        const account = {
            email: init.randomName() + '@example.com',
            password: 'Aa123456',
            givenName: init.randomName(),
            surname: init.randomName()
        };
        return init.postRequest('applications/' + applicationId + '/accounts')
            .query({registrationWorkflowEnabled: false})
            .send(account)
            .expect(200)
            .then(res => {
                account.id = res.body.id;
                account.directoryId = res.body.directoryId;
                return account;
            });
    }

    describe('login', () => {
        let account;
        before(() => createAccount().then(a => account = a));

        it('in application', () =>
            init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl})
                .then(bearer =>
                    request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                        .set('authorization', 'Bearer ' + bearer)
                        .send({
                            type: 'basic',
                            value: Buffer.from(account.email + ':' + account.password, 'utf8').toString('base64')
                        })
                        .expect(200)
                )
                .then(res => {
                    //there should be a redirection URL in the headers
                    assert(res.header['stormpath-sso-redirect-location']);
                    return request(res.header['stormpath-sso-redirect-location']).get('')
                        .expect(302);
                })
                .then(res => {
                    //cloudpass should redirect us back to the application
                    //and set a cookie for subsequent logins
                    assert(res.header.location);
                    assert(res.header.location.startsWith(callbackUrl + '?jwtResponse='));
                    assert(res.header['set-cookie']);
                    return BluebirdPromise.join(
                        init.getIdSiteJwtRequest(applicationId, {cb_uri: callbackUrl}),
                        res.header['set-cookie'][0].split(';')[0]
                    );
                })
                .spread((jwtRequest, cookie) =>
                    BluebirdPromise.join(
                        //send a a new request with the cookie
                        request(init.servers.main).get('/sso')
                            .query({jwtRequest: jwtRequest})
                            .set('Cookie', cookie)
                            .expect(302),
                        cookie
                    )
                )
                .spread((res, cookie) => {
                    //cloudpass should redirect directly to the callback URL, not to the ID site
                    assert(res.header.location);
                    assert(res.header.location.startsWith(callbackUrl + '?jwtResponse='));
                    return BluebirdPromise.join(
                        init.getIdSiteJwtRequest(applicationId, {
                            cb_uri: callbackUrl,
                            require_mfa: ['google-authenticator']
                        }),
                        cookie
                    );
                })
                .spread((jwtRequest, cookie) =>
                    //send a a new request requiring MFA with the cookie
                    request(init.servers.main).get('/sso')
                        .query({jwtRequest: jwtRequest})
                        .set('Cookie', cookie)
                        .expect(302)
                )
                .then(res => {
                    //cloudpass should redirect to ID site because no 2nd factor has been provided yet
                    assert(res.header.location);
                    assert(res.header.location.startsWith(idSiteUrl + '/#/?jwt='));
                })
        );

        describe('with organization requested', () => {
            it('belonging to no organization', () =>
                init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl, ros: true})
                    .then(bearer =>
                        request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                            .set('authorization', 'Bearer ' + bearer)
                            .send({
                                type: 'basic',
                                value: Buffer.from(account.email + ':' + account.password, 'utf8').toString('base64')
                            })
                            .expect(200)
                    )
                    .then(res => {
                        //no organization, we are redirected to the application
                        assert(res.header['stormpath-sso-redirect-location']);
                        return request(res.header['stormpath-sso-redirect-location']).get('')
                            .expect(302);
                    })
                    .then(res => {
                        //cloudpass should redirect us back to the application with org_id = null
                        const locationPrefix = callbackUrl + '?jwtResponse=';
                        assert(res.header.location.startsWith(locationPrefix));
                        assert.strictEqual(jwt.decode(res.header.location.substring(locationPrefix.length)).org_href, null);
                    })
            );

            it('belonging to a single organization', () => {
                //create an organization and map it the the directory
                let organizationId;
                return init.postRequest('organizations')
                    .send({name: init.randomName()})
                    .expect(200)
                    .then(res => {
                        organizationId = res.body.id;
                        return init.postRequest('organizationAccountStoreMappings')
                            .send({
                                accountStore: {href: '/directories/' + account.directoryId},
                                organization: {href: '/organizations/' + res.body.id}
                            })
                            .expect(200);
                    })
                    .then(() => init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl, ros: true}))
                    .then(bearer =>
                        request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                            .set('authorization', 'Bearer ' + bearer)
                            .send({
                                type: 'basic',
                                value: Buffer.from(account.email + ':' + account.password, 'utf8').toString('base64')
                            })
                            .expect(200)
                    )
                    .then(res => {
                        //only one organization, we should be redirected to the application
                        assert(res.header['stormpath-sso-redirect-location']);
                        return request(res.header['stormpath-sso-redirect-location']).get('')
                            .expect(302);
                    })
                    .then(res => {
                        //cloudpass should redirect us back to the application with org_id set to the ID of the organization
                        const locationPrefix = callbackUrl + '?jwtResponse=';
                        assert(res.header.location.startsWith(locationPrefix));
                        assert.strictEqual(jwt.decode(res.header.location.substring(locationPrefix.length)).org_href, '/organizations/' + organizationId);
                    });
            });

            it('belonging to multiple organizations', () => {
                //create a second organization and map it the the directory
                let organizationId;
                return init.postRequest('organizations')
                    .send({name: init.randomName()})
                    .expect(200)
                    .then(res => {
                        organizationId = res.body.id;
                        return init.postRequest('organizationAccountStoreMappings')
                            .send({
                                accountStore: {href: '/directories/' + account.directoryId},
                                organization: {href: '/organizations/' + res.body.id}
                            })
                            .expect(200);
                    })
                    .then(() => init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl, ros: true}))
                    .then(bearer =>
                        request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                            .set('authorization', 'Bearer ' + bearer)
                            .send({
                                type: 'basic',
                                value: Buffer.from(account.email + ':' + account.password, 'utf8').toString('base64')
                            })
                            .expect(200)
                    )
                    .then(res => {
                        //two organizations, we should not be redirected to the application before choosing one
                        assert.strictEqual(res.header['stormpath-sso-redirect-location'], undefined);
                        //we should be able to retrieve the list of available organizations
                        return request(init.servers.main).get('/v1' + res.body.account.href + '/organizations')
                            .set('authorization', res.header.authorization)
                            .expect(200);

                    })
                    .then(res => {
                        assert.strictEqual(res.body.size, 2);
                        return request(init.servers.main).post('/v1/accounts/' + account.id + '/organizations/' + organizationId)
                            .set('authorization', res.header.authorization)
                            .expect(200);
                    })
                    .then(res => {
                        //we should now be redirected to the application
                        assert(res.header['stormpath-sso-redirect-location']);
                        return request(res.header['stormpath-sso-redirect-location']).get('')
                            .expect(302);
                    })
                    .then(res => {
                        //cloudpass should redirect us back to the application with org_id set to the ID of the selected organization
                        const locationPrefix = callbackUrl + '?jwtResponse=';
                        assert(res.header.location.startsWith(locationPrefix));
                        assert.strictEqual(jwt.decode(res.header.location.substring(locationPrefix.length)).org_href, '/organizations/' + organizationId);
                    });
            });
        });

        it('with organization name key', () => {
            //create an organization an map it the the application
            const organizationName = init.randomName();
            let organizationId;
            return init.postRequest('organizations')
                .send({
                    name: organizationName,
                    nameKey: organizationName
                })
                .expect(200)
                .then(res => {
                    organizationId = res.body.id;
                    return init.postRequest('accountStoreMappings')
                        .send({
                            application: {href: '/applications/' + applicationId},
                            accountStore: {href: '/organizations/' + res.body.id}
                        })
                        .expect(200);
                })
                .then(() => init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl, onk: organizationName}))
                .then(bearer =>
                    //the bearer should give access to the organization & its ID site model
                    request(init.servers.main).get('/v1/organizations/' + organizationId)
                        .set('authorization', 'Bearer ' + bearer)
                        .query({expand: 'idSiteModel'})
                        .expect(200)
                        .then(res => {
                            assert.strictEqual(res.body.name, organizationName);
                            assert(res.body.idSiteModel.hasOwnProperty('providers'));
                            assert(res.body.idSiteModel.hasOwnProperty('passwordPolicy'));
                            assert(res.body.idSiteModel.hasOwnProperty('logoUrl'));
                        })
                        .then(() => bearer)
                )
                .then(bearer =>
                    //Cloudpass should return a 400 because the account is not in this organization
                    request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                        .set('authorization', 'Bearer ' + bearer)
                        .send({
                            type: 'basic',
                            value: Buffer.from('test@example.com:Aa123456', 'utf8').toString('base64')
                        })
                        .expect(400)
                );
        });

        describe('MFA', () => {
            let secret;

            function getConfiguredFactors(requireMfa) {
                return init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl, require_mfa: requireMfa})
                    .then(bearer =>
                        request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                            .set('authorization', 'Bearer ' + bearer)
                            .send({
                                type: 'basic',
                                value: Buffer.from(account.email + ':' + account.password, 'utf8').toString('base64')
                            })
                            .expect(200)
                    )
                    .then(res => {
                        //there shouldn't be a redirection URL in the headers
                        assert(!res.header['stormpath-sso-redirect-location']);
                        assert(res.header.authorization);

                        //we should be able to retrieve the list of 2nd factors with the new bearer
                        return request(init.servers.main).get('/v1' + res.body.account.href + '/factors')
                            .set('authorization', res.header.authorization)
                            .expect(200);
                    });
            }

            it('with new second factor', () =>
                //require google authenticator mfa in login
                getConfiguredFactors(['google-authenticator'])
                    .then(res => {
                        //no 2nd factor configured yet
                        assert.strictEqual(res.body.size, 0);
                        //add one
                        return request(init.servers.main).post('/v1' + res.body.href)
                            .set('authorization', res.header.authorization)
                            .send({
                                type: 'google-authenticator',
                                issuer: init.randomName()
                            })
                            .expect(200);
                    })
                    .then(res => {
                        assert.strictEqual(res.body.verificationStatus, 'UNVERIFIED');
                        secret = res.body.secret;
                        //verify the factor
                        return request(init.servers.main).post('/v1/factors/' + res.body.id + '/challenges')
                            .set('authorization', res.header.authorization)
                            .send({code: speakeasy.totp({secret: secret, encoding: 'base32'})})
                            .expect(200);
                    })
                    .then(res => {
                        //there should be a redirection URL in the headers
                        assert(res.header['stormpath-sso-redirect-location']);
                        return request(res.header['stormpath-sso-redirect-location']).get('')
                            .expect(302);
                    })
            );

            it('with existing second factor', () =>
                //don't require google-authenticator MFA in login
                //it should be asked for anyway because it has been configured
                getConfiguredFactors()
                    .then(res => {
                        //one second factor has already been configured
                        assert.strictEqual(res.body.size, 1);
                        //secret should no be exposed
                        assert(!res.body.items[0].secret);
                        assert(!res.body.items[0].keyUri);
                        assert(!res.body.items[0].base64QRImage);

                        return request(init.servers.main).post('/v1/factors/' + res.body.items[0].id + '/challenges')
                            .set('authorization', res.header.authorization)
                            .expect(200);
                    })
                    .then(res => {
                        assert.strictEqual(res.body.status, 'CREATED');
                        //verify the factor
                        return request(init.servers.main).post('/v1/challenges/' + res.body.id)
                            .set('authorization', res.header.authorization)
                            .send({code: speakeasy.totp({secret: secret, encoding: 'base32'})})
                            .expect(200);
                    })
                    .then(res => {
                        //there should be a redirection URL in the headers
                        assert(res.header['stormpath-sso-redirect-location']);
                        return request(res.header['stormpath-sso-redirect-location']).get('')
                            .expect(302);
                    })
                    .then(res =>
                        //the cookie should give us the right to not re-enter a second factor next time
                        BluebirdPromise.join(
                            init.getIdSiteJwtRequest(applicationId, {cb_uri: callbackUrl}),
                            res.header['set-cookie'][0].split(';')[0]
                        )
                    )
                    .spread((jwtRequest, cookie) =>
                        //send a a new request with the cookie
                        request(init.servers.main).get('/sso')
                            .query({jwtRequest: jwtRequest})
                            .set('Cookie', cookie)
                            .expect(302)
                    )
                    .then(res => {
                        //cloudpass should redirect directly to the callback URL, not to the ID site
                        assert(res.header.location);
                        assert(res.header.location.startsWith(callbackUrl + '?jwtResponse='));
                    })
            );
        });

        it('with unauthorized redirect URL', () =>
            init.getIdSiteJwtRequest(applicationId, {cb_uri: 'http://www.example2.com/callback'})
                .then(jwtRequest =>
                    request(init.servers.main).get('/sso')
                        .query({jwtRequest})
                        .expect(400)
                )
        );
    });

    it('logout', () =>
        init.getIdSiteJwtRequest(applicationId, {cb_uri: callbackUrl})
            .then(jwtRequest =>
                request(init.servers.main).get('/sso/logout')
                    .query({jwtRequest})
                    .expect(302)
            )
            .then(res => {
                assert(res.header.location);
                assert(res.header.location.startsWith(idSiteUrl + '/#/logoutSuccess'));
                assert(res.header['set-cookie']);
                //cookie should be empty
                assert.strictEqual(res.header['set-cookie'][0].split(';')[0].split('=')[1], '');
            })
    );

    it('password reset', () =>
        init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl})
            .then(bearer =>
                BluebirdPromise.join(
                    init.getEmailPromise(mailServer, init.adminUser),
                    request(init.servers.main).post('/v1/applications/' + applicationId + '/passwordResetTokens')
                        .set('authorization', 'Bearer ' + bearer)
                        .send({email: init.adminUser})
                        .expect(200)
                )
            )
            .spread(email => {
                let jwtParam = /\/#\/reset\?jwt=(.*?)\n/.exec(email.body)[1];
                assert(jwtParam);
                let tokenId = jwt.decode(jwtParam).sp_token;
                assert(tokenId);
                return BluebirdPromise.join(
                    init.getEmailPromise(mailServer, init.adminUser),
                    request(init.servers.main).post('/v1/applications/' + applicationId + '/passwordResetTokens/' + tokenId)
                        .set('authorization', 'Bearer ' + jwtParam)
                        .send({password: init.adminPassword})
                        .expect(200)
                );
            })
            .spread(email => assert.strictEqual(email.headers.subject, 'Your password has been changed'))
    );

    it('email verification', () => {
        const address = init.randomName() + '@example.com';
        return init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl})
            .then(bearer =>
                BluebirdPromise.join(
                    init.getEmailPromise(mailServer, address.toLowerCase()),
                    request(init.servers.main).post('/v1/applications/' + applicationId + '/accounts')
                        .set('authorization', 'Bearer ' + bearer)
                        .send({
                            email: address,
                            password: 'Aa123456',
                            givenName: init.randomName(),
                            surname: init.randomName()
                        })
                        .expect(200)
                )
                    .spread((email, res) => {
                        assert.strictEqual(res.body.status, 'UNVERIFIED');
                        const jwtParam = /\/#\/verify\?jwt=(.*?)\n/.exec(email.body)[1];
                        assert(jwtParam);
                        const tokenId = jwt.decode(jwtParam).sp_token;
                        assert(tokenId);
                        return request(init.servers.main).post('/v1/accounts/emailVerificationTokens/' + tokenId)
                            .set('authorization', 'Bearer ' + jwtParam)
                            .expect(200);
                    })
            );
    });

    it('Requests with bearer authorization must have a limited scope', () =>
        init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl})
            .then(bearer =>
                request(init.servers.main).get('/v1/applications/' + applicationId + '/accounts')
                    .set('authorization', 'Bearer ' + bearer)
                    .expect(403)
            )
    );

    it('ID site model must be exposed by applications', () =>
        init.getRequest('applications/' + applicationId + '/idSiteModel')
            .expect(200)
            .then(res => {
                assert(res.body.hasOwnProperty('providers'));
                assert(res.body.hasOwnProperty('passwordPolicy'));
                assert(res.body.hasOwnProperty('logoUrl'));
            })
    );

    describe('Settings', () => {

        let account;
        before(() => createAccount().then(a => account = a));

        function getSettingsBearer() {
            return init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl})
            //login
                .then(bearer => request(init.servers.main).post('/v1/applications/' + applicationId + '/loginAttempts')
                    .set('authorization', 'Bearer ' + bearer)
                    .send({
                        type: 'basic',
                        value: Buffer.from(account.email + ':' + account.password, 'utf8').toString('base64')
                    })
                    .expect(200)
                )
                .then(res => request(res.header['stormpath-sso-redirect-location']).get('').expect(302))
                .then(res => BluebirdPromise.join(
                    init.getIdSiteJwtRequest(applicationId, {cb_uri: callbackUrl, path: '/#/settings'}),
                    res.header['set-cookie'][0].split(';')[0]
                ))
                //send a a new request to access settings with the cookie
                .spread((jwtRequest, cookie) =>
                    request(init.servers.main).get('/sso')
                        .query({jwtRequest: jwtRequest})
                        .set('Cookie', cookie)
                        .expect(302)
                )
                .then(res => {
                    const fragmentStart = '/#/settings?jwt=';
                    assert(res.header.location.indexOf(fragmentStart) >= 0);
                    return res.header.location.substring(res.header.location.indexOf(fragmentStart) + fragmentStart.length);
                });
        }

        it('Password Change', () =>
            getSettingsBearer()
            //this bearer should give access to the /passwordChanges endpoint
                .then(bearer => request(init.servers.main).post('/v1/accounts/' + account.id + '/passwordChanges')
                    .set('authorization', 'Bearer ' + bearer)
                    .send({
                        currentPassword: '123456',
                        newPassword: 'Aa123456'
                    })
                    .expect(400)
                )
                //the password change must be refused if the current password is incorrect
                .then(res => {
                    assert.strictEqual(res.body.code, 7100);
                    return request(init.servers.main).post('/v1/accounts/' + account.id + '/passwordChanges')
                        .set('authorization', res.get('authorization'))
                        .send({
                            currentPassword: account.password,
                            newPassword: '1'
                        })
                        .expect(400);
                })
                //the password change must be refused if the new password doesn't satisfy password policy
                .then(res => {
                    assert.strictEqual(res.body.code, 2007);
                    return request(init.servers.main).post('/v1/accounts/' + account.id + '/passwordChanges')
                        .set('authorization', res.get('authorization'))
                        .send({
                            currentPassword: account.password,
                            newPassword: account.password
                        })
                        .expect(204);
                })
        );

        it('MFA configuration', () =>
            getSettingsBearer()
            //this bearer should enable us to create factors
                .then(bearer => request(init.servers.main).post('/v1/accounts/' + account.id + '/factors')
                    .set('authorization', 'Bearer ' + bearer)
                    .send({
                        type: 'google-authenticator',
                        issuer: init.randomName()
                    })
                    .expect(200)
                )
                .then(res => {
                    assert.strictEqual(res.body.verificationStatus, 'UNVERIFIED');
                    //verify the factor
                    return request(init.servers.main).post('/v1/factors/' + res.body.id + '/challenges')
                        .set('authorization', res.header.authorization)
                        .send({code: speakeasy.totp({secret: res.body.secret, encoding: 'base32'})})
                        .expect(200);
                })
                .then(res => {
                    //there shouldn't be a redirection URL in the headers since we already are authentified
                    assert(!res.header['stormpath-sso-redirect-location']);
                    return request(init.servers.main).get('/v1/accounts/' + account.id + '/factors')
                        .set('authorization', res.header.authorization)
                        .expect(200);
                })
                .then(res => {
                    assert.strictEqual(res.body.size, 1);
                    //delete the factor
                    return request(init.servers.main).delete('/v1/factors/' + res.body.items[0].id)
                        .set('authorization', res.header.authorization)
                        .expect(204);
                })
        );
    });
});