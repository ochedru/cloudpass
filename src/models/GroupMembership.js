"use strict";

const ModelDecorator = require('./helpers/ModelDecorator');
//const logger = require('../helpers/loggingHelper').logger;

module.exports = function (sequelize, DataTypes) {
    return new ModelDecorator(
        sequelize.define(
            'groupMembership',
            {
                id: {
                    primaryKey: true,
                    type: DataTypes.UUID,
                    allowNull: false,
                    defaultValue: DataTypes.UUIDV4
                }
            },
            {
                indexes: [{
                    unique: true,
                    fields: ['accountId', 'groupId']
                }],
                hooks: {
                    afterCreate: function (instance) {
                        console.log(instance);
                    },
                    afterDestroy: function (instance) {
                        console.log(instance);
                    }
                }
            }
        )
    )
    .withClassMethods({
        associate: models => {
            models.groupMembership.belongsTo(models.tenant, {onDelete: 'cascade'});
            models.groupMembership.belongsTo(models.account, {onDelete: 'cascade'});
            models.groupMembership.belongsTo(models.group, {onDelete: 'cascade'});
        }
    })
    .withSettableAttributes('group', 'account')
    .end();
};