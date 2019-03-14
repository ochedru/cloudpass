'use strict';

const express = require('express');
const BluebirdPromise = require('sequelize').Promise;
const bodyParser = require('body-parser');
const models = require('../models');
const ApiError = require('../ApiError.js');


const app = express();
app.use(bodyParser.urlencoded({extended: true}));

app.post('/', function (req, res) {
    models.sequelize.transaction(function () {
        //create the tenant
        return models.tenant.create({
            key: req.body.tenantNameKey,
            name: req.body.tenantNameKey
        })
            .then(function (tenant) {
                req.app.get('ssaclCls').set('actor', tenant.id);
                //create administration application & directory
                return BluebirdPromise.join(
                    models.application.create({
                        name: 'Cloudpass',
                        tenantId: tenant.id
                    }),
                    models.directory.create({
                        name: 'Cloudpass Administrators',
                        tenantId: tenant.id
                    }),
                    tenant.id
                );
            })
            .spread(function (application, directory, tenantId) {
                //create an account store mapping between the application and the directory
                //and an admin account in the directory
                return BluebirdPromise.join(
                    models.account.create({
                        email: req.body.email,
                        givenName: req.body.givenName,
                        surname: req.body.surname,
                        password: req.body.password,
                        directoryId: directory.id,
                        tenantId: tenantId
                    }),
                    models.accountStoreMapping.create({
                        accountStoreId: directory.id,
                        applicationId: application.id,
                        accountStoreType: 'directory',
                        listIndex: 0,
                        isDefaultAccountStore: true,
                        isDefaultGroupStore: true,
                        tenantId: tenantId
                    })
                );
            });
    })
        .then(function () {
            res.status(204).json();
        })
        .catch(req.next);
});

app.use(function (err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }
    //return an error code corresponding to the error
    res.status(ApiError.FROM_ERROR(err).status).send();
});

module.exports = app;