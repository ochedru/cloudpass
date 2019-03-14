"use strict";

const express = require('express');
const Optional = require('optional-js');
const config = require('config');
const url = require('url');

const app = express();
app.get('/', function (req, res) {
    res.clearCookie('sessionToken', {path: url.parse(Optional.ofNullable(config.get('server.rootUrl')).orElse('') + '/v1').pathname})
        .status(204)
        .end();
});
module.exports = app;