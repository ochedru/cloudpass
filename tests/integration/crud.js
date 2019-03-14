const assert = require("assert");
const init = require('./init');

describe('resource CRUD', function () {
    const directoryName = "test directory";
    let directoryId;

    it('creation', function () {
        return init.postRequest('directories')
                .send({name: directoryName})
                .expect(200)
                .then(function (res) {
                    directoryId = res.body.id;
                    assert.strictEqual(res.body.name, directoryName);
                    assert.strictEqual(res.body.description, '');
                });
    });

    it('update', function () {
        return init.postRequest('directories/' + directoryId)
                .send({description: directoryName})
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.description, directoryName);
                });
    });

    it('get custom data', function () {
        return init.getRequest('directories/' + directoryId + '/customData')
                .expect(200)
                .then(function (res) {
                    assert(res.body.href);
                    assert(res.body.createdAt);
                    assert(res.body.modifiedAt);
                });
    });

    it('update custom data', function () {
        return init.postRequest('directories/' + directoryId + '/customData')
                .send({a: 'b', c: 'd'})
                .expect(200)
                .then(function (res) {
                    assert.strictEqual(res.body.a, 'b');
                    assert.strictEqual(res.body.c, 'd');
                });
    });

    it('delete custom data field', function () {
        return init.deleteRequest('directories/' + directoryId + '/customData/a')
                .expect(204)
                .then(function () {
                    return init.getRequest('directories/' + directoryId + '/customData')
                        .expect(200);
                })
                .then(function (res) {
                    assert.strictEqual(res.body.a, undefined);
                    assert.strictEqual(res.body.c, 'd');
                });
    });

    it('delete custom data', function () {
        return init.deleteRequest('directories/' + directoryId + '/customData')
                .expect(204)
                .then(function () {
                    return init.getRequest('directories/' + directoryId + '/customData')
                        .expect(200);
                })
                .then(function (res) {
                    assert.strictEqual(res.body.a, undefined);
                    assert.strictEqual(res.body.c, undefined);
                });
    });

    it('delete', function () {
        return init.deleteRequest('directories/' + directoryId)
                .expect(204)
                .then(function () {
                    return init.getRequest('directories/' + directoryId)
                        .expect(404);
                });
    });

});