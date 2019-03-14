"use strict";

const _ = require('lodash');

//get the scope of requests an ID site is allowed to make with its bearer token
exports.getIdSiteScope = function(...modelInstances) {
    return _(modelInstances)
        .filter(_.negate(_.isEmpty))
        .map(i => ({[i.constructor.options.name.plural]: {[i.id]: i.constructor.getIdSiteScope()}}))
        .reduce(_.merge, {});
};

exports.scopeToPaths = function(scope, baseUrl = '') {
    if (_.isString(scope)) {
        //the scope is simply a permission (get, post etc.)
        //map the URL to the corresponding HTTP method
        return {
          [baseUrl]: [scope]
        };
    }
    if (_.isArray(scope)) {
        //find the paths associated with each of the array item and merge them
        return _(scope)
            .map(_.partial(exports.scopeToPaths, _, baseUrl))
            .reduce(function(result, path) {
                //concat the arrays of http methods if there is path collision
                return _.mergeWith(result, path, function(a, b) {
                    if (_.isArray(a)) {
                      return a.concat(b);
                    }
                });
          });
    }
    if (_.isObject(scope)) {
        //keys are path segments, values are the associated scopes
        return _(scope)
            .toPairs()
            .map(_.spread(function(k, v) {
                return exports.scopeToPaths(v, baseUrl + '/' + k);
            }))
            //concat the paths (no collision possible because keys are different)
            .reduce(_.merge);
    }
};

exports.pathsToScope = function(paths) {
  return _(paths)
    .toPairs()
    .map(_.spread(function(path, methods) {
        //build a scope object for each path
        return _.reduceRight(
            _.compact(path.split('/')),
            (result, segment) => ({[segment]: result}),
            methods
        );
    }))
    .reduce(function(result, scope) {
        //merge the scopes
        return _.mergeWith(result, scope, function(scope1, scope2) {
            if (_.isArray(scope1) || _.isArray(scope2)) {
              return _.compact(_.concat(scope1, scope2));
            }
        });
    });
};