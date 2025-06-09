const winston = require('winston');
const Transport = require('winston-transport');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * This transport is designed to swallow any logs
 * uses: https://www.npmjs.com/package/winston-transport
 */
class NullTransport extends Transport {
    constructor (opts) {
        super(opts);

        this.name = 'NullTransport';
    }

    log (info, callback) {
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
    constructor () {
        this._inSecureLogger = null;
    }

    /**
     * Gets the In Secure logger (creates it if it does not exist yet)
     * @return {Logger}
     */
    static async getInSecureLoggerAsync () {
        if (!fhirLoggerInstance) {
            fhirLoggerInstance = new FhirLogger();
        }
        return fhirLoggerInstance.getOrCreateInSecureLoggerAsync();
    }

    /**
     * Gets or creates a secure logger
     * @return {Logger}
     */
    async getOrCreateInSecureLoggerAsync () {
        if (!this._inSecureLogger) {
            const release = await mutex.acquire();
            try {
                if (!this._inSecureLogger) {
                    this._inSecureLogger = await this.createInSecureLoggerAsync();
                }
            } finally {
                release();
            }
        }

        return this._inSecureLogger;
    }

    /**
     * Creates an insecure logger
     * @return {Logger}
     */
    async createInSecureLoggerAsync () {
        const logger = winston.createLogger({
            level: process.env.LOGLEVEL ? process.env.LOGLEVEL.toLowerCase() : 'info',
            format: winston.format.json(),
            transports: [
                (process.env.LOGLEVEL === 'DEBUG')
                    ? new NullTransport() // the secure logger will write to console in debug mode
                    : new winston.transports.Console({
                        format: winston.format.json()
                    })
            ]
        });

        // Compulsory error handling
        logger.on('error', (error) => {
            console.error(JSON.stringify({ message: 'Error in fhirLogger caught', error }));
        });

        return logger;
    }

    static addLogging () {
        winston.add(winston.transports.Logstash);
    }
}

module.exports = {
    FhirLogger
};
