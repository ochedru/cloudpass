"use strict";

const _ = require('lodash');
const BluebirdPromise = require('sequelize').Promise;
const Op = require('sequelize').Op;
const ModelDecorator = require('./ModelDecorator');

module.exports = function (mappedModel, mappingModel, accountStoreTypes) {
    return function (sequelize, DataTypes) {
        return new ModelDecorator(
            sequelize.define(
                mappingModel,
                {
                    id: {
                        primaryKey: true,
                        type: DataTypes.UUID,
                        allowNull: false,
                        defaultValue: DataTypes.UUIDV4
                    },
                    accountStoreId: {
                        type: DataTypes.UUID,
                        validate: {isUUID: 4},
                        allowNull: false
                    },
                    accountStoreType: {
                        type: DataTypes.ENUM.apply(this, accountStoreTypes),
                        allowNull: false
                    },
                    listIndex: {
                        type: DataTypes.INTEGER,
                        allowNull: false,
                        defaultValue: 0,
                        validate: {min: 0}
                    },
                    isDefaultAccountStore: {
                        type: DataTypes.BOOLEAN,
                        allowNull: false,
                        defaultValue: false
                    },
                    isDefaultGroupStore: {
                        type: DataTypes.BOOLEAN,
                        allowNull: false,
                        defaultValue: false
                    }
                },
                {
                    indexes: [
                        {
                            unique: true,
                            fields: [mappedModel + 'Id', 'accountStoreType', 'accountStoreId'],
                            //avoid too long index names (max 64 characters for postgres)
                            name: `${mappingModel.toLowerCase()}_accountstore_${mappedModel.toLowerCase()}`
                        }
                    ],
                    hooks: {
                        afterCreate: afterUpdateOrCreate,
                        afterUpdate: afterUpdateOrCreate,
                        afterDestroy: beforeDestroy
                    },
                    validate: {
                        noGroupNesting: function () {
                            if (this.isDefaultGroupStore && this.accountStoreType === 'group') {
                                throw new Error('Groups cannot store other groups');
                            }
                        }
                    },
                    getterMethods: {
                        accountStore: function () {
                            return this.accountStoreType ?
                                {href: this.sequelize.models[this.accountStoreType].getHref(this.accountStoreId)} :
                                null;
                        }
                    },
                    setterMethods: {
                        accountStore: function (accountStore) {
                            this.set('accountStoreId', accountStore.id);
                            this.set('accountStoreType', accountStore.constructor.name);
                        }
                    }
                }
            )
        )
            .withInstanceMethods({
                getAccountStore: function (options) {
                    const association = this.constructor.associations[this.accountStoreType];
                    return this[association.accessors.get](options);
                }
            })
            .withClassMethods({
                mappedModelAssociation: function () {
                    return this.associations[mappedModel];
                },
                associate: function (models) {
                    models[mappingModel].belongsTo(models.tenant, {onDelete: 'cascade'});
                    models[mappingModel].belongsTo(models[mappedModel], {onDelete: 'cascade'});

                    accountStoreTypes.forEach(function (accountStoreType) {
                        models[mappingModel].belongsTo(
                            models[accountStoreType],
                            {
                                foreignKey: 'accountStoreId',
                                constraints: false,
                                scope: {
                                    accountStoreType: accountStoreType
                                }
                            }
                        );
                        // set up hooks to destroy account store mappings when the related accounts are destroyed
                        models[accountStoreType].afterDestroy(function (instance) {
                            return models[mappingModel].destroy({
                                where: {
                                    accountStoreId: instance.id,
                                    accountStoreType: accountStoreType
                                },
                                individualHooks: true
                            });
                        });
                    });
                }
            })
            .withSettableAttributes('accountStore', mappedModel, 'listIndex', 'isDefaultAccountStore', 'isDefaultGroupStore')
            .end();
    };
};

function afterUpdateOrCreate(mapping) {
    const mappedModel = this.mappedModelAssociation().target;
    const mappedModelFk = this.mappedModelAssociation().identifier;
    const promises = [];
    const newDefaultMapping = {};
    const mappingUpdate = {};
    ['Account', 'Group'].forEach(function (storeType) {
        const mappingAttribute = 'isDefault' + storeType + 'Store';
        const mappedObjectAttribute = 'default' + storeType + 'StoreMappingId';

        if (mapping.changed(mappingAttribute)) {
            //the default account or group mapping changed
            newDefaultMapping[mappedObjectAttribute] = mapping[mappingAttribute] ? mapping.id : null;

            if (mapping[mappingAttribute]) {
                //there can be only one default store
                mappingUpdate[mappingAttribute] = false;
            }
        }
    });

    //update the mapped object with its default mappings
    if (!_.isEmpty(newDefaultMapping)) {
        promises.push(mappedModel.update(
            newDefaultMapping,
            {where: {id: mapping[mappedModelFk]}}));

        if (!_.isEmpty(mappingUpdate)) {
            promises.push(
                this.update(
                    mappingUpdate,
                    {
                        where: {
                            [Op.and]: {
                                id: {[Op.ne]: mapping.id},
                                [mappedModelFk]: mapping[mappedModelFk]
                            }
                        }
                    }
                )
            );
        }
    }
    return BluebirdPromise.all(promises);
}

function beforeDestroy(mapping) {
    //update default account & group mappings
    const mappedModel = this.mappedModelAssociation().target;
    const mappedModelFk = this.mappedModelAssociation().identifier;
    const newDefaultMapping = {};
    ['Account', 'Group'].forEach(function (storeType) {
        if (mapping['isDefault' + storeType + 'Store']) {
            newDefaultMapping['default' + storeType + 'StoreMappingId'] = null;
        }
    });
    if (!_.isEmpty(newDefaultMapping)) {
        return mappedModel.update(newDefaultMapping, {where: {id: mapping[mappedModelFk]}});
    } else {
        return BluebirdPromise.resolve();
    }
}