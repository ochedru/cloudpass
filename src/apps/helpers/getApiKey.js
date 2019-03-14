"use strict";

const models = require('../../models');
const ssacl = require('ssacl');

module.exports = function (apiKeyId, ...includes) {
    return models.apiKey.findByPk(
        apiKeyId,
        {
            actor: new ssacl.Omnipotent(),
            include: [{
                model: models.account,
                attributes: [],
                include: [{
                    model: models.directory,
                    attributes: [],
                    where: {name: 'Cloudpass Administrators'}
                }]
            }].concat(includes)
        }
    );
};