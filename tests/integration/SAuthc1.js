const assert = require("assert");
const init = require('./init');
const moment = require('moment');
const crypto = require('crypto');
const url = require('url');
const http = require('http');
const BluebirdPromise = require('sequelize').Promise;
const request = require('supertest');

describe('SAuthc1', function () {
    let application;
    before(function () {
        return init.getRequest('tenants/' + init.apiKey.tenantId + '/applications')
            .query({name: 'Cloudpass', limit: 1})
            .expect(200)
            .then(function (res) {
                application = res.body.items[0];
            });
    });

    it('GET', function () {
        return sendAauthc1Request('/v1/tenants/' + init.apiKey.tenantId, null, 'GET')
            .then(function (res) {
                assert.strictEqual(res.status, 200);
                assert(res.body.href);
            });
    });

    it('GET with query', function () {
        return sendAauthc1Request('/v1/tenants/' + init.apiKey.tenantId, "expand=applications", 'GET')
            .then(function (res) {
                assert.strictEqual(res.status, 200);
                assert(res.body.href);
                assert(res.body.applications.items);
            });
    });

    it('POST', function () {
        return sendAauthc1Request('/v1/tenants/' + init.apiKey.tenantId, null, 'POST', {customData: {}})
            .then(function (res) {
                assert.strictEqual(res.status, 200);
            });
    });

    it('Invalid digest', function () {
        return request(init.servers.main).get('/v1/tenants/' + init.apiKey.tenantId)
            .set('authorization', 'SAuthc1 sauthc1Id=201c2ec2-6d42-47b1-ba85-3b5ca3700b38/20160223/2639dabba1390038/sauthc1_request, sauthc1SignedHeaders=content-type;host;x-stormpath-date, sauthc1Signature=51d68f16f209d1ac4ba3cfcdcb476d36cfa1eeecae976e749c889af0738dbe41')
            .expect(401);
    });
});

//strongly inspired from https://github.com/stormpath/stormpath-sdk-node/blob/master/lib/authc/Sauthc1RequestAuthenticator.js
function sendAauthc1Request(path, query, method, body) {
    const AUTHORIZATION_HEADER = 'Authorization',
        ID_TERMINATOR = 'sauthc1_request',
        ALGORITHM = 'HMAC-SHA-256',
        AUTHENTICATION_SCHEME = 'SAuthc1',
        SAUTHC1_ID = 'sauthc1Id',
        SAUTHC1_SIGNED_HEADERS = 'sauthc1SignedHeaders',
        SAUTHC1_SIGNATURE = 'sauthc1Signature',
        NL = '\n';
    const host = 'localhost', port = 20020;
    const apiKey = init.apiKey;

    function encodeUrl(path) {
        return path
            .replace('+', '%20')
            .replace('*', '%2A')
            .replace('%7E', '~')
            .replace('%2F', '/');
    }

    function sha256(string) {
        return crypto.createHash('sha256').update(Buffer.from(string, 'utf8')).digest();
    }

    function sign(data, key) {
        if (typeof data === 'string') {
            data = Buffer.from(data, 'utf8');
        }
        return crypto.createHmac('sha256', key).update(data).digest();
    }


    const timeStamp = moment.utc().format('YYYYMMDDTHHmmss[Z]');
    const dateStamp = moment.utc().format('YYYYMMDD');
    const nonce = crypto.randomBytes(8).toString('hex');

    const headers = {
        'Host': host + ':' + port,
        'X-Stormpath-Date': timeStamp
    };
    let bodyString = '';
    if (body) {
        bodyString = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
    }
    const sortedHeaderKeys = Object.keys(headers).sort();
    let canonicalHeadersString = '';
    sortedHeaderKeys.forEach(function (val) {
        canonicalHeadersString += val.toLowerCase() + ':' + headers[val] + NL;
    });

    const canonicalResourcePath = encodeUrl(path);
    const canonicalQueryString = query ? encodeUrl(query) : '';
    const signedHeadersString = sortedHeaderKeys.join(';').toLowerCase();
    const requestPayloadHashHex = sha256(bodyString).toString('hex');
    const canonicalRequest = [method, canonicalResourcePath, canonicalQueryString,
        canonicalHeadersString, signedHeadersString, requestPayloadHashHex]
        .join(NL);

    const id = [apiKey.id, dateStamp, nonce, ID_TERMINATOR].join('/');

    const canonicalRequestHashHex = sha256(canonicalRequest).toString('hex');

    const stringToSign = [ALGORITHM, timeStamp, id, canonicalRequestHashHex].join(NL);

    // SAuthc1 uses a series of derived keys, formed by hashing different
    // pieces of data

    const kSecret = AUTHENTICATION_SCHEME + apiKey.secret;
    const kDate = sign(dateStamp, kSecret);
    const kNonce = sign(nonce, kDate);
    const kSigning = sign(ID_TERMINATOR, kNonce);

    const signature = sign(stringToSign, kSigning);
    const signatureHex = signature.toString('hex');

    const authorizationHeader = [
        AUTHENTICATION_SCHEME + ' ' + SAUTHC1_ID + '=' + id,
        SAUTHC1_SIGNED_HEADERS + '=' + signedHeadersString,
        SAUTHC1_SIGNATURE + '=' + signatureHex
    ].join(', ');

    headers[AUTHORIZATION_HEADER] = authorizationHeader;

    return BluebirdPromise.fromCallback(function (callback) {
        const req = http.request(
            {
                host: host,
                path: query ? path + '?' + query : path,
                port: port,
                method: method,
                headers: headers
            },
            function (response) {
                let str = '';
                response.on('data', function (chunk) {
                    str += chunk;
                });

                response.on('end', function () {
                    callback(
                        null,
                        {
                            status: response.statusCode,
                            header: response.headers,
                            body: str ? JSON.parse(str) : ''
                        }
                    );
                });
            }
        );

        if (bodyString) {
            req.write(Buffer.from(bodyString, 'utf8'));
        }
        req.end();
    });
};
