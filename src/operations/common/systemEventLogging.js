const env = require('var');
const moment = require('moment-timezone');
const httpContext = require('express-http-context');
const { REQUEST_ID_TYPE } = require('../../constants');

const os = require('os');
const { generateUUID } = require('../../utils/uid.util');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const fhirLogger = require('../../utils/fhirLogger').FhirLogger;

/**
 * Get detail array from args
 * @param  {Object} args
 * @returns {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
 */
const getDetailFromArgs = (args) => Object.entries(args).map(([k, v]) => {
    return {
        type: k,
        valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v, getCircularReplacer())
    };
});

/**
 * Logs a system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 */
const logSystemEventAsync = async ({ event, message, args }) => {
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = getDetailFromArgs(args);
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
        message,
        entity: [
            {
                name: 'system',
                detail
            }
        ]
    };
    logEntry.request = {
        // represents the id that is passed as header or req.id.
        id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
        // represents the server unique requestId and that is used in operations.
        systemGeneratedRequestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
    };
    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    fhirInSecureLogger.info(logEntry);
};

/**
 * Logs a trace system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 */
const logTraceSystemEventAsync = async ({ event, message, args }) => {
    if (env.LOGLEVEL === 'TRACE' || env.LOGLEVEL === 'DEBUG') {
        await logSystemEventAsync({ event, message, args });
    }
};

/**
 * Logs a system event
 * @param {string} event
 * @param {string} message
 * @param {Object} args
 * @param {Error|null} error
 */
const logSystemErrorAsync = async ({ event, message, args, error }) => {
    /**
     * @type {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
     */
    const detail = getDetailFromArgs(args);
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
        message: message + (error ? (' : ' + JSON.stringify(error.stack, getCircularReplacer())) : ''),
        entity: [
            {
                name: 'system',
                detail
            }
        ]
    };
    logEntry.request = {
        // represents the id that is passed as header or req.id.
        id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
        // represents the server unique requestId and that is used in operations.
        systemGeneratedRequestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
    };

    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    if (error) {
        fhirInSecureLogger.error(logEntry);
    } else {
        fhirInSecureLogger.info(logEntry);
    }
};

module.exports = {
    logTraceSystemEventAsync,
    logSystemEventAsync,
    logSystemErrorAsync
};
