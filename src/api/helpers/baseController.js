"use strict";

const _ = require('lodash');
const controllerHelper = require('./controllerHelper');
const ApiError = require('../../ApiError');
const models = require('../../models');

module.exports = function (model, transactionalMethods) {
    return {
        create: function(req, res){
           return controllerHelper.createAndExpand(
             model,
             {[model.aclAttribute]: req.user.tenantId},
             req,
             res,
             _.includes(transactionalMethods, 'create'));
        },
        //get a resource by id (e.g. /directories/f6f7ee4a-0861-4873-a8d8-fc58245f93bb)
        get: function (req, res) {
            return controllerHelper.queryAndExpand(() => model.findByPk(req.swagger.params.id.value), req, res);
        },
        //get a collection associated to a resource (e.g. /directories/f6f7ee4a-0861-4873-a8d8-fc58245f93bb/accounts)
        getCollection: function(req, res){
            controllerHelper.getCollection(model, req.swagger.params.collection.value, req, res);
        },
        //get custom data associated to a resource
        getCustomData: function(req, res){
            return model
                .findByPk(req.swagger.params.id.value)
                .tap(ApiError.assertFound)
                .call('getCustomData')
                .then(res.json.bind(res))
                .catch(req.next);
        },
        update: function(req, res){
            return controllerHelper.updateAndExpand(model, req, res, _.includes(transactionalMethods, 'update'));
        },
        updateCustomData: function(req, res){
            return model
                .findByPk(req.swagger.params.id.value)
                .tap(ApiError.assertFound)
                .then(function(resource){
                    resource.set('customData', req.swagger.params.newCustomData.value);
                    return resource.save();
                })
                .then(function(updatedResource){
                    res.json(updatedResource.getCustomData());
                })
                .catch(req.next);
        },
        //delete a resource:
        delete: function(req, res){
            return controllerHelper.execute(
               function(){
                   return model.destroy({where:{id: req.swagger.params.id.value}, limit: 1, individualHooks: true});
               },
               _.includes(transactionalMethods, 'delete')
            )
            .then(function(rowNb){
                ApiError.assert(rowNb, ApiError.NOT_FOUND);
                res.status(204).json();
            })
            .catch(req.next);
        },
        deleteCustomData: function(req, res){
            return model
                .update({customData: {}}, {where: {id: req.swagger.params.id.value}})
                .spread(function(rowNb){
                    ApiError.assert(rowNb, ApiError.NOT_FOUND);
                    res.status(204).json();
                })
                .catch(req.next);
        },
        deleteCustomDataField: function(req, res){
            return model
                .findByPk(req.swagger.params.id.value)
                .tap(ApiError.assertFound)
                .then(function(resource){
                    resource.deleteCustomDataField(req.swagger.params.fieldName.value);
                    return resource.save();
                })
                .then(function(updatedResource){
                    if(updatedResource instanceof models.sequelize.ValidationError){
                        throw updatedResource;
                    } else {
                        res.status(204).json();
                    }
                })
                .catch(req.next);
        },
        //get a sub resource whose computation depends on attributes of the resource
        //(e.g. idSiteModel)
        getComputedSubResource: function(getter, req, res){
          return controllerHelper.queryAndExpand(
             () => model.findByPk(req.swagger.params.id.value)
                          .tap(ApiError.assertFound)
                          .then(instance => instance[getter]()),
             req,
             res
          );
        },
        //get a sub resource wich can be queried only from the ID of the resource
        //(e.g. directory providers)
        getSubResource: function(getter, req, res){
          return  controllerHelper.queryAndExpand(
            () => model.build({id: req.swagger.params.id.value, tenantId: req.user.tenantId})[getter](),
            req,
            res
          );
        }
    };
};