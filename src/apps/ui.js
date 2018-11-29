var config = require('config');
var compression = require('compression');
var express = require('express');

var app = express();
app.use(compression());
app.use(express.static(config.get('server.uiFolder')));
module.exports = app;