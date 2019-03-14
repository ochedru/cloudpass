"use strict";

// TODO temporary workaround for https://github.com/winstonjs/winston/issues/1430
const deepcopy = require('deepcopy');
const TransportStream = require('winston-transport');
const {LEVEL} = require('triple-beam');

TransportStream.prototype._write = function _write(info, enc, callback) {
    if (this.silent || (info.exception === true && !this.handleExceptions)) {
        return callback(null);
    }

    // Remark: This has to be handled in the base transport now because we
    // cannot conditionally write to our pipe targets as stream. We always
    // prefer any explicit level set on the Transport itself falling back to
    // any level set on the parent.
    const level = this.level || (this.parent && this.parent.level);

    if (!level || this.levels[level] >= this.levels[info[LEVEL]]) {
        if (info && !this.format) {
            return this.log(info, callback);
        }

        let errState;
        let transformed;

        // We trap(and re-throw) any errors generated by the user-provided format, but also
        // guarantee that the streams callback is invoked so that we can continue flowing.
        try {
            transformed = this.format.transform(deepcopy(info), this.format.options);
        } catch (err) {
            errState = err;
        }

        if (errState || !transformed) {
            // eslint-disable-next-line callback-return
            callback();
            if (errState) throw errState;
            return;
        }

        return this.log(transformed, callback);
    }

    return callback(null);
};
// TODO end workaround


const winston = require('winston');
const _ = require('lodash');
const {SPLAT} = require('triple-beam');
const {format} = require('logform');

const {combine, splat, simple, label, timestamp, colorize, printf} = winston.format;


exports.fromConfig = function (winstonConf, callback) {
    function createTransport(loggerName, transportName) {
        const transportsConf = winstonConf.transports || {};
        const moduleName = (transportsConf[transportName] != undefined ? transportsConf[transportName].module : undefined) || transportName;
        const formats = [splat(), simple(), label({label: loggerName}), timestamp()];
        if (moduleName === 'console') {
            formats.push(colorize());
        }
        formats.push(format(info => {
            if (info.message instanceof Error) {
                info.error = info.message;
            } else {
                const splat = info[SPLAT];
                if (splat) {
                    const error = splat.find(obj => obj instanceof Error);
                    if (error) {
                        info.error = info.error || error;
                    }
                    info.message = format.splat().transform(info).message;
                }
            }
            return info;
        })());
        formats.push(printf(info => {
            if (info.error && moduleName === 'console') {
                // add error stack, if any, to console
                const stack = info.error.stack || info.error.toString();
                return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}\n${stack}`;
            } else {
                return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
            }
        }));
        const transportConf = Object.assign({}, transportsConf[transportName], {
            format: combine(...formats)
        });
        try {
            return new (require(moduleName))(transportConf);
        } catch (e) {
            if (e instanceof Error) {
                try {
                    return new (require('./logging_transports/' + moduleName))(transportConf);
                } catch (e) {
                    if (e instanceof Error) {
                        return new winston.transports[_.upperFirst(moduleName)](transportConf);
                    } else {
                        throw e;
                    }
                }
            } else {
                throw e;
            }
        }
    }

    for (const loggerName in winstonConf.loggers) {
        if (Object.prototype.hasOwnProperty.call(winstonConf.loggers, loggerName)) {
            const loggerConf = winstonConf.loggers[loggerName];
            const transports = loggerConf.transports.map(t => createTransport(loggerName, t));
            winston.loggers.add(loggerName, {
                exitOnError: false,
                level: loggerConf.level,
                transports: transports
            });
        }
    }
    callback();
};

exports.logger = function (loggerName) {
    return winston.loggers.get(loggerName);
}
