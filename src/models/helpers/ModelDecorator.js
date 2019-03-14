"use strict";

const _ = require('lodash');
const Optional = require('optional-js');
const hrefHelper = require('../../helpers/hrefHelper');
const ApiError = require('../../ApiError');

const defaultClassMethods = {
    getHref: function (id) {return hrefHelper.baseUrl + this.options.name.plural + '/' + id;},
    fromJSON: function(object){
        return _.transform(
             object,
             function(instance, v, k){
                 if(v.href){
                     //turn hrefs into instances
                     const refInstance = hrefHelper.resolveHref(v.href);
                     ApiError.assert(refInstance, ApiError, 400, 2002, '%s href has an invalid value', k);
                     //if the object corresponds to an association, set the corresponding foreign key
                     if(this.associations[k]){
                         instance.set(this.associations[k].foreignKey, refInstance.id);
                     } else {
                         instance.set(k, refInstance);
                     }
                 } else {
                     instance.set(k, v);
                 }
             }.bind(this),
             this.build({}));
    },
    addFindAndCount: function(target, transformOptions, as = target.options.name.plural){
        //pseudo association defined by custom accessors
        const accessorTypes = {get: 'findAll', count: 'count'};
        _.set(
             this,
             `customAssociations.${as}`,
             {
                 target: target,
                 associationType: 'hasMany',
                 accessors: _.mapValues(accessorTypes, function(v, k){return k+_.upperFirst(as);})
             }
        );
        Object.keys(accessorTypes).forEach(function(accessorType){
            this.prototype[this.customAssociations[as].accessors[accessorType]] = function(options){
                return target[accessorTypes[accessorType]](transformOptions.call(this, options));
            };
        }.bind(this));
    }
};

const defaultInstanceMethods = {
    toJSON: function () {
        //"clean" the object to not expand unwanted associations
        this.dataValues = _.pick(this.dataValues, _.keys(this.constructor.attributes));
        const values = this.get();
        [this.constructor.associations, this.constructor.customAssociations].forEach(function(associations){
            _.forOwn(
            associations,
            function (association, associationName) {
                if(!values[associationName]){
                    if(association.associationType === 'BelongsTo'){
                        values[associationName] =
                                Optional.ofNullable(this[association.foreignKey])
                                    .map(function(fk){return {'href': association.target.getHref(fk, this.id)};}.bind(this))
                                    .orElse(null);
                    } else {
                        values[associationName] = {'href': this.href + "/" + associationName};
                    }
                }
            }.bind(this));
        }.bind(this));
        return values;
    }
};

function addCustomData(model){
    model.rawAttributes.customData = {
            type: model.sequelize.constructor.JSON,
            get: function(){
                return {href: this.href+'/customData'};
            },
            set: function(val){
                //remove 'href', 'createdAt', 'modifiedAt' attributes and add the remaining attributes to existing customData
                this.setDataValue('customData', _.assign(this.getDataValue('customData') || {}, _.omit(val, 'href', 'createdAt', 'modifiedAt')));
            },
            defaultValue: {}
        };
        model.refreshAttributes ();
        model.prototype.getCustomData = function(){
            return _.assign(
                this.getDataValue('customData'),
                {
                    href: this.href+'/customData',
                    createdAt: this.createdAt,
                    modifiedAt: this.modifiedAt
                }
            );
        };
        model.prototype.deleteCustomDataField = function(fieldName){
            this.setDataValue(
                'customData',
                _.omit(this.getDataValue('customData'), fieldName));
        };
}

const ModelDecorator = function(model){
    this.model = model;
    _.assign(this.model, defaultClassMethods);
    _.assign(this.model.prototype, defaultInstanceMethods);
    this.model.aclAttribute = 'tenantId';
    this.model.searchableAttributes = [];
    this.model.settableAttributes = [];
};

ModelDecorator.prototype.withClassMethods = function(classMethods){
    _.assign(this.model, classMethods);
    return this;
};

ModelDecorator.prototype.withInstanceMethods = function(instanceMethods){
    _.assign(this.model.prototype, instanceMethods);
    return this;
};

ModelDecorator.prototype.withCustomData = function(){
    addCustomData(this.model);
    return this;
};

ModelDecorator.prototype.withAclAttribute = function(aclAttribute){
    this.model.aclAttribute = aclAttribute;
    return this;
};

ModelDecorator.prototype.withSettableAttributes = function(...settableAttributes){
    this.model.settableAttributes = settableAttributes;
    return this;
};

ModelDecorator.prototype.withSearchableAttributes = function(...searchableAttributes){
    this.model.searchableAttributes = searchableAttributes;
    return this;
};

ModelDecorator.prototype.end = function(){
    return this.model;
};

module.exports = ModelDecorator;
