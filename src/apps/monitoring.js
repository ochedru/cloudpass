'use strict';

const _ = require('lodash');
const Health = require('health-checkup');
var appInfo = require("node-appinfo")();
const express = require('express');
const models = require('../models');

Health.addCheck('database', _.bindKey(models.sequelize, 'authenticate'));

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) =>
    Health.checkup()
        .then(report =>
            res.status( _.find(report, _.matchesProperty('is_healthy', false)) ? 503 : 200)
            .json(report))
        .catch(req.next));

app.get('/version', (req, res) => res.json(appInfo.version));

module.exports = app;