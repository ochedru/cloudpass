"use strict";

const _ = require('lodash');
const baseController = require('../helpers/baseController');
const controllerHelper = require('../helpers/controllerHelper');
const models = require('../../models');
const ApiError = require('../../ApiError');

let controller = baseController(models.factor);

controller.getChallenge = function (req, res) {
    return controllerHelper.queryAndExpand(
        () => models.factor.findByPk(req.swagger.params.id.value)
            .tap(ApiError.assertFound)
            .then(factor => {
                let code = _.get(req.swagger.params, 'attributes.value.code');
                if (code) {
                    if (factor.verify(code)) {
                        //the factor is now verified
                        return factor.update({verificationStatus: 'VERIFIED'})
                            .call('getChallenge', 'SUCCESS');
                    } else {
                        return factor.getChallenge('FAILED');
                    }
                } else {
                    return factor.getChallenge('CREATED');
                }
            }),
        req,
        res
    );
};

module.exports = controller;