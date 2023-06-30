const env = require('var');
const moment = require('moment-timezone');
const {getLogger} = require('../../winstonInit');
const httpContext = require('express-http-context');

/**
 * @type {import('winston').logger}
 */
const logger = getLogger();

const os = require('os');
const {generateUUID} = require('../../utils/uid.util');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const fhirLogger = require('../../utils/fhirLogger').FhirLogger;

/**
 * Set request id in the log args
 * @param {Object} args
 */
const setRequestIdInLog = (args) => {
    const reqId = httpContext.get('userRequestId');
    if (reqId) {
        args.request = {
            ...args.request,
            id: reqId,
        };
    }
};

/**
 * Always logs regardless of env.IS_PRODUCTION
 * @param {string} message
 * @param {Object} args
 */
const logInfo = (message, args) => {
    setRequestIdInLog(args);
    logger.info(message, args);
};

/**
 * Logs as info if env.IS_PRODUCTION is not set
 * @param {string} message
 * @param {Object} args
 */
const logDebug = (message, args) => {
    if ((!env.IS_PRODUCTION && env.LOGLEVEL !== 'INFO') || (env.LOGLEVEL === 'DEBUG')) {
        setRequestIdInLog(args);
        logger.debug(message, args);
    }
};

/**
 * Logs as error
 * @param {string} message
 * @param {Object} args
 */
const logError = (message, args) => {
    setRequestIdInLog(args);
    logger.error(message, args);
};

/**
 * Logs as warning
 * @param {string} message
 * @param {Object} args
 */
const logWarn = (message, args) => {
    setRequestIdInLog(args);
    logger.warn(message, args);
};

/**
 * Get detail array from args
 * @param  {Object} args
 * @returns {{valueString: string|undefined, valuePositiveInt: number|undefined, type: string}[]}
 */
const getDetailFromArgs = (args) => Object.entries(args).map(([k, v]) => {
    return {
        type: k,
        valueString: (!v || typeof v === 'string') ? v : JSON.stringify(v, getCircularReplacer()),
    };
});

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
        message: message,
        entity: [
            {
                name: 'system',
                detail: detail
            }
        ],
    };
    const reqId = httpContext.get('userRequestId');
    if (reqId) {
        logEntry.request = {
            id: reqId,
        };
    }
    const fhirSecureLogger = await fhirLogger.getSecureLoggerAsync();
    fhirSecureLogger.info(logEntry);
    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    fhirInSecureLogger.info(logEntry);
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
        message: message + (error ? (' : ' + JSON.stringify(error, getCircularReplacer())) : ''),
        entity: [
            {
                name: 'system',
                detail: detail
            }
        ],
    };
    const reqId = httpContext.get('userRequestId');
    if (reqId) {
        logEntry.request = {
            id: reqId,
        };
    }

    const fhirSecureLogger = await fhirLogger.getSecureLoggerAsync();
    if (error) {
        fhirSecureLogger.error(logEntry);
    } else {
        fhirSecureLogger.info(logEntry);
    }
    const fhirInSecureLogger = await fhirLogger.getInSecureLoggerAsync();
    if (error) {
        fhirInSecureLogger.error(logEntry);
    } else {
        fhirInSecureLogger.info(logEntry);
    }
};

/**
 * logs a verbose message
 * @param {string} source
 * @param {Object} args
 * @return {Promise<void>}
 */
const logVerboseAsync = async ({source, args: args}) => {
    if (env.LOGLEVEL === 'DEBUG') {
        logInfo(`${source}`, {args});
    }
};

/**
 * @param req
 * @returns {string}
 */
const getUserName = (req) => {
    return (!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id;
};

/**
 * Gets IP address of caller
 * @param {import('http').IncomingMessage} req
 * @returns {string | undefined}
 */
const getRemoteAddress = (req) => {
    return req.header('X-Forwarded-For') || req['x-real-ip'] || req.ip || req._remoteAddress || undefined;
};

/**
 * Logs error and request
 * @param {Error} error
 * @param {import('http').IncomingMessage} req
 */
const logErrorAndRequestAsync = async ({error, req}) => {
    const request = {
        id: req.id,
        statusCode: error.statusCode,
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        body: req.body || {},
        user: getUserName(req),
        remoteAddress: getRemoteAddress(req),
        request: {
            id: req.id
        }
    };
    const logData = {request, error};
    if (error.elapsedTimeInSecs) {
        logData.elapsedTimeInSecs = error.elapsedTimeInSecs;
    }
    logError(error.message, logData);
};

module.exports = {
    logInfo,
    logDebug,
    logError,
    logWarn,
    logTraceSystemEventAsync,
    logSystemEventAsync,
    logSystemErrorAsync,
    logVerboseAsync,
    logErrorAndRequestAsync
};
