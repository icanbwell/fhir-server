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
 * Logs a FHIR operation
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string | null} scope
 * @param {string} resourceType
 * @param {number|null} startTime
 * @param {number|null} stopTime
 * @param {string} message
 * @param {string} action
 * @param {Error|null} error
 */
module.exports.logOperation = (requestInfo, args,
                               scope, resourceType,
                               startTime, stopTime,
                               message, action, error = null) => {
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    let detail = Object.entries(args).map(([k, v]) => {
            return {
                type: k,
                valueString: JSON.stringify(v)
            };
        }
    );
    if (startTime && stopTime) {
        /**
         * @type {number}
         */
        const elapsedSeconds = stopTime - startTime;
        detail.push({
            type: 'duration',
            valuePositiveInt: elapsedSeconds
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
                        scope
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
            message: error ? JSON.stringify(error) : message
        }
    );
};
