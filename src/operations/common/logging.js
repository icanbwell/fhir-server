const env = require('var');
const moment = require('moment-timezone');
/**
 * @type {import('winston').logger}
 */
const logger = require('@asymmetrik/node-fhir-server-core').loggers.get();

const fhirLogger = require('../../utils/fhirLogger').FhirLogger.getLogger();

/**
 * Always logs regardless of env.IS_PRODUCTION
 * @param {string} user
 * @param {*} msg
 */
module.exports.logRequest = (user, msg) => {
    logger.info(user + ': ' + msg);
};

/**
 * Logs as info if env.IS_PRODUCTION is not set
 * @param {string} user
 * @param {*} msg
 */
module.exports.logDebug = (user, msg) => {
    if (!env.IS_PRODUCTION || (env.LOGLEVEL === 'DEBUG')) {
        logger.info(user + ': ' + msg);
    }
};

/**
 * Logs as error
 * @param {string} user
 * @param {*} msg
 */
module.exports.logError = (user, msg) => {
    logger.error(user + ': ' + msg);
};

/**
 * Logs as warning
 * @param {string} user
 * @param {*} msg
 */
module.exports.logWarn = (user, msg) => {
    logger.warn(user + ': ' + msg);
};

/**
 * @typedef LogOperationParameters
 * @type {object}
 * @property {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @property {Object} args
 * @property {string} resourceType
 * @property {number|null} startTime
 * @property {string} message
 * @property {string} action
 * @property {Error|undefined} error
 * @property {string|undefined} query
 */

/**
 * Logs a FHIR operation
 * @param {LogOperationParameters} options
 */
module.exports.logOperation = (options) => {
    const {
        requestInfo,
        args,
        resourceType,
        startTime,
        stopTime = Date.now(),
        message,
        action,
        error,
        query
    } = options;
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = Object.entries(args).map(([k, v]) => {
            return {
                type: k,
                valueString: (typeof v === 'string') ? v : JSON.stringify(v)
            };
        }
    );
    if (startTime && stopTime) {
        /**
         * @type {number}
         */
        const elapsedMilliSeconds = stopTime - startTime;
        detail.push({
            type: 'duration',
            valuePositiveInt: elapsedMilliSeconds
        });
    }
    if (requestInfo.body) {
        detail.push({
            type: 'body',
            valueString: (typeof requestInfo.body === 'string') ? requestInfo.body : JSON.stringify(requestInfo.body)
        });
    }
    if (query) {
        detail.push({
            type: 'query',
            valueString: query
        });
    }
    // This uses the FHIR Audit Event schema: https://hl7.org/fhir/auditevent.html
    fhirLogger.info(
        {
            id: requestInfo.requestId,
            type: {
                code: 'fhirServer'
            },
            action: action,
            period: {
                start: new Date(startTime).toISOString(),
                end: new Date(stopTime).toISOString(),
            },
            recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
            outcome: error ? 8 : 0, // https://hl7.org/fhir/valueset-audit-event-outcome.html
            outcomeDesc: error ? 'Error' : 'Success',
            agent: [
                {
                    altId: (typeof requestInfo.user === 'string') ? requestInfo.user : requestInfo.user.id,
                    network: {
                        address: requestInfo.remoteIpAddress
                    },
                    policy: [
                        requestInfo.scope
                    ]
                }
            ],
            source: {
                site: requestInfo.originalUrl
            },
            entity: [
                {
                    name: resourceType,
                    detail: detail
                }
            ],
            message: error ? `${message}: ${JSON.stringify(error)}` : message
        }
    );
};
