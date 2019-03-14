const assert = require("assert");
const models = require('../../src/models');
const hrefHelper = require('../../src/helpers/hrefHelper');

describe('hrefHelper', function () {
    it('getRootUrl', function () {
        assert.strictEqual(hrefHelper.getRootUrl('http://www.example.com/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140'), 'http://www.example.com');
        assert.strictEqual(hrefHelper.getRootUrl('http://www.example.com/id/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140'), 'http://www.example.com/id');
    });

    it('getBaseUrl', function () {
        assert.strictEqual(hrefHelper.getBaseUrl('http://www.example.com/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140'), 'http://www.example.com/v1');
        assert.strictEqual(hrefHelper.getBaseUrl('http://www.example.com/id/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140'), 'http://www.example.com/id/v1');
    });

    it('unqualifyHref', function () {
        assert.strictEqual(hrefHelper.unqualifyHref('http://www.example.com/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140'), '/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140');
        assert.strictEqual(hrefHelper.unqualifyHref('http://www.example.com/id/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140'), '/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140');
    });

    it('resolveHref', function () {
        const instance = hrefHelper.resolveHref('http://www.example.com/v1/tenants/3e6447e7-39db-473e-a30f-d5be9f9b8140');
        assert.strictEqual(instance.constructor, models.tenant);
        assert.strictEqual(instance.id, '3e6447e7-39db-473e-a30f-d5be9f9b8140');
    });

});