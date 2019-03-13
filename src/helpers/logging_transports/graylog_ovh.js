"use strict";

const Transport = require('winston-transport');
const tls = require("tls");
const pjson = require('../../../package.json');
const config = require('config');

const MESSAGE_LEVEL = {
    "silly":   7,
    "debug":   7,
    "verbose": 6,
    "data":    6,
    "prompt":  6,
    "input":   6,
    "info":    6,
    "help":    5,
    "notice":  5,
    "warn":    5,
    "warning": 5,
    "error":   3,
    "crit":    2,
    "alert":   1,
    "emerg":   0
};

class Message {

    constructor(winstonLevel, msg, meta) {
        this.level = Message.getMessageLevel(winstonLevel);
        this.meta = meta;
        this.msg = msg;
    }

    getMessageLevel(winstonLevel) {
        return Message.getMessageLevel(winstonLevel);
    }

    static getMessageLevel(winstonLevel) {
        if (MESSAGE_LEVEL.hasOwnProperty(winstonLevel)) {
            return MESSAGE_LEVEL[winstonLevel];
        }
        return 6;
    }
}

class GraylogOvhTransport extends Transport {
    constructor(options) {
        super(options);

        const extendedOptions = Object.assign({
            level: 'info',
            silent: false,
            autoReconnect: false,
            graylogHost: 'discover.logs.ovh.com',
            graylogPort: 12202,
            graylogHostname: require('os').hostname(),
            graylogFlag: 'no_flag',
            graylogOvhTokenKey: 'X-OVH-TOKEN',
            graylogOvhTokenValue: 'no_value',
            handleExceptions: false,
            version: pjson.version,
            environment: config.environment
        }, options);
        Object.keys(extendedOptions).forEach(key => {
            this[key] = extendedOptions[key];
        });

        // stack of messages to flush when connected
        this.messageStack = [];
    }

    getSocket(callback) {
        callback = (typeof callback === "function") ? callback : function () {};
        if (this.clientReady() || this.connecting) {
            callback();
            return;
        }
        this.connecting = true;
        this.client = tls.connect(this.graylogPort, this.graylogHost, () => {
            delete this.connecting;
            this.messageStack.forEach((message) => {
                this.flushMessage(message);
            });
            this.messageStack = [];
            callback();
        });

        this.client.on("error", (err) => {
            this.client.end();
            console.log("[FATAL LOGGER]", err);
            if (this.autoReconnect) {
                delete this.connecting;
                this.client = null;
            }
        });
    }

    close() {
        if (this.client) {
            this.client.end();
        }
    }

    flushMessage(message) {
        if (this.clientReady()) {
            this.client.write(this.getStrMessage(message));
        }
    }

    sendMessage(message) {
        if (this.clientReady()) {
            this.flushMessage(message);
        } else {
            this.messageStack.push(message);
        }
    }

    clientReady() {
        return this.client && this.client.getProtocol && !!this.client.getProtocol() && this.client.authorized;
    }

    getStrMessage(message) {
        var graylogMessage = {
            version:       "1.1",
            timestamp:     Math.round(new Date() / 1000),
            host:          this.graylogHostname,
            facility:      this.graylogFacility,
            flag:          this.graylogFlag,
            level:         message.level,
            short_message: message.msg
        };

        if (this.graylogOvhTokenKey && this.graylogOvhTokenKey.length) {
            graylogMessage[this.graylogOvhTokenKey] = this.graylogOvhTokenValue;
        }

        if (message.meta) {
            Object.keys(message.meta).forEach(key => {
                if (key !== "id") {
                    graylogMessage[key] = JSON.stringify(message.meta[key]);
                }
            });
            graylogMessage.full_message = JSON.stringify(message.meta);
        }

        return JSON.stringify(graylogMessage) + "\u0000";
    }

    log(info, done) {
        if (this.silent) {
            return done(null, true);
        }
        const tags = Object.assign({
            version: this.release,
            environment: this.environment
        }, info.tags);
        var message = new Message(info.level, info.message, tags);

        this.getSocket(() => {
            this.sendMessage(message);
        });
        done(null, true);
    }
}

GraylogOvhTransport.prototype.name = 'graylog_ovh';
module.exports = GraylogOvhTransport;
