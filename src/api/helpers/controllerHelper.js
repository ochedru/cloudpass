"use strict";

const BluebirdPromise = require('sequelize').Promise;
const Op = require('sequelize').Op;
const _ = require('lodash');
const Optional = require('optional-js');
const models = require('../../models');
const ApiError = require('../../ApiError');
const hrefHelper = require('../../helpers/hrefHelper');

const defaultPagination = {offset: 0, limit: 25};

function createCollectionResource(href, pagination, size, items) {
    return {
        'href': href,
        'offset': pagination.offset,
        'limit': pagination.limit,
        'size': size,
        'items': items
    };
}

function caseInsensitiveLikeClause(target, columnName, matchedString) {
    const sequelize = models.sequelize;
    return sequelize.where(sequelize.fn('lower', sequelize.cast(sequelize.col(target.name + '.' + columnName), 'text')), {[Op.like]: sequelize.literal(`${sequelize.escape(matchedString.toLowerCase())} ESCAPE '\\'`)});
}

//parse an 'orderBy' query param into sequelize 'order' clause
function getOrderClause(orderParam) {
    if (orderParam) {
        return _.map(
            orderParam,
            function (orderStatement) {
                const split = orderStatement.split(' ');
                switch (split.length) {
                    case 1:
                        return split[0];
                    case 2:
                        return (split[1].toUpperCase() === 'DESC') ? [split[0], 'DESC'] : split[0];
                    default:
                        throw new ApiError(
                            400,
                            2104,
                            "Invalid orderBy clause '" + orderStatement + "'.  An order statement must be a queryable property optionally followed by a space character and order direction token (asc or desc).");
                }
            }
        );
    } else {
        //if no order clause is specified, we must still order the results to ensure a consistent pagination
        //('id' is present and indexed in all tables)
        return [['id', 'ASC']];
    }
}

function escapeLikeParam(likeParam) {
    return likeParam.replace(/(_|%|\\)/g, '\\$1');
}

function getWhereClause(query, target) {
    //search in a specific attribute
    const whereClauses =
        _(target.searchableAttributes)
            .filter(function (a) {
                return query.hasOwnProperty(a);
            })
            .map(a => caseInsensitiveLikeClause(target, a, escapeLikeParam(query[a]).replace(/\*/g, '%')))
            .value();

    //'q' paramter = search in all searchable attributes
    if (query.q) {
        whereClauses.push({
            [Op.or]: _(target.searchableAttributes)
                .map(a => caseInsensitiveLikeClause(target, a, `%${escapeLikeParam(query.q)}%`))
                .value()
        });
    }

    switch (whereClauses.length) {
        case 0:
            return undefined;
        case 1:
            return whereClauses[0];
        default:
            return {[Op.and]: whereClauses};
    }
}

function getCollectionQueryOptions(req, target) {
    return _.defaults(
        _.pickBy({
            offset: req.swagger.params.offset.value,
            limit: req.swagger.params.limit.value,
            order: getOrderClause(req.swagger.params.orderBy.value),
            where: getWhereClause(req.query, target)
        }),
        defaultPagination);
}

function parseExpandParam(expandParam) {
    return Optional.ofNullable(expandParam)
        .filter(_.negate(_.isEmpty))
        //split the different parts, e.g: 'tenant,groups(offset:0,limit:10)'
        // ==> ['tenant', 'groups(offset:0,limit:10)']
        .map(_.method('split', /,(?!offset|limit)/))
        .map(function (expandStrings) {
            return _(expandStrings)
                .map(function (expandString) {
                    //separate the association name and the pagination parts
                    const expandParts = /^([^(]*)\(([^)]*)\)*$/.exec(expandString);
                    let associationName, pagination;
                    if (expandParts) {
                        //pagination (limit or offset) was specified
                        associationName = expandParts[1];
                        pagination = _(expandParts[2].split(','))
                            .map(_.method('split', ':'))
                            .fromPairs()
                            .mapValues(parseInt)
                            .defaults(defaultPagination)
                            .value();
                        ApiError.assert(_.keysIn(pagination).length === 2, ApiError, 400, 400, 'Invalid expansion pagination: %s', expandParts[2]);
                    } else {
                        //no option, the whole param is the association name
                        associationName = expandString;
                        pagination = defaultPagination;
                    }
                    return [associationName, pagination];
                })
                .fromPairs()
                .value();
        })
        .orElseGet(_.stubObject);
}

exports.parseExpandParam = parseExpandParam;

