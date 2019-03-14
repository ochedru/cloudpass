"use strict";

const util = require('util');
const url = require('url');
const passport = require('passport');
const _ = require('lodash');
const crypto = require('crypto');
const Optional = require('optional-js');
const BluebirdPromise = require('sequelize').Promise;
const getApiKey = require('../helpers/getApiKey');

const AUTHENTICATION_SCHEME = "SAuthc1";
const SAUTHC1_ID = "sauthc1Id";
const ID_TERMINATOR = 'sauthc1_request';
const SAUTHC1_SIGNED_HEADERS = 'sauthc1SignedHeaders';
const SAUTHC1_SIGNATURE = 'sauthc1Signature';
const ALGORITHM = 'HMAC-SHA-256';
const DATE_HEADER = 'x-stormpath-date';

function SAuthc1Strategy(rootUrl) {
    this.name = 'sauthc1';
    this.rootUrl = rootUrl;
}

util.inherits(SAuthc1Strategy, passport.Strategy);

SAuthc1Strategy.prototype.authenticate = function (req) {
    //authenticate using SAuthc1 authorization header
    //see https://github.com/stormpath/stormpath-sdk-spec/blob/master/specifications/algorithms/sauthc1.md

    //the header must start with the authentication scheme and be made of three name value pairs separated by comas
    BluebirdPromise.try(function () {
        const nameValuePairs = Optional.ofNullable(req.headers.authorization)
            .filter(function (header) {
                return header.substring(0, AUTHENTICATION_SCHEME.length) === AUTHENTICATION_SCHEME;
            })
            .map(function (header) {
                return header.substring(AUTHENTICATION_SCHEME.length + 1);
            })
            .map(function (authorization) {
                return authorization.split(', ');
            })
            .filter(function (nameValuePairs) {
                return nameValuePairs.length === 3;
            })
            .orElseThrow(() => new Error('Invalid authorization header: ' + req.headers.authorization));

        //first name value pair: sauthc1Id=*apiKeyId*/*dateStamp*/*nonce*/sauthc1_request
        const idParts = Optional.ofNullable(nameValuePairs[0])
            .map(function (nameValue) {
                return nameValue.split('=');
            })
            .filter(function (nameValueArray) {
                return nameValueArray.length === 2 && nameValueArray[0] === SAUTHC1_ID;
            })
            .map(function (nameValueArray) {
                return nameValueArray[1].split('/');
            })
            .filter(function (idParts) {
                return idParts.length === 4 && idParts[3] === ID_TERMINATOR;
            })
            .orElseThrow(() => new Error('Invalid authorization ID: ' + nameValuePairs[0]));

        const apiKeyId = idParts[0];
        const dateStamp = idParts[1];
        const nonce = idParts[2];

        //second name value pair: sauthc1SignedHeaders=*signedHeaders*
        const signedHeadersString = Optional.ofNullable(nameValuePairs[1])
            .map(function (nameValue) {
                return nameValue.split('=');
            })
            .filter(function (nameValueArray) {
                return nameValueArray.length === 2 && nameValueArray[0] === SAUTHC1_SIGNED_HEADERS;
            })
            .map(function (nameValueArray) {
                return nameValueArray[1];
            })
            .orElseThrow(() => new Error('Invalid authorization signed headers: ' + nameValuePairs[1]));

        //third name value pair: sauthc1Signature=*signature*
        const signatureHex = Optional.ofNullable(nameValuePairs[2])
            .map(function (nameValue) {
                return nameValue.split('=');
            })
            .filter(function (nameValueArray) {
                return nameValueArray.length === 2 && nameValueArray[0] === SAUTHC1_SIGNATURE;
            })
            .map(function (nameValueArray) {
                return nameValueArray[1];
            })
            .orElseThrow(() => new Error('Invalid authorization signature: ' + nameValuePairs[2]));

        return getApiKey(apiKeyId)
            .then(function (apiKey) {
                return Optional.ofNullable(apiKey)
                    .filter(function () {
                        return signatureHex === computeSignature.call(this, req, signedHeadersString, apiKeyId, apiKey.secret, dateStamp, nonce);
                    }.bind(this))
                    .orElseThrow(() => new Error('digest verification failed'));
            }.bind(this));
    }.bind(this))
        .then(this.success)
        .catch(this.fail);
};

function computeSignature(req, signedHeadersString, apiKeyId, secret, dateStamp, nonce) {
    const signedHeaders = signedHeadersString.split(';');
    const method = req.method;
    const canonicalResourcePath = encodeUrl(url.parse(Optional.ofNullable(this.rootUrl).orElse('') + req.originalUrl).pathname);
    const canonicalQueryString = req._parsedUrl.query ? encodeUrl(req._parsedUrl.query) : '';
    const canonicalHeadersString =
        _(req.headers)
            .pick(signedHeaders)
            .toPairs()
            .sortBy(_.head)
            .map(_.method('join', ':'))
            .join('\n') + '\n';
    const requestPayloadHashHex = sha256(req.rawBody || '');
    const canonicalRequest = [method, canonicalResourcePath, canonicalQueryString, canonicalHeadersString, signedHeadersString, requestPayloadHashHex].join('\n');
    const canonicalRequestHashHex = sha256(Buffer.from(canonicalRequest, 'utf-8'));
    const stringToSign = [ALGORITHM, req.headers[DATE_HEADER], apiKeyId + '/' + dateStamp + '/' + nonce + '/' + ID_TERMINATOR, canonicalRequestHashHex].join('\n');
    const kSecret = Buffer.from(AUTHENTICATION_SCHEME + secret, 'utf-8');
    const kDate = hmac(kSecret, dateStamp);
    const kNonce = hmac(kDate, nonce);
    const kSigning = hmac(kNonce, ID_TERMINATOR);
    return hmac(kSigning, stringToSign, 'hex');
}

function hmac(key, buff, digest) {
    return crypto.createHmac('sha256', key).update(buff).digest(digest);
}

function sha256(buff) {
    return crypto.createHash('sha256').update(buff).digest('hex');
}

function encodeUrl(path) {
    return path
        .replace(/\+/g, '%20')
        .replace(/\*/g, '%2A')
        .replace(/%7E/g, '~')
        .replace(/%2F/g, '/');
}

module.exports = SAuthc1Strategy;