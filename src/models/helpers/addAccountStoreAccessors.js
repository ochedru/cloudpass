"use strict";

const _ = require('lodash');
const Op = require('sequelize').Op;

function sign(x) {
    return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function findPaths(source, destination) {

    const models = source.sequelize.models;
    const accountStoreHierarchy = [
        models.account,
        models.groupMembership,
        models.group,
        models.directory,
        models.organizationAccountStoreMapping,
        models.organization,
        models.accountStoreMapping,
        models.application
    ];

    return _(source.associations)
        .values()
        .filter(function (a) {
            return _.includes(accountStoreHierarchy, a.target) &&
                //go in the right direction
                sign(accountStoreHierarchy.indexOf(a.target) - accountStoreHierarchy.indexOf(source)) === sign(accountStoreHierarchy.indexOf(destination) - accountStoreHierarchy.indexOf(source)) &&
                //but don't go to far
                (a.target === destination || sign(accountStoreHierarchy.indexOf(destination) - accountStoreHierarchy.indexOf(a.target)) === sign(accountStoreHierarchy.indexOf(destination) - accountStoreHierarchy.indexOf(source))) &&
                //only direct associations to avoid duplicate paths
                a.associationType !== 'BelongsToMany' &&
                //remove default account or group store mappings
                !_.startsWith(a.as, 'default');
        })
        .map(function (a) {
            if (a.target === destination) {
                return [[a]];
            } else {
                return _(findPaths(a.target, destination))
                    .map(function (p) {
                        p.unshift(a);
                        return p;
                    })
                    .value();
            }
        })
        .filter(function (a) {
            return !_.isEmpty(a);
        })
        .reduce(function (reduced, a) {
            return reduced.concat(a);
        });
}

function addIncludes(parent, associations) {
    const models = parent.model.sequelize.models;
    const association = associations.shift();
    const include = {
        model: association.target,
        association: association,
        attributes: [],
        as: 'a', //short alias to avoid reaching Postgres' identifier max length
        required: true,
        parent: parent
    };

    if (association.options.scope) {
        if (association.associationType === 'BelongsTo') {
            //add a condition on the parent
            //e.g. for the association accountStoreMapping => directory, we need to add a condition on accountStoreMapping.accountStoreType
            parent.where = _.defaults({}, parent.where, association.options.scope);
        } else {
            //add a condition on the target
            //e.g. for the association directory => accountStoreMapping, we need to add a condition on accountStoreMapping.accountStoreType
            include.where = association.options.scope;
        }

    }

    if (_.isEmpty(associations)) {
        //last model: that's the one we want to get the IDs from
        include.attributes = ['id'];
        //special case: if the last model belongs to a directory (group or account), the directory must be enabled
        //(but this condition is already tested if "parent" is a directory)
        if (association.target.associations.hasOwnProperty('directory') && parent.model !== models.directory) {
            include.include = [{
                model: models.directory,
                association: association.target.associations.directory,
                attributes: [],
                as: 'd',
                required: true,
                parent: include,
                where: {status: 'ENABLED'}
            }];
        }
    } else {
        //intermediary models must all be enabled
        if (association.target.rawAttributes.hasOwnProperty('status')) {
            include.where = _.defaults({status: 'ENABLED'}, include.where);
        }
        addIncludes(include, associations);
    }
    parent.include = [include];
}

function selectIdsQueries(source, destination) {
    return _.map(findPaths(source, destination), function (path) {
        const options = {
            model: source,
            where: {id: '<%= id %>'},
            attributes: [],
            raw: true
        };
        addIncludes(options, path);
        return source.QueryGenerator.selectQuery(
            source.tableName,
            options,
            source);

    });
}

module.exports = function (source, destination) {
    const queryTemplates = _.map(selectIdsQueries(source, destination), function (query) {
        //remove trailing semicolon and put the subquery between brackets
        return _.template('(' + query.replace(/;$/, '') + ')');
    });
    source.addFindAndCount(destination, function (options) {
        return _.defaults(
            {
                where: {
                    [Op.and]: [
                        {
                            id: {[Op.or]: _.map(queryTemplates, queryTemplate => ({[Op.in]: this.sequelize.literal(queryTemplate({id: this.id}))}))}
                        },
                        _.get(options, 'where')
                    ]
                }
            },
            options
        );
    });
};