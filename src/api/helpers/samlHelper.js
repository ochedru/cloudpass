"use strict";

const _ = require('lodash');
const saml2 = require('sequelize').Promise.promisifyAll(require('saml2-js'), {suffix: '_async'});
const signJwt = require('sequelize').Promise.promisify(require('jsonwebtoken').sign);

function getSamlProvider(providerMetadata) {
    return new saml2.ServiceProvider({
        entity_id: providerMetadata.entityId,
        private_key: providerMetadata.get('privateKey', {role: 'serviceProvider'}),
        certificate: providerMetadata.x509SigningCert,
        assert_endpoint: providerMetadata.assertionConsumerServicePostEndpoint
    });
}

function getSamlIdentityProvider(directoryProvider) {
    return new saml2.IdentityProvider({
        sso_login_url: directoryProvider.ssoLoginUrl,
        sso_logout_url: directoryProvider.ssoLogoutUrl,
        certificates: directoryProvider.encodedX509SigningCert
    });
}

exports.getXmlMetadata = function (providerMetadata) {
    return getSamlProvider(providerMetadata).create_metadata();
};

exports.getLoginRequestUrl = function (provider, relayState) {
    return getSamlProvider(provider.samlServiceProviderMetadata)
        .create_login_request_url_async(
            getSamlIdentityProvider(provider),
            {
                sign_get_request: true,
                relay_state: relayState
            }
        );
};

exports.getSamlResponse = function (provider, requestBody) {
    return getSamlProvider(provider.samlServiceProviderMetadata)
        .post_assert_async(
            getSamlIdentityProvider(provider),
            {
                request_body: requestBody,
                allow_unencrypted_assertion: true,
                require_session_index: false,
                audience: /.*/
            }
        );
};

exports.getRelayState = function (apiKey, content, expiration) {
    return signJwt(
        content,
        apiKey.secret,
        _.pickBy(
            {
                expiresIn: expiration,
                subject: apiKey.id,
                audience: 'SamlIdp'
            }
        )
    );
};