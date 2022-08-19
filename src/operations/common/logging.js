const env = require('var');
const moment = require('moment-timezone');
const {getAccessCodesFromScopes, parseScopes} = require('../security/scopes');
/**
 * @type {import('winston').logger}
 */
const logger = require('@asymmetrik/node-fhir-server-core').loggers.get('default', {});
const os = require('os');
const {generateUUID} = require('../../utils/uid.util');
const fhirLogger = require('../../utils/fhirLogger').FhirLogger;

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
    if ((!env.IS_PRODUCTION && env.LOGLEVEL !== 'INFO') || (env.LOGLEVEL === 'DEBUG')) {
        logger.debug(user + ': ' + msg);
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
 * @property {string|undefined} [query]
 * @property {string|undefined} [result]
 */

/**
 * Logs a FHIR operation
 * @param {LogOperationParameters} options
 */
module.exports.logOperationAsync = async (options) => {
    const {
        requestInfo,
        args = [],
        resourceType,
        startTime,
        stopTime = Date.now(),
        message,
        action,
        error,
        query,
        result
    } = options;

    /**
     * resource can have PHI so we strip it out for insecure logger
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = Object.entries(args).filter(([k, _]) => k !== 'resource').map(([k, v]) => {
            return {
                type: k,
                valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v)
            };
        }
    );
    if (os.hostname()) {
        const hostname = os.hostname();
        detail.push({
            type: 'host',
            valueString: String(hostname)
        });
    }

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
    /**
     * @type {string[]}
     */
    const accessCodes = requestInfo.scope ?
        getAccessCodesFromScopes('read', requestInfo.user, requestInfo.scope)
        : [];
    /**
     * @type {string|null}
     */
    const firstAccessCode = (accessCodes && accessCodes.length > 0) ?
        (accessCodes[0] === '*' ? 'bwell' : accessCodes[0]) :
        null;

    // This uses the FHIR Audit Event schema: https://hl7.org/fhir/auditevent.html
    const logEntry = {
        id: requestInfo.requestId,
        type: {
            code: 'operation'
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
                type: {
                    text: firstAccessCode
                },
                altId: (!requestInfo.user || typeof requestInfo.user === 'string') ?
                    requestInfo.user :
                    requestInfo.user.id,
                network: {
                    address: requestInfo.remoteIpAddress
                },
                policy: parseScopes(requestInfo.scope)
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
    };
    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    // write the insecure information to insecure log
    fhirInSecureLogger.log(error ? 'error' : 'info', logEntry);
    // Now write out the secure logs
    if (requestInfo.body) {
        detail.push({
            type: 'body',
            valueString: (!requestInfo.body || typeof requestInfo.body === 'string') ?
                requestInfo.body :
                JSON.stringify(requestInfo.body)
        });
    }
    if (query) {
        detail.push({
            type: 'query',
            valueString: query
        });
    }
    if (result) {
        detail.push({
            type: 'result',
            valueString: result
        });
    }

    logEntry.entity[0].detail = detail;

    const fhirSecureLogger = await fhirLogger.getSecureLoggerAsync();
    // This uses the FHIR Audit Event schema: https://hl7.org/fhir/auditevent.html
    fhirSecureLogger.log(error ? 'error' : 'info', logEntry);
};

/**
 * Logs a system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 * @param {string|null} error
 */
module.exports.logSystemEventAsync = async (event, message, args, error = null) => {
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = Object.entries(args).map(([k, v]) => {
            return {
                type: k,
                valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v)
            };
        }
    );
    if (os.hostname()) {
        const hostname = os.hostname();
        detail.push({
            type: 'host',
            valueString: String(hostname)
        });
    }
    // This uses the FHIR Audit Event schema: https://hl7.org/fhir/auditevent.html
    const logEntry = {
        id: generateUUID(),
        type: {
            code: 'system'
        },
        action: event,
        recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
        outcome: error ? 8 : 0, // https://hl7.org/fhir/valueset-audit-event-outcome.html
        outcomeDesc: error ? 'Error' : 'Success',
        message: message,
        entity: [
            {
                name: 'system',
                detail: detail
            }
        ],
    };
    const fhirSecureLogger = await fhirLogger.getSecureLoggerAsync();
    fhirSecureLogger.log(error ? 'error' : 'info', logEntry);
    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    fhirInSecureLogger.log(error ? 'error' : 'info', logEntry);
};

/**
 * logs a verbose message
 * @param {string} source
 * @param {Object} messageJson
 * @return {Promise<void>}
 */
module.exports.logVerboseAsync = async (source, messageJson) => {
    if (env.LOGLEVEL === 'DEBUG') {
        console.log(`${source}: ${JSON.stringify(messageJson)}`);
    }
};
