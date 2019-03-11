"use strict";

const winston = require('winston');
const _ = require('lodash');
const {SPLAT} = require('triple-beam');
const {format} = require('logform');

const {combine, splat, simple, label, timestamp, colorize, printf} = winston.format;

exports.fromConfig = function (winstonConf, callback) {
    function createTransport(loggerName, transportName) {
        const transportsConf = winstonConf.transports || {};
        const moduleName =  (transportsConf[transportName] != undefined ? transportsConf[transportName].module : undefined) || transportName;
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
            if (moduleName === 'console' && info.error) {
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
