const config = require('config');
const compression = require('compression');
const express = require('express');

const app = express();
app.use(compression());
app.use(express.static(config.get('server.uiFolder')));
module.exports = app;