const env = require('var');
const httpContext = require('express-http-context');
const {getLogger} = require('../../winstonInit');
const {REQUEST_ID_TYPE} = require('../../constants');

/**
 * @type {import('winston').logger}
 */
const logger = getLogger();

/**
 * Set request id in the log args
 * @param {Object} args
 */
const setRequestIdInLog = (args) => {
    const reqId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
    const userRequestId = httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID);
    // eslint-disable-next-line no-prototype-builtins
    if (reqId && args) {
        args.request = {
            ...args.request,
            // represents the id that is passed as header or req.id.
            id: userRequestId,
            // represents the server unique requestId and that is used in operations.
            systemGeneratedRequestId: reqId
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
        id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
        statusCode: error.statusCode,
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        body: req.body || {},
        user: getUserName(req),
        remoteAddress: getRemoteAddress(req),
        request: {
            // represents the id that is passed as header or req.id.
            id: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID),
            // represents the server unique requestId and that is used in operations.
            systemGeneratedRequestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
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
    logVerboseAsync,
    logErrorAndRequestAsync
};
