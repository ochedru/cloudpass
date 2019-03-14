'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const ssacl = require('ssacl');
const signJwt = require('sequelize').Promise.promisify(require('jsonwebtoken').sign);
const Optional = require('optional-js');
const config = require('config');
const url = require('url');
const models = require('../models');
const ApiError = require('../ApiError.js');
const authenticateAccount = require('../api/helpers/accountHelper').authenticateAccount;
const errorHandler = require('./helpers/errorHandler');

const app = express();
app.use(bodyParser.urlencoded({extended: true}));

app.post('/', function (req, res) {
    models.tenant.findOne({
        where: {key: req.body.tenantNameKey},
        attributes: ['id'],
        include: {
            model: models.application,
            where: {name: 'Cloudpass'},
            limit: 1
        },
        actor: new ssacl.Omnipotent()
    })
        .then(function (tenant) {
            ApiError.assert(tenant, ApiError, 400, 400, 'Invalid tenant name');
            req.app.get('ssaclCls').set('actor', tenant.id);
            return authenticateAccount(req.body.email, req.body.password, tenant.applications[0].id);
        })
        .then(function (account) {
            return signJwt({tenantId: account.tenantId, accountId: account.id}, req.app.get('secret'), {
                expiresIn: '1d',
                audience: 'admin'
            });
        })
        .then(function (token) {
            return res.cookie(
                'sessionToken',
                token,
                {
                    httpOnly: true,
                    signed: true,
                    path: url.parse(Optional.ofNullable(config.get('server.rootUrl')).orElse('') + '/v1/').pathname
                }
            )
                .status(204)
                .end();
        })
        .catch(req.next);
});

app.use(errorHandler);

module.exports = app;