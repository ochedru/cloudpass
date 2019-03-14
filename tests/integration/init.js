const request = require('supertest');
const randomstring = require("randomstring");
const ms = require('smtp-tester');
const BluebirdPromise = require('sequelize').Promise;
const signJwt = BluebirdPromise.promisify(require('jsonwebtoken').sign);
const _ = require('lodash');

exports.postRequest = function (path) {
    return request(exports.servers.main).post('/v1/' + path)
        .auth(exports.apiKey.id, exports.apiKey.secret)
        .set('Content-Type', 'application/json');
};

exports.getRequest = function (path) {
    return request(exports.servers.main).get('/v1/' + path)
        .auth(exports.apiKey.id, exports.apiKey.secret);
};

exports.deleteRequest = function (path) {
    return request(exports.servers.main).del('/v1/' + path)
        .auth(exports.apiKey.id, exports.apiKey.secret);
};

exports.getMailServer = function () {
    return ms.init(20030, {disableDNSValidation: true});
};

exports.getEmailPromise = function (mailServer, address) {
    return BluebirdPromise.fromCallback(
        function (callback) {
            mailServer.bind(address, function handler(addr, id, email) {
                mailServer.unbind(address, handler);
                mailServer.remove(id);
                callback(null, email);
            });
        }
    ).timeout(10000);
};

exports.randomName = randomstring.generate;

exports.getIdSiteJwtRequest = function (applicationId, options) {
    return signJwt(
        options,
        exports.apiKey.secret,
        {
            issuer: exports.apiKey.id,
            subject: 'http://localhost:20020/v1/applications/' + applicationId,
            header: {kid: exports.apiKey.id}
        }
    );
};

exports.getIdSiteBearer = function (applicationId, options) {
    return exports.getIdSiteJwtRequest(applicationId, options)
        .then(jwtRequest =>
            //send it it cloudpass, it should redirect to ID site
            request(exports.servers.main).get('/sso')
                .query({jwtRequest})
                .expect(302)
        )
        .then(res => {
            const fragmentStart = '/#/?jwt=';
            return res.header.location.substring(res.header.location.indexOf(fragmentStart) + fragmentStart.length);
        });
};

exports.adminUser = 'test@example.com';
exports.adminPassword = 'Aa123456';

before(function () {
    return require('../../src/main')
        .then(function (servers) {
            //register (create a tenant)
            exports.servers = servers;
            return request(exports.servers.main)
                .post('/registration')
                .send('tenantNameKey=test-tenant')
                .send('email=' + exports.adminUser)
                .send('givenName=test')
                .send('surname=test')
                .send('password=' + exports.adminPassword)
                .expect(204);
        })
        .then(function () {
            //login
            return request(exports.servers.main)
                .post('/login')
                .send('tenantNameKey=test-tenant')
                .send('email=test@example.com')
                .send('password=Aa123456')
                .expect(204);
        })
        .then(function (res) {
            const cookie = res.header['set-cookie'][0].split(';')[0];
            return request(exports.servers.main)
                .get('/v1/accounts/current')
                .set('Cookie', cookie)
                .expect(302)
                .then(function (res) {
                    exports.adminUserId = res.header.location;
                    return request(exports.servers.main)
                        .post('/v1/accounts/' + exports.adminUserId + '/apiKeys')
                        .set('Cookie', cookie)
                        .expect(200);
                });
        })
        .then(function (res) {
            exports.apiKey = res.body;
        })
        .then(function () {
            //logout
            return request(exports.servers.main)
                .get('/logout')
                .expect(204);
        });

});

after(function () {
    _.values(exports.servers).forEach(_.method('close'));
    require('../../src/models').sequelize.close();
});
