const env = require('var');
const moment = require('moment-timezone');

const os = require('os');
const { generateUUID } = require('../../utils/uid.util');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { logError, logInfo } = require('./logging');

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
        entity: [
            {
                name: 'system',
                detail
            }
        ]
    };

    logInfo(message, logEntry, 4);
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
        entity: [
            {
                name: 'system',
                detail
            }
        ]
    };
    const msg = message + (error ? (' : ' + JSON.stringify(error.stack, getCircularReplacer())) : '');

    if (error) {
        logError(msg, logEntry);
    } else {
        logInfo(msg, logEntry, 4);
    }
};

module.exports = {
    logTraceSystemEventAsync,
    logSystemEventAsync,
    logSystemErrorAsync
};
