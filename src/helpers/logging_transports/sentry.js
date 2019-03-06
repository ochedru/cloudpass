const _ = require('lodash');
const Raven = require('raven');
const Transport = require('winston-transport');

function errorHandler(err) {
    console.error(err.message);
}

class SentryTransport extends Transport {

    constructor(opts) {
        let options = opts || {};
        options = _.defaultsDeep(options, {
            dsn: process.env.SENTRY_DSN || '',
            config: {
                logger: 'sentry',
                captureUnhandledRejections: false
            },
            errorHandler,
            install: false,
            name: 'sentry',
            silent: false,
            level: 'info'
        });
        super(_.omit(options, [
            'level',
            'install',
            'dsn',
            'config',
            'tags',
            'globalTags',
            'extra',
            'errorHandler',
            'raven'
        ]));

        if (options.tags) {
            options.config.tags = options.tags;
        } else if (options.globalTags) {
            options.config.tags = options.globalTags;
        }

        if (options.extra) {
            options.config.extra = options.config.extra || {};
            options.config.extra = _.defaults(
                options.config.extra,
                options.extra
            );
        }

        // expose the instance on the transport
        this.raven = options.raven || Raven.config(options.dsn, options.config);

        if (_.isFunction(options.errorHandler) && this.raven.listeners('error').length === 0) {
            this.raven.on('error', options.errorHandler);
        }

        // it automatically will detect if it's already installed
        if (options.install || options.patchGlobal) {
            this.raven.install();
        }

    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        if (this.silent) {
        } else {

            const message = this._normalizeMessage(msg, meta);
            const context = _.isObject(meta) ? meta : {};
            context.level = this._levelsMap[level];
            context.extra = this._normalizeExtra(msg, meta);

            if (this._shouldCaptureException(context.level))
                return this.raven.captureException(message, context, function () {
                    fn(null, true);
                });

            this.raven.captureMessage(message, context, function () {
                callback();
            });
        }

        callback();
    }
};


module.exports = SentryTransport;