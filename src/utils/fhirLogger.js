const env = require('var');
const winston = require('winston');
const {ElasticsearchTransport} = require('winston-elasticsearch');
const {Client} = require('@opensearch-project/opensearch');
const {isTrue} = require('./isTrue');
const assert = require('node:assert/strict');

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
     * @return {Logger}
     */
    static getSecureLogger() {
        if (!fhirLoggerInstance) {
            fhirLoggerInstance = new FhirLogger();
        }
        return fhirLoggerInstance.getOrCreateSecureLogger();
    }

    /**
     * Gets the In Secure logger (creates it if it does not exist yet)
     * @return {Logger}
     */
    static getInSecureLogger() {
        if (!fhirLoggerInstance) {
            fhirLoggerInstance = new FhirLogger();
        }
        return fhirLoggerInstance.getOrCreateInSecureLogger();
    }

    /**
     * Gets or creates a secure logger
     * @return {Logger}
     */
    getOrCreateSecureLogger() {
        if (!this._secureLogger) {
            this._secureLogger = this.createSecureLogger();
        }

        return this._secureLogger;
    }

    /**
     * Gets or creates a secure logger
     * @return {Logger}
     */
    getOrCreateInSecureLogger() {
        if (!this._inSecureLogger) {
            this._inSecureLogger = this.createInSecureLogger();
        }

        return this._inSecureLogger;
    }

    /**
     * Creates a secure logger
     * @return {Logger}
     */
    createSecureLogger() {
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
            }

            /**
             * @type {Client}
             */
            const client = new Client({
                node: node,
                ssl: {
                    rejectUnauthorized: false // env.IS_PRODUCTION // skip cert verification on local
                }
            });
            /**
             * @type {import('winston-elasticsearch').ElasticsearchTransportOptions}
             */
            const esTransportOpts = {
                level: 'info',
                client: client,
                indexPrefix: env.LOG_ELASTIC_SEARCH_PREFIX ? String(env.LOG_ELASTIC_SEARCH_PREFIX).toLowerCase() : 'logs'
            };

            /**
             * @type {ElasticsearchTransport}
             */
            const elasticsearchTransport = new ElasticsearchTransport(esTransportOpts);
            logger.add(elasticsearchTransport);
            elasticsearchTransport.on('error', (error) => {
                console.error('Error in elasticsearchTransport caught', error);
            });
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
    createInSecureLogger() {
        const logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            defaultMeta: {service: 'fhir-server'},
            transports: [
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