function performExpansion(resource, expands) {
    //convert to JSON to make sure the expanded resources will not be overriden by custom getters
    const resourceJson = _.defaultTo(resource.toJSON, _.constant(resource)).call(resource);
    return BluebirdPromise.all(
        _.map(
            expands,
            function (v, k) {
                const association = _.get(resource, 'constructor.associations.' + k) || _.get(resource, 'constructor.customAssociations.' + k);
                let promise;
                if (association) {
                    if (_.includes(['BelongsTo', 'HasOne'], association.associationType)) {
                        //obviously no pagination needed
                        promise = resource[association.accessors.get]();
                    } else {
                        //the expanded is a collection
                        promise = findAndCountAssociation(resource, association, v);
                    }
                } else {
                    //the resource must be expanded via a custom getter
                    const getterName = 'get' + _.upperFirst(k);
                    ApiError.assert(resource[getterName], ApiError, 400, 400, '%s %s is not a supported expandable property.', _.get(resource, 'constructor.name', ''), k);
                    promise = BluebirdPromise.resolve(resource[getterName](v));
                }

                return promise.then(function (expandedResource) {
                    if (expandedResource.count !== undefined && expandedResource.rows !== undefined) {
                        //it's a resource collection
                        resourceJson[k] = createCollectionResource(
                            resource.href + "/" + k,
                            v,
                            expandedResource.count,
                            expandedResource.rows);
                    } else {
                        //it's a single resource
                        resourceJson[k] = expandedResource;
                    }
                });
            }
        )
    )
        .then(function () {
            return resourceJson;
        });
}

function execute(query, inTransaction) {
    return inTransaction ?
        models.sequelize.requireTransaction(query) :
        query();
}

exports.execute = execute;

function queryAndExpand(query, req, res, inTransaction) {
    const expands = parseExpandParam(_.get(req.swagger.params, 'expand.value', ''));
    //if expansion must be performed, execute all queries in a REPEATABLE-READ transaction
    return execute(
        () => query()
            .tap(ApiError.assertFound)
            .then(_.partial(performExpansion, _, expands)),
        inTransaction || !_.isEmpty(expands)
    )
        .then(res.json.bind(res))
        .catch(req.next);
}

exports.queryAndExpand = queryAndExpand;

function create(model, foreignKeys, attributes) {
    return model.fromJSON(
        _(attributes)
            .pick(model.settableAttributes)
            .defaults(foreignKeys)
            .value()
    )
        .save();
}

exports.create = create;

exports.createAndExpand = function (model, foreignKeys, req, res, inTransaction) {
    return queryAndExpand(
        () => create(model, foreignKeys, req.swagger.params.attributes.value),
        req, res, inTransaction
    );
};

function update(model, id, newAttributes) {
    return model.findByPk(id)
        .tap(ApiError.assertFound)
        .then(resource =>
            resource.update(
                _.mapValues(
                    newAttributes,
                    v => Optional.ofNullable(v).map(_.property('href')).map(hrefHelper.resolveHref).orElse(v)
                ),
                {fields: model.settableAttributes}
            )
        );
}

exports.update = update;

exports.updateAndExpand = function (model, req, res, inTransaction) {
    return queryAndExpand(
        () => update(model, req.swagger.params.id.value, req.swagger.params.newAttributes.value),
        req, res, inTransaction
    );
};

function findAndCountAssociation(instance, association, options) {
    //do count + get in a REPETABLE_READ transaction
    return models.sequelize.requireTransaction(function () {
        return BluebirdPromise.join(
            instance[association.accessors.count]({where: options.where}),
            instance[association.accessors.get](options));
    })
        .spread(function (count, rows) {
            return {count: count, rows: rows};
        });
}

exports.getCollection = function (model, collection, req, res) {
    const instance = model.build({id: req.swagger.params.id.value});
    const association = model.associations[collection] || _.get(model, 'customAssociations.' + collection);
    ApiError.assert(association, ApiError.NOT_FOUND);

    const target = association.target;
    const expands = parseExpandParam(_.get(req.swagger.params, 'expand.value', ''));
    const options = getCollectionQueryOptions(req, target);

    return findAndCountAssociation(instance, association, options)
        .then(function (result) {
            return BluebirdPromise
                .all(_.map(result.rows, _.partial(performExpansion, _, expands)))
                .then(function (expanded) {
                    res.json(
                        createCollectionResource(
                            model.getHref(req.swagger.params.id.value) + "/" + collection,
                            options,
                            result.count,
                            expanded));
                });
        })
        .catch(req.next);
};
