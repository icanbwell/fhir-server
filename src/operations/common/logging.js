const env = require('var');
const httpContext = require('express-http-context');
const { getLogger } = require('../../winstonInit');
const { REQUEST_ID_TYPE } = require('../../constants');

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
 * Adds filename with line number in the args
 * @param {Object} args
 * @param {Number} level denotes the level at which the file which called Log method is present
 */
const setFileDetailsInLog = (args, level) => {
    // use the error stack to get file details
    const stack = new Error().stack;
    // get the file details by splitting the stack trace and getting the level element
    const fileDetailsInStack = stack.split('\n')[level];
    // remove the first two folders as these will be srv/src to have the relative path from fhir-server root
    const relativeRoot = fileDetailsInStack.split('/').splice(3).join('/');
    // remove the column number from the file path
    const file = relativeRoot.split(':').splice(0, 2).join(':');

    args.file = file;
}

/**
 * Logs information
 * @param {string} message
 * @param {Object} args
 * @param {number} level
 */
const logInfo = (message, args, level = 3) => {
    setRequestIdInLog(args);
    setFileDetailsInLog(args, level);
    logger.info(message, args);
};

/**
 * Logs as debug if log level set
 * @param {string} message
 * @param {Object} args
 */
const logDebug = (message, args) => {
    if (env.LOGLEVEL === 'DEBUG') {
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
const logVerboseAsync = async ({ source, args }) => {
    if (env.LOGLEVEL === 'DEBUG') {
        logInfo(`${source}`, { args });
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
const logErrorAndRequestAsync = async ({ error, req }) => {
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
    const logData = { request, error };
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
