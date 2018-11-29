var config = require('config');
var compression = require('compression');
var express = require('express');

var app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.static(config.get('server.uiFolder')));
module.exports = app;