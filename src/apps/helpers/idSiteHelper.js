'use strict';

const signJwt = require('sequelize').Promise.promisify(require('jsonwebtoken').sign);

// returns an JWT response that can be used by the application to authenticate a user
exports.getJwtResponse = (apiKey, accountHref, payload) => signJwt(
    payload,
    apiKey.secret,
    {
        expiresIn: 60,
        issuer: apiKey.tenant.idSites[0].url,
        subject: accountHref,
        audience: apiKey.id,
        header: {kid: apiKey.id}
    }
);

exports.getFactorsScope = accountId => ({
    accounts: {
        [accountId]: [
            {factors: ['get', 'post']}
        ]
    }
});

exports.getSecuritySettingsScope = accountId => ({
    accounts: {
        [accountId]: [
            'get',
            {factors: ['get', 'post']},
            {passwordChanges: ['post']}
        ]
    }
});

exports.getAccountOrganizationsScope = accountId => ({
    accounts: {
        [accountId]: {
            organizations: ['get']
        }
    }
});