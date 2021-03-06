"use strict";

const randomstring = require("randomstring");
const ModelDecorator = require('./helpers/ModelDecorator');

module.exports = function (sequelize, DataTypes) {
    return new ModelDecorator(
        sequelize.define(
            'apiKey',
            {
                id: {
                    primaryKey: true,
                    type: DataTypes.UUID,
                    allowNull: false,
                    defaultValue: DataTypes.UUIDV4
                },
                status:{
                    type: DataTypes.STRING(10),
                    validate: {isIn: [['ENABLED', 'DISABLED']]},
                    allowNull: false,
                    defaultValue: 'ENABLED'
                },
                secret: {
                    type: DataTypes.STRING(50),
                    allowNull: false
                }
            },
            {
                hooks: {
                    beforeValidate: function(instance){
                        instance.set('secret', randomstring.generate(50));
                    }
                }
            }
        )
    )
    .withClassMethods({
        associate: function(models) {
            models.apiKey.belongsTo(models.tenant, {onDelete: 'cascade'});
            models.apiKey.belongsTo(models.account, {onDelete: 'cascade'});
        }
    })
    .withSettableAttributes('status')
    .end();
};
