"use strict";

const config = require('config');
const nodemailer = require('nodemailer');
const BluebirdPromise = require('sequelize').Promise;
const signJwt = BluebirdPromise.promisify(require('jsonwebtoken').sign);
const _ = require('lodash');
const Optional = require('optional-js');
const scopeHelper = require('./scopeHelper');
const hrefHelper = require('./hrefHelper');
const logger = require('./loggingHelper').logger;

const templateSettings = {interpolate: /\${([\w.]+?)}/g};
const accountFields = ['givenName', 'surname', 'fullName', 'username', 'email', 'failedLoginAttempts', 'directory'];
const directoryFields = ['name'];

// create reusable transporter object
const transportName = config.get('email.transport.name');
const transportOptions = config.get('email.transport.options');
const transporter = nodemailer.createTransport(
    Optional.ofNullable(transportName)
        .map(function (pluginName) {
            return require(pluginName)(transportOptions);
        })
        .orElse(transportOptions)
);
const transporterSendEmail = BluebirdPromise.promisify(transporter.sendMail, {context: transporter});

function getMandrillFields(mandrillTemplate, placeHolderValues) {
    return {
        //subject, content & from fields are provided by the template
        subject: null,
        text: null,
        html: null,
        from: null,
        mandrillOptions: {
            template_name: mandrillTemplate,
            template_content: [],
            message: {
                global_merge_vars: _(placeHolderValues)
                    .toPairs()
                    .map(_.partial(_.zipObject, ['name', 'content']))
                    .value()
            }
        }
    };
}

exports.send = function (account, directory, template, tokenId, additionalPlaceHolderValues) {
    const placeHolderValues = _.merge(
        //selection of account & directory fields
        {account: _.pick(_.defaults(account, {directory: _.pick(directory, directoryFields)}), accountFields)},
        //token related fields (url, name value pair...)
        Optional.ofNullable(tokenId).map(_.bindKey(template, 'getUrlTokens')).orElseGet(_.stubObject),
        //custom fields
        additionalPlaceHolderValues
    );

    const emailFields = _.defaults(
        {},
        //configuration fields
        config.get('email.fields'),
        //mandrill fields
        Optional.ofNullable(template.mandrillTemplate)
            .filter(() => _.eq(transportName, 'nodemailer-mandrill-transport'))
            .map(_.partial(getMandrillFields, _, placeHolderValues))
            .orElseGet(_.stubObject),
        //template fields
        {
            from: template.fromName + '<' + template.fromEmailAddress + '>',
            to: account.email,
            subject: template.subject,
            text: _.template(template.textBody, templateSettings)(placeHolderValues)
        },
        //Add html alternative only if the mime type is text/html
        Optional.of(template)
            .filter(_.flow(_.property('mimeType'), _.partial(_.eq, 'text/html')))
            .map(function (t) {
                return {html: _.template(t.htmlBody, templateSettings)(placeHolderValues)};
            })
            .orElseGet(_.stubObject)
    );

    return transporterSendEmail(emailFields)
        .tap(_.partial(logger('email').info, 'email sent:\n%j'))
        .catch(_.partial(logger('email').error, 'could not send email: %s'));
};

exports.sendWithToken = function (account, directory, template, token, authInfo, apiKey, additionalPlaceHolderValues) {
    return BluebirdPromise.try(function () {
        if (_.get(authInfo, 'aud') === 'idSite') {
            return signJwt(
                _.merge(
                    _.omit(authInfo, ['jti', 'iat', 'exp']), {
                        scope: scopeHelper.pathsToScope(_.merge(
                            scopeHelper.scopeToPaths(authInfo.scope),
                            //allow get & post on to the token
                            {[hrefHelper.unqualifyHref(token.href)]: ['get', 'post']}
                        )),
                        sp_token: token.id
                    }
                ),
                apiKey.secret,
                {}
            )
                .then(function (jwt) {
                    return account.sequelize.models.idSite.findOne({
                        where: {
                            tenantId: apiKey.tenantId
                        }
                    })
                        .then(function (idSite) {
                            return idSite.url + token.getIdSitePath() + '?jwt=' + jwt;
                        });
                });
        }
    })
        .then(function (url) {
            //asynchronously send an email with the token
            exports.send(
                account,
                directory,
                template,
                token.id,
                _.merge({url}, additionalPlaceHolderValues)
            );
        });
};
