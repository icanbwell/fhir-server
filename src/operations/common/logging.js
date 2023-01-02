const env = require('var');
const moment = require('moment-timezone');
const {
    container
} = require('../../winstonInit');

/**
 * @type {import('winston').logger}
 */
const logger = container.get('default');

const os = require('os');
const {generateUUID} = require('../../utils/uid.util');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const fhirLogger = require('../../utils/fhirLogger').FhirLogger;

/**
 * Always logs regardless of env.IS_PRODUCTION
 * @param {string} user
 * @param {Object} args
 */
const logRequest = ({user, args}) => {
    logger.info(JSON.stringify({user, args}));
};

/**
 * Logs as info if env.IS_PRODUCTION is not set
 * @param {string} user
 * @param {Object} args
 */
const logDebug = ({user, args}) => {
    if ((!env.IS_PRODUCTION && env.LOGLEVEL !== 'INFO') || (env.LOGLEVEL === 'DEBUG')) {
        logger.debug(JSON.stringify({user, args}));
    }
};

/**
 * Logs as error
 * @param {string} user
 * @param {Object} args
 */
const logError = ({user, args}) => {
    logger.error(JSON.stringify({user, args}));
};

/**
 * Logs as warning
 * @param {string} user
 * @param {Object} args
 */
const logWarn = ({user, args}) => {
    logger.warn(JSON.stringify({user, args}));
};

/**
 * Logs a system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 */
const logSystemEventAsync = async ({event, message, args}) => {
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = Object.entries(args).map(([k, v]) => {
            return {
                type: k,
                valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v, getCircularReplacer())
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
        outcome: 0, // https://hl7.org/fhir/valueset-audit-event-outcome.html
        outcomeDesc: 'Success',
        message: message,
        entity: [
            {
                name: 'system',
                detail: detail
            }
        ],
    };
    const fhirSecureLogger = await fhirLogger.getSecureLoggerAsync();
    fhirSecureLogger.log('info', logEntry);
    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    fhirInSecureLogger.log('info', logEntry);
};

/**
 * Logs a trace system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 */
const logTraceSystemEventAsync = async ({event, message, args}) => {
    if (env.LOGLEVEL === 'TRACE' || env.LOGLEVEL === 'DEBUG') {
        await logSystemEventAsync({event, message, args});
    }
};


/**
 * Logs a system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 * @param {Error|null} error
 */
const logSystemErrorAsync = async ({event, message, args, error}) => {
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = Object.entries(args).map(([k, v]) => {
            return {
                type: k,
                valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v, getCircularReplacer())
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
        message: message + (error ? (' : ' + JSON.stringify(error, getCircularReplacer())) : ''),
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
 * @param {Object} args
 * @return {Promise<void>}
 */
const logVerboseAsync = async ({source, args: args}) => {
    if (env.LOGLEVEL === 'DEBUG') {
        console.log(JSON.stringify({message: `${source}: ${JSON.stringify(args, getCircularReplacer())}`}));
    }
};

module.exports = {
    logRequest,
    logDebug,
    logError,
    logWarn,
    logTraceSystemEventAsync,
    logSystemEventAsync,
    logSystemErrorAsync,
    logVerboseAsync,
};
