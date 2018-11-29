'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var models = require('../models');
var ssacl = require('ssacl');
var ApiError = require('../ApiError.js');

var app = express();
app.use(bodyParser.urlencoded({extended: true}));

app.get('/', function(req, res){
    models.adminInvitation.findById(
            req.query.cpToken,
            {
                include: [
                    {
                        model: models.account,
                        as: 'fromAccount',
                        attributes: ['givenName', 'middleName', 'surname']
                    },
                    {
                        model: models.tenant,
                        attributes: ['key']
                    }
                ],
                actor: new ssacl.Omnipotent()
            }
        )
        .then(function(invitation){
            ApiError.assert(invitation, ApiError, 400, 400, 'Invitation not found');
            res.json(invitation.get());
        });
});

app.post('/', function(req, res){
    models.sequelize.transaction(function(){
        return models.adminInvitation.findById(
            req.body.invitationId,
            {actor: new ssacl.Omnipotent()}
        )
        .then(function(invitation){
            ApiError.assert(invitation, ApiError, 400, 400, 'Invitation not found');
            req.app.get('ssaclCls').set('actor', invitation.tenantId);
            return models.directory.findOne({
               where: {name: 'Cloudpass Administrators'}
            })
            .then(function(directory){
               return directory.createNewAccount(
                   {
                       givenName: req.body.givenName,
                       surname: req.body.surname,
                       email: invitation.email,
                       password: req.body.password
                   },
                   false
               );
           })
           .then(function(){
               return invitation.destroy();
           });
       });
    })
    .then(function(){ res.status(204).json(); })
    .catch(req.next);
});

app.use(function (err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }
    //return an error code corresponding to the error
    res.status(ApiError.FROM_ERROR(err).status).send();
});

module.exports=app;