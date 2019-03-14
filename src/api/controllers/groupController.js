"use strict";

const accountStoreController = require('../helpers/accountStoreController');
const models = require('../../models');

module.exports = accountStoreController(models.group, ['delete']);