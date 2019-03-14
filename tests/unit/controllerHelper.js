const assert = require("assert");
const Op = require('sequelize').Op;
const controllerHelper = require('rewire')('../../src/api/helpers/controllerHelper');

describe('controllerHelper', function () {

    const getOrderClause = controllerHelper.__get__("getOrderClause");

    describe('getOrderClause', function () {
        it('should preserve clause order', function () {
            assert.deepStrictEqual(
                getOrderClause(['id', 'name', 'description']),
                ['id', 'name', 'description']
            );
        });

        it('should take into account ordering direction', function () {
            assert.deepStrictEqual(
                getOrderClause(['id', 'name ASC', 'description DESC']),
                ['id', 'name', ['description', 'DESC']]
            );
        });

        it('should throw an error in case of invalid clause', function () {
            assert.throws(
                function () {
                    getOrderClause(['id', 'name ASC foo']);
                },
                function (error) {
                    return error.status === 400 && error.code === 2104;
                }
            );

        });

        it('should return a default ordering clause if none is provided', function () {
            assert.deepStrictEqual(
                getOrderClause(),
                [['id', 'ASC']]
            );
        });
    });

    describe('parseExpandParam', function () {

        it('should return an empty object if no expand parameter is provided', function () {
            assert.deepStrictEqual(
                controllerHelper.parseExpandParam(),
                {}
            );
            assert.deepStrictEqual(
                controllerHelper.parseExpandParam(''),
                {}
            );
        });

        it('should correctly parse pagination options', function () {
            assert.deepStrictEqual(
                controllerHelper.parseExpandParam('groups(offset:2,limit:10)'),
                {groups: {offset: 2, limit: 10}}
            );
        });

        it('should add default pagination options if some are missing', function () {
            assert.deepStrictEqual(
                controllerHelper.parseExpandParam('groups(limit:10)'),
                {groups: {offset: 0, limit: 10}}
            );

            assert.deepStrictEqual(
                controllerHelper.parseExpandParam('groups(offset:2)'),
                {groups: {offset: 2, limit: 25}}
            );
        });

        it('should add default pagination options if all are missing', function () {
            assert.deepStrictEqual(
                controllerHelper.parseExpandParam('groups'),
                {groups: {offset: 0, limit: 25}}
            );
        });

        it('should fail if an invalid pagination option is passed', function () {
            assert.throws(function () {
                controllerHelper.parseExpandParam('groups(size:10)');
            });
        });

        it('should parse multiple expand parameters', function () {
            assert.deepStrictEqual(
                controllerHelper.parseExpandParam('groups(limit:10),directories,tenants(limit:3,offset:8)'),
                {
                    groups: {offset: 0, limit: 10},
                    directories: {offset: 0, limit: 25},
                    tenants: {offset: 8, limit: 3}
                }
            );
        });

    });

    describe('getCollectionQueryOption', function () {
        function forgeRequest(offset, limit, orderBy, queryParams) {
            return {
                swagger: {
                    params: {
                        offset: {value: offset},
                        limit: {value: limit},
                        orderBy: {value: orderBy}
                    }
                },
                query: queryParams || {}
            };
        }
        ;
        const unsearcheable = {
            getSearchableAttributes: function () {
                return [];
            }
        };
        const getCollectionQueryOptions = controllerHelper.__get__("getCollectionQueryOptions");
        const models = require('../../src/models');

        it('should use default pagination if none provided', function () {
            const options = getCollectionQueryOptions(forgeRequest(), unsearcheable);
            assert.strictEqual(options.offset, 0);
            assert.strictEqual(options.limit, 25);
        });

        it('should use provided pagination', function () {
            const options = getCollectionQueryOptions(forgeRequest(2, 10), unsearcheable);
            assert.strictEqual(options.offset, 2);
            assert.strictEqual(options.limit, 10);
        });

        it('should use ascending sort order by default', function () {
            const options = getCollectionQueryOptions(forgeRequest(undefined, undefined, ['name']), unsearcheable);
            assert.deepStrictEqual(options.order, ['name']);
        });

        it('should use the provided sort order', function () {
            let options = getCollectionQueryOptions(forgeRequest(undefined, undefined, ['name ASC']), unsearcheable);
            assert.deepStrictEqual(options.order, ['name']);

            options = getCollectionQueryOptions(forgeRequest(undefined, undefined, ['name DESC']), unsearcheable);
            assert.deepStrictEqual(options.order, [['name', 'DESC']]);
        });

        it('should fail in case of invalid orderBy clause', function () {
            assert.throws(function () {
                getCollectionQueryOptions(forgeRequest(undefined, undefined, ['name desc wtf']), unsearcheable);
            });
        });

        it('should add a where clauses for searchable attributes', function () {
            const options = getCollectionQueryOptions(forgeRequest(undefined, undefined, undefined, {email: 'test'}), models.account);
            assert(options.where);
        });

        it('should ignore unsearcheable attributes', function () {
            const options = getCollectionQueryOptions(forgeRequest(undefined, undefined, undefined, {wtf: 'test'}), models.account);
            assert(options.where === undefined);
        });

        it('should add one where clause per searchable attributes if "q" parameter is provided', function () {
            const options = getCollectionQueryOptions(forgeRequest(undefined, undefined, undefined, {q: 'test'}), models.account);
            assert(options.where);
            assert(options.where[Op.or]);
            assert.strictEqual(options.where[Op.or].length, models.account.searchableAttributes.length);
        });

        it('should mix "q" and other where clauses', function () {
            const options = getCollectionQueryOptions(forgeRequest(undefined, undefined, undefined, {
                q: 'test',
                email: 'test'
            }), models.account);
            assert(options.where);
            assert(options.where[Op.and]);
            assert.strictEqual(options.where[Op.and].length, 2);
        });
    });

    it('escapeLikeParam', function () {
        it('should escape reserved characters in like clause', function () {
            assert.strictEqual(controllerHelper.__get__("escapeLikeParam")('_foo%\\'), '\\_foo\\%\\\\');
        });
    });
});