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
    }

    static getLogger() {
        if (!fhirLoggerInstance) {
            fhirLoggerInstance = new FhirLogger();
        }
        return fhirLoggerInstance.getOrCreateLogger();
    }

    getOrCreateLogger() {
        if (!this._logger) {
            this._logger = this.createLogger();
        }

        return this._logger;
    }

    createLogger() {
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


        if (isTrue(env['ENABLE_ELASTIC_SEARCH_LOGGING'])) {
            // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/basic-config.html
            let node = env.ELASTIC_SEARCH_LOG_URL;
            assert(node, 'ELASTIC_SEARCH_LOG_URL environment variable is not defined but ENABLE_ELASTIC_SEARCH_LOGGING is set');
            if (env.ELASTIC_SEARCH_LOG_USERNAME !== undefined && env.ELASTIC_SEARCH_LOG_PASSWORD !== undefined) {
                node = node.replace('https://', `https://${env.ELASTIC_SEARCH_LOG_USERNAME}:${env.ELASTIC_SEARCH_LOG_PASSWORD}@`);
            }
            console.log(`Logging to ${node}`);
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
                client: client
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

    static addLogging() {
        winston.add(winston.transports.Logstash);
    }
}

module.exports = {
    FhirLogger
};
