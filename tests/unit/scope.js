const assert = require("assert");
const scopeHelper = require('../../src/helpers/scopeHelper');
const isRequestAllowed = require('rewire')('../../src/apps/helpers/scopeChecker').__get__('isRequestAllowed');

const scope = {
    applications: {
        $id: [
            'get',
            'post',
            {'loginAttempts': ['post']},
            {'idSiteModel': ['get']},
            {'accounts': ['delete']}
        ]
    }
};

describe('scope', function () {

    describe('scopeHelper.getIdSiteScope', function () {
        it('should merge correctly the scopes of the provided instances', function () {
            assert.deepStrictEqual(
                scopeHelper.getIdSiteScope(
                    {
                        id: 'application1',
                        constructor: {
                            getIdSiteScope: () => 'application1-scope',
                            options: {name: {plural: 'applications'}}
                        }
                    },
                    {
                        id: 'application1',
                        constructor: {
                            getIdSiteScope: () => 'application1-scope',
                            options: {name: {plural: 'applications'}}
                        }
                    },
                    {
                        id: 'application2',
                        constructor: {
                            getIdSiteScope: () => 'application2-scope',
                            options: {name: {plural: 'applications'}}
                        }
                    },
                    {
                        id: 'organization1',
                        constructor: {
                            getIdSiteScope: () => 'organization1-scope',
                            options: {name: {plural: 'organizations'}}
                        }
                    }
                ),
                {
                    applications: {
                        application1: 'application1-scope',
                        application2: 'application2-scope'
                    },
                    organizations: {
                        organization1: 'organization1-scope'
                    }
                }
            );
        });
    });

    describe('scopeHelper.scopeToPaths', function () {
        it('should converts bearer scopes into API endpoint paths', function () {
            assert.deepStrictEqual(
                scopeHelper.scopeToPaths(scope),
                {
                    '/applications/$id': ['get', 'post'],
                    '/applications/$id/loginAttempts': ['post'],
                    '/applications/$id/idSiteModel': ['get'],
                    '/applications/$id/accounts': ['delete']
                }
            );
        });
    });

    describe('scopeHelper.pathsToScope', function () {
        it('should converts API enpoint paths into bearer scopes', function () {
            assert.deepStrictEqual(
                scopeHelper.pathsToScope({
                    '/applications/$id': ['get', 'post'],
                    '/applications/$id/loginAttempts': ['post'],
                    '/applications/$id/idSiteModel': ['get'],
                    '/applications/$id/accounts': ['delete']
                }),
                scope
            );
        });
    });

    describe('scopeChecker', function () {
        it('should allow unscoped requests', function () {
            assert(isRequestAllowed({}));
            assert(isRequestAllowed({authInfo: {}}));
        });

        it('should allow requests within their scope', function () {
            assert(isRequestAllowed(
                {
                    authInfo: {
                        scope: scope
                    },
                    path: '/applications/$id',
                    method: 'get',
                    query: {}
                }
            ));
        });

        it('should allow expanding requests within their scope', function () {
            assert(isRequestAllowed(
                {
                    authInfo: {
                        scope: scope
                    },
                    path: '/applications/$id',
                    method: 'get',
                    query: {expand: 'idSiteModel'}
                }
            ));
        });

        it('should forbid requests with a path outside of their scope', function () {
            assert(!isRequestAllowed(
                {
                    authInfo: {
                        scope: scope
                    },
                    path: '/applications/$id/accounts',
                    method: 'get',
                    query: {}
                }
            ));
        });

        it('should forbid requests with a method outside of their scope', function () {
            assert(!isRequestAllowed(
                {
                    authInfo: {
                        scope: scope
                    },
                    path: '/applications/$id',
                    method: 'delete',
                    query: {}
                }
            ));
        });

        it('should forbid expanding requests outside of their scope', function () {
            assert(!isRequestAllowed(
                {
                    authInfo: {
                        scope: scope
                    },
                    path: '/applications/$id',
                    method: 'get',
                    query: {expand: 'idSiteModel,accounts(limit:100)'}
                }
            ));
        });
    });
});