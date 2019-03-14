const assert = require("assert");
const init = require('./init');

describe('tenant', function () {
    it('GET /tenant/current should redirect to current tenant', function () {
        return init.getRequest('tenants/current')
            .expect(302)
            .then(function (res) {
                assert.strictEqual(res.header.location, init.apiKey.tenantId);
            });
    });

    it('GET /tenant/{tenantId} should return the required tenant', function () {
        return init.getRequest('tenants/' + init.apiKey.tenantId)
            .expect(200)
            .then(function (res) {
                assert.strictEqual(res.body.key, 'test-tenant');
                assert.strictEqual(res.body.name, 'test-tenant');
            });
    });

    it('API keys should not give access to tenants other than its own', function () {
        return init.getRequest('tenants/randomUUID').expect(403);
    });

});