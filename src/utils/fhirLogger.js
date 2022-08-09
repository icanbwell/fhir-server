const winston = require('winston');
const {ElasticsearchTransport} = require('winston-elasticsearch');
const {Client} = require('@opensearch-project/opensearch');

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
        // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/basic-config.html
        /**
         * @type {Client}
         */
        const client = new Client({
            node: 'https://admin:admin@elasticsearch:9200/',
            ssl: {
                rejectUnauthorized: false
            }
        });
        /**
         * @type {import('winston-elasticsearch').ElasticsearchTransportOptions}
         */
        const esTransportOpts = {
            level: 'info',
            client: client,
            // index: 'fhir_logs'
        };

        const elasticsearchTransport = new ElasticsearchTransport(esTransportOpts);
        const logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            defaultMeta: {service: 'user-service'},
            transports: [
                // new winston.transports.File({filename: 'combined.log'}),
                elasticsearchTransport
            ]
        });

        //
        // If we're not in production then log to the `console` with the format:
        // `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
        //
        if (process.env.NODE_ENV !== 'production') {
            logger.add(new winston.transports.Console({
                format: winston.format.json()
            }));
        }

        // Compulsory error handling
        logger.on('error', (error) => {
            console.error('Error in fhirLogger caught', error);
        });
        elasticsearchTransport.on('error', (error) => {
            console.error('Error in elasticsearchTransport caught', error);
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
