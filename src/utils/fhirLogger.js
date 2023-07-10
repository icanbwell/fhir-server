const env = require('var');
const winston = require('winston');
const {MongoDB} = require('winston-mongodb');
const {isTrue} = require('./isTrue');
const Transport = require('winston-transport');
const {accessLogsMongoConfig} = require('../config');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * This transport is designed to swallow any logs
 * uses: https://www.npmjs.com/package/winston-transport
 */
class NullTransport extends Transport {
    constructor(opts) {
        super(opts);

        this.name = 'NullTransport';
    }

    log(info, callback) {
        callback();
        return this;
    }
}

/**
 * This implements the Singleton pattern
 * @type {FhirLogger}
 */
let fhirLoggerInstance;

class FhirLogger {
    // https://stackoverflow.com/questions/58371284/how-can-i-fix-error-configurationerror-missing-nodes-option-for-winston-elas

    /**
     * Constructor
     */
    constructor() {
        this._secureLogger = null;
        this._inSecureLogger = null;
    }

    /**
     * Gets the secure logger (creates it if it does not exist yet)
     * @return {Promise<Logger>}
     */
    static async getSecureLoggerAsync() {
        if (!fhirLoggerInstance) {
            fhirLoggerInstance = new FhirLogger();
        }
        return fhirLoggerInstance.getOrCreateSecureLoggerAsync();
    }

    /**
     * Gets the In Secure logger (creates it if it does not exist yet)
     * @return {Logger}
     */
    static async getInSecureLoggerAsync() {
        if (!fhirLoggerInstance) {
            fhirLoggerInstance = new FhirLogger();
        }
        return fhirLoggerInstance.getOrCreateInSecureLoggerAsync();
    }

    /**
     * Gets or creates a secure logger
     * @return {Logger}
     */
    async getOrCreateSecureLoggerAsync() {
        if (!this._secureLogger) {
            const release = await mutex.acquire();
            try {
                if (!this._secureLogger)
                {
                    this._secureLogger = await this.createSecureLoggerAsync();
                }
            } finally {
                release();
            }
        }

        return this._secureLogger;
    }

    /**
     * Gets or creates a secure logger
     * @return {Logger}
     */
    async getOrCreateInSecureLoggerAsync() {
        if (!this._inSecureLogger) {
            const release = await mutex.acquire();
            try {
                 if (!this._inSecureLogger)
                 {
                     this._inSecureLogger = await this.createInSecureLoggerAsync();
                 }
            } finally {
                release();
            }
        }

        return this._inSecureLogger;
    }

    /**
     * Creates a secure logger
     * @return {Logger}
     */
    async createSecureLoggerAsync() {
        const logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            defaultMeta: {service: env.DD_SERVICE || 'fhir-server'},
            transports: []
        });

        if (isTrue(env.ENABLE_MONGODB_ACCESS_LOGS)) {
            /**
             * @type {import('winston-mongodb').MongoDBTransportInstance}
             */
            const mongodbTransport = new MongoDB({
                db: accessLogsMongoConfig.connection,
                options: accessLogsMongoConfig.options,
                dbName: accessLogsMongoConfig.db_name,
                name: 'access_logs',
                expireAfterSeconds: env.ACCESS_LOGS_EXPIRE_TIME ? Number(env.ACCESS_LOGS_EXPIRE_TIME) : 30 * 24 * 60 * 60,
                collection: env.ACCESS_LOGS_COLLECTION_NAME ? String(env.ACCESS_LOGS_COLLECTION_NAME) : 'access_logs',
                format: winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] })
            });

            logger.add(mongodbTransport);

            mongodbTransport.on('error', (error) => {
                console.error(JSON.stringify({message: 'Error in mongodbTransport caught', error}));
            });
        } else {
            /**
             * @type {NullTransport}
             */
            const nullTransport = new NullTransport();
            // noinspection JSCheckFunctionSignatures
            logger.add(nullTransport);
        }

        if (env.LOGLEVEL === 'DEBUG') {
            logger.add(
                new winston.transports.Console({
                    format: winston.format.json()
                }));
        }

        // Compulsory error handling
        logger.on('error', (error) => {
            console.error(JSON.stringify({message: 'Error in fhirLogger caught', error}));
        });

        return logger;
    }

    /**
     * Creates an insecure logger
     * @return {Logger}
     */
    async createInSecureLoggerAsync() {
        const logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            defaultMeta: {service: env.DD_SERVICE || 'fhir-server'},
            transports: [
                (env.LOGLEVEL === 'DEBUG') ?
                    new NullTransport() : // the secure logger will write to console in debug mode
                    new winston.transports.Console({
                        format: winston.format.json()
                    })
            ]
        });

        // Compulsory error handling
        logger.on('error', (error) => {
            console.error(JSON.stringify({message: 'Error in fhirLogger caught', error}));
        });

        return logger;
    }

    static addLogging() {
        winston.add(winston.transports.Logstash);
    }
}

module.exports = {
    FhirLogger
};
