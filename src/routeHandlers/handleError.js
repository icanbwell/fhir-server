const httpContext = require('express-http-context');
const { convertErrorToOperationOutcome } = require('../utils/convertErrorToOperationOutcome');
const { REQUEST_ID_TYPE } = require('../constants');
const { logError } = require('../operations/common/logging');

/**
 * Handle Uncaught error for routes where error is not handled
 */
const handleServerError = (
    /** @type {import('express').ErrorRequestHandler} */ err,
    /** @type {import('express').Request} */ req,
    /** @type {import('express').Response} */ res,
    /** @type {import('express').NextFunction} */ next
) => {
    if (req.id && !res.headersSent) {
        res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
    }

    if (res.headersSent) {
        // usually means we are streaming data so can't change headers
        // next();
        return res.end();
    } else if (err) {
        const status = err.statusCode || 500;
        
        // Log server errors for debugging
        if (status >= 500) {
            logError('Server error in handleServerError', {
                error: err,
                message: err.message,
                stack: err.stack,
                statusCode: status,
                url: req.url,
                method: req.method,
                user: req.user,
                userAgent: req.headers['user-agent']
            });
        }
        
        /**
         * @type {OperationOutcome}
         */
        const operationOutcome = convertErrorToOperationOutcome({ error: err });
        return res.status(status).json(operationOutcome);
    } else {
        return next();
    }
};

module.exports = { handleServerError };
