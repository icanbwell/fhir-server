const env = require('var');
const moment = require('moment-timezone');
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
        console.log(JSON.stringify({message: `${source}: ${JSON.stringify(messageJson)}`}));
    }
};
