"use strict";

const baseController = require('../helpers/baseController');
const models = require('../../models');
const ApiError = require('../../ApiError');

const controller = baseController(models.passwordPolicy, ['create', 'delete']);

controller.getStrength = function(req, res){
  models.passwordPolicy
        .findByPk(req.swagger.params.id.value)
        .then(function(passwordPolicy){
            ApiError.assert(passwordPolicy, ApiError.NOT_FOUND);
            res.json(passwordPolicy.getStrength());
            return res;
        })
        .catch(req.next);  
};

controller.setStrength = function(req, res) {
    models.passwordPolicy
        .findByPk(req.swagger.params.id.value)
        .then(function(passwordPolicy){
            ApiError.assert(passwordPolicy, ApiError.NOT_FOUND);
            return passwordPolicy.update({strength: req.swagger.params.newAttributes.value});
        })
        .then(function(passwordPolicy){
            res.json(passwordPolicy.getStrength());
        })
        .catch(req.next);  
};
module.exports = controller;