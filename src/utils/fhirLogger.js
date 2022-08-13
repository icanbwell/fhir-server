const env = require('var');
const winston = require('winston');
const {ElasticsearchTransport} = require('winston-elasticsearch');
const {Client} = require('@opensearch-project/opensearch');
const {isTrue} = require('./isTrue');
const assert = require('node:assert/strict');
const {getElasticSearchParameterAsync} = require('./aws-ssm');
const Transport = require('winston-transport');

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
    // https://github.com/vanthome/winston-elasticsearch
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
                    this._secureLogger = await self.createSecureLoggerAsync();
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
                     this._inSecureLogger = await self.createInSecureLoggerAsync();
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
            defaultMeta: {service: 'fhir-server'},
            transports: []
        });

        if (isTrue(env.LOG_ELASTIC_SEARCH_ENABLE)) {
            // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/basic-config.html
            let node = env.LOG_ELASTIC_SEARCH_URL;
            assert(node, 'LOG_ELASTIC_SEARCH_URL environment variable is not defined but LOG_ELASTIC_SEARCH_ENABLE is set');
            console.info(`Logging to ${node}`);
            if (env.LOG_ELASTIC_SEARCH_USERNAME !== undefined && env.LOG_ELASTIC_SEARCH_PASSWORD !== undefined) {
                node = node.replace('https://', `https://${env.LOG_ELASTIC_SEARCH_USERNAME}:${env.LOG_ELASTIC_SEARCH_PASSWORD}@`);
            } else {
                const {username, password} = await getElasticSearchParameterAsync(env.ENV);
                assert(username);
                assert(typeof username === 'string');
                assert(password);
                assert(typeof password === 'string');
                console.info(`Logging to ${node} with username: ${username}`);
                node = node.replace('https://', `https://${username}:${password}@`);
            }

            /**
             * @type {Client}
             */
            const client = new Client({
                node: node,
                ssl: {
                    rejectUnauthorized: env.NODE_ENV !== 'development' // skip cert verification on local
                }
            });
            /**
             * @type {import('winston-elasticsearch').ElasticsearchTransportOptions}
             */
            const esTransportOpts = {
                level: 'info',
                client: client,
                indexPrefix: env.LOG_ELASTIC_SEARCH_PREFIX ?
                    String(env.LOG_ELASTIC_SEARCH_PREFIX).toLowerCase() :
                    'logs'
            };

            /**
             * @type {ElasticsearchTransport}
             */
            const elasticsearchTransport = new ElasticsearchTransport(esTransportOpts);
            logger.add(elasticsearchTransport);
            elasticsearchTransport.on('error', (error) => {
                console.error('Error in elasticsearchTransport caught', error);
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
            console.error('Error in fhirLogger caught', error);
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
            defaultMeta: {service: 'fhir-server'},
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
            console.error('Error in fhirLogger caught', error);
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
