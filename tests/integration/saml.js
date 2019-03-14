const assert = require("assert");
const init = require('./init');
const BluebirdPromise = require('sequelize').Promise;
const jwt = BluebirdPromise.promisifyAll(require('jsonwebtoken'));
const readFile = BluebirdPromise.promisify(require("fs").readFile);
const request = require('supertest');
const url = require('url');

describe('SAML', function(){
    const idpSsoLoginUrl = 'http://idp.example.com/login';
    const idpSsoLogoutUrl = 'http://idp.example.com/logout';
    let directoryId;
    describe('directory creation', function(){
        it('specifying providerId = "saml" should create a SAML directory', function(){
            return readFile(__dirname + '/resources/saml/idp.crt', 'utf8')
                .then(function(idpCertificate){
                    return init.postRequest('directories')
                            .query({expand: 'provider'})
                            .send({
                                name: 'SAML directory',
                                provider: {
                                    providerId: 'saml',
                                    ssoLoginUrl: idpSsoLoginUrl,
                                    ssoLogoutUrl: idpSsoLogoutUrl,
                                    encodedX509SigningCert: idpCertificate
                                }
                            })
                            .expect(200)
                            .then(function (res) {
                                directoryId = res.body.id;
                                assert(res.body.provider);
                                assert.strictEqual(res.body.provider.providerId, 'saml');
                                assert.strictEqual(res.body.provider.ssoLoginUrl, idpSsoLoginUrl);
                                assert.strictEqual(res.body.provider.ssoLogoutUrl, idpSsoLogoutUrl);
                                assert.strictEqual(res.body.provider.encodedX509SigningCert, idpCertificate);
                            });;
                });
        });

    });

    describe('Service Provider Metadata', function(){
        let samlServiceProviderMetadataId;
        before(function(){
            return init.getRequest('directories/' + directoryId + '/provider')
                .query({expand: 'samlServiceProviderMetadata'})
                .expect(200)
                .then(function(res){
                    samlServiceProviderMetadataId = res.body.samlServiceProviderMetadata.id;
                });
        });

        it('Service Provider Metadata should be returned in XML format by default', function(){
            return init.getRequest('samlServiceProviderMetadatas/'+samlServiceProviderMetadataId)
                .accept('*.*')
                .expect(200)
                .then(function(res){
                    assert.strictEqual(res.type, 'application/xml');
                });
        });

        it('Service Provider Metadata should be returned in JSON format if requested', function(){
            return init.getRequest('samlServiceProviderMetadatas/'+samlServiceProviderMetadataId)
                .accept('json')
                .expect(200)
                .then(function(res){
                    assert.strictEqual(res.type, 'application/json');
                    assert(res.body.entityId);
                    assert(res.body.x509SigningCert);
                });
        });
    });

    describe('Attribute Statement Mapping Rules', function(){
        let attributeStatementMappingRulesId;
        before(function(){
            return init.getRequest('directories/' + directoryId + '/provider')
                .query({expand: 'attributeStatementMappingRules'})
                .expect(200)
                .then(function(res){
                    attributeStatementMappingRulesId = res.body.attributeStatementMappingRules.id;
                });
        });

        it('Rules should be initially empty', function(){
            return init.getRequest('attributeStatementMappingRules/'+attributeStatementMappingRulesId)
                    .expect(200)
                    .then(function(res){
                        assert.deepStrictEqual(res.body.items, []);
                    });
        });

        it('Attributes can be mapped to Account and CustomData fields', function(){
            const mappingItems = [
                {
                    name: "firstName",
                    accountAttributes: ['givenName']
                },
                {
                    name: "lastName",
                    accountAttributes: ['surname']
                },
                {
                    name: "company",
                    accountAttributes: ['customData.company']
                }
            ];
            return init.postRequest('attributeStatementMappingRules/'+attributeStatementMappingRulesId)
                    .send({items: mappingItems})
                    .expect(200)
                    .then(function(res){
                        assert.deepStrictEqual(res.body.items, mappingItems);
                    });
        });

        it('Attributes cannot be mapped non-existent Account fields', function(){
            return init.postRequest('attributeStatementMappingRules/'+attributeStatementMappingRulesId)
                    .send({items: [{
                        name:"firstName",
                        accountAttributes: ['foo']
                    }]})
                    .expect(400);
        });
    });

    describe('application', function(){
        let applicationId;
        before(function(){
            //create an application an map it the the SAML directory
            return init.postRequest('applications')
                .send({name: 'SAML application'})
                .expect(200)
                .then(function(res){
                    applicationId = res.body.id;
                    return init.postRequest('accountStoreMappings')
                        .send({
                            application:{href: '/applications/'+applicationId},
                            accountStore:{href: '/directories/'+directoryId}
                        })
                        .expect(200);
                });
        });

        it('application should have a SAML policy', function(){
           return init.getRequest('samlPolicies/'+applicationId)
                .expect(200)
                .then(function(res){
                    assert(res.body.serviceProvider);
                });
        });

        it('application should have a SAML Service Provider', function(){
           return init.getRequest('samlServiceProviders/'+applicationId)
                .expect(200)
                .then(function(res){
                    assert(res.body.ssoInitiationEndpoint);
                    assert(res.body.defaultRelayStates);
                });
        });

        it('ID site model should have a SAML provider', function(){
            return init.getRequest('applications/'+applicationId+'/idSiteModel')
                .expect(200)
                .then(function(res){
                    assert.strictEqual(res.body.providers.length, 1);
                    assert.strictEqual(res.body.providers[0].providerId, 'saml');
                });
        });

        it('default relay state generation', function(){
            return init.postRequest('samlServiceProviders/'+applicationId+'/defaultRelayStates')
                .send({
                    callbackUri: 'http://www.example.com/callback',
                    state: 'foo'
                })
                .expect(200)
                .then(function(res){
                    assert(res.body.defaultRelayState);
                });
        });

        describe('authentication', function(){

            const callbackUrl = 'http://www.example.com/callback';

            function mockIdPResponse(idPRequestUrl, responseFileName, expectedCompanyName){
                assert(idPRequestUrl);
                assert(idPRequestUrl.startsWith(idpSsoLoginUrl));
                const parsed = url.parse(idPRequestUrl, true);
                assert(parsed.query.SAMLRequest);
                assert(parsed.query.RelayState);
                const relayState = parsed.query.RelayState;
                return readFile(__dirname + '/resources/saml/'+responseFileName, 'utf8')
                        .then(function(samlResponse){
                            //mock an IdP response
                            return request(init.servers.main)
                                .post('/v1/directories/'+directoryId+'/saml/sso/post')
                                .send('SAMLResponse='+encodeURIComponent(samlResponse))
                                .send('RelayState='+encodeURIComponent(relayState))
                                .expect(302);
                        })
                        .then(function(res){
                            //we should be redirected to the callback URL
                            assert(res.header.location.startsWith(callbackUrl+'?jwtResponse='));
                            //the account should have been updated from the SAML assertions
                            return init.getRequest('applications/'+applicationId+'/accounts')
                                    .query({expand: 'customData,providerData'})
                                    .expect(200);
                        })
                        .then(function(res){
                            assert.strictEqual(res.body.size, 1);
                            assert.strictEqual(res.body.items[0].email, 'test-saml@example.com');
                            assert.strictEqual(res.body.items[0].givenName, 'John');
                            assert.strictEqual(res.body.items[0].surname, 'Doe');
                            assert.strictEqual(res.body.items[0].passwordAuthenticationAllowed, false);
                            assert.strictEqual(res.body.items[0].customData.company, expectedCompanyName);
                            assert.strictEqual(res.body.items[0].providerData.providerId, 'saml');
                            assert.strictEqual(res.body.items[0].providerData.firstName, 'John');
                            assert.strictEqual(res.body.items[0].providerData.lastName, 'Doe');
                            assert.strictEqual(res.body.items[0].providerData.company, expectedCompanyName);
                        });
            }

            it('via IdP redirect', function(){
                return jwt.signAsync(
                    {cb_uri: callbackUrl},
                    init.apiKey.secret,
                    {
                        issuer: init.apiKey.id,
                        subject: 'http://localhost:20020/v1/applications/'+applicationId,
                        header: {kid: init.apiKey.id}
                    }
                )
                .then(function(accessToken){
                    return request(init.servers.main).get('/v1/applications/'+applicationId+'/saml/sso/idpRedirect')
                        .query({accessToken: accessToken})
                        .expect(302);
                })
                .then(function(res){
                    return mockIdPResponse(res.header.location, 'idpResponse1','some-company');
                });
            });

            it('with account store', function(){
                //create an organization and map it the the SAML application
                const organizationName = init.randomName();
                return init.postRequest('organizations')
                    .send({
                        name: organizationName,
                        nameKey: organizationName
                    })
                    .expect(200)
                    .then(function(res){
                        return init.postRequest('accountStoreMappings')
                            .send({
                                application:{href: '/applications/'+applicationId},
                                accountStore:{href: '/organizations/'+res.body.id}
                            })
                            .expect(200);
                    })
                    .then(function(res){
                        return jwt.signAsync(
                            {
                                cb_uri: callbackUrl,
                                ash: res.body.accountStore.href
                            },
                            init.apiKey.secret,
                            {
                                issuer: init.apiKey.id,
                                subject: 'http://localhost:20020/v1/applications/'+applicationId,
                                header: {kid: init.apiKey.id}
                            }
                        );
                    })
                    .then(function(accessToken){
                        //cloudpass should redirect stracight to the callback_uri with an error
                        // because it cannot find a SAML provider associated to the organization
                        return request(init.servers.main).get('/v1/applications/'+applicationId+'/saml/sso/idpRedirect')
                            .query({accessToken: accessToken})
                            .expect(302);
                    })
                    .then(function(res){
                        const locationStart = callbackUrl+'?jwtResponse=';
                        assert(res.header.location.startsWith(callbackUrl+'?jwtResponse='));
                        const jwtResponse = res.header.location.substring(locationStart.length);
                        return jwt.verifyAsync(jwtResponse, init.apiKey.secret);
                    })
                    .then(function(payload){
                        assert(payload.err);
                        assert.strictEqual(payload.err.status, 404);
                    });
            });

            it('via ID Site', function(){
                return init.getIdSiteBearer(applicationId, {cb_uri: callbackUrl})
                    .then(function(bearer){
                         return request(init.servers.main).get('/v1/applications/'+applicationId+'/saml/sso/idpRedirect')
                            .set('authorization', 'Bearer '+bearer)
                            .expect(200);
                    })
                    .then(function(res){
                        return mockIdPResponse(res.header['stormpath-sso-redirect-location'], 'idpResponse2','some-other-company');
                    });
            });
        });

    });

});