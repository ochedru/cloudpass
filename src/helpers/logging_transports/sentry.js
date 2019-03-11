"use strict";

const Transport = require('winston-transport');
const Sentry = require('@sentry/node');
const pjson = require('../../../package.json');
const config = require('config');

const winstonLevelToSentryLevel = {
    silly: 'debug',
    verbose: 'debug',
    info: 'info',
    debug: 'debug',
    warn: 'warning',
    error: 'error'
};

const prepareMeta = (info) => {
    let extra = Object.assign({}, info);
    delete extra.message;
    delete extra.level;
    delete extra.tags;
    delete extra.error;

    return {
        level: winstonLevelToSentryLevel[info.level],
        tags: info.tags || {},
        extra: extra
    };
};

class SentryTransport extends Transport {
    constructor(options) {
        super(options);

        this.options = Object.assign({
            dsn: '',
            release: pjson.version,
            environment: config.environment,
            tags: {},
            extra: {},
            beforeBreadcrumb(breadcrumb) {
                // discard console breadcrumbs
                return breadcrumb.category === 'console' ? null : breadcrumb;
            }
        }, options);

        this.sentry = Sentry;
        this.sentry.init(this.options);
    }

    log(info, done) {
        if (this.silent) {
            return done(null, true);
        }
        const meta = prepareMeta(info);
        this.sentry.configureScope((scope) => {
            scope.clear();
            scope.setLevel(meta.level);
            for (const [key, value] of Object.entries(Object.assign({}, this.options.tags, meta.tags))) {
                scope.setTag(key, value);
            }
            for (const [key, value] of Object.entries(Object.assign({}, this.options.extra, meta.extra))) {
                scope.setExtra(key, value);
            }
        });
        let eventId;
        if (info.error) {
            eventId = this.sentry.captureException(info.error);
        } else {
            eventId = this.sentry.captureMessage(info.message);
        }
        done(null, eventId);
    }
}

SentryTransport.prototype.name = 'sentry';
module.exports = SentryTransport;

