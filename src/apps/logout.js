"use strict";

var express = require('express');
var Optional = require('optional-js');
var config = require('config');
var url = require('url');

var app = express();
app.get('/', function(req, res){
    res.clearCookie('sessionToken', {path: url.parse(Optional.ofNullable(config.get('server.rootUrl')).orElse('')+'/v1').pathname})
            .status(204)
            .end();
});
module.exports = app;