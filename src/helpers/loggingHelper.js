"use strict";

const winston = require('winston');
const _ = require('lodash');

const {combine, splat, simple, label, timestamp, colorize, printf} = winston.format;

exports.fromConfig = function (winstonConf, callback) {
    function createTransport(transportName) {
        const transportsConf = winstonConf.transports || {};
        const transportConf = transportsConf[transportName] || {};
        const moduleName = transportConf.module || transportName;
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
            winston.loggers.add(loggerName, {
                exitOnError: false,
                format: combine(
                    splat(),
                    simple(),
                    label({label: loggerName}),
                    timestamp(),
                    colorize(),
                    printf(info => {
                        return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
                    })
                ),
                level: loggerConf.level,
                transports: loggerConf.transports.map(createTransport)
            });
        }
    }
    callback();
};
