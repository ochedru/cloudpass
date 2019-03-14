"use strict";

const _ =require('lodash');
const accountStoreController = require('../helpers/accountStoreController');
const models = require('../../models');

const controller = accountStoreController(models.organization, ['delete']);
controller.getIdSiteModel = _.partial(controller.getComputedSubResource, 'getIdSiteModel');
module.exports = controller;