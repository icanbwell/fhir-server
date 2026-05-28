const noOpMiddleware = require('./noop.middleware.js');

const passport = require('passport');

/**
 * Sends the standard JSON OperationOutcome 401 body when Passport authentication fails.
 * @param {import('express').Response} res
 */
const sendUnauthorizedJson = (res) => {
    res.status(401).json({
        resourceType: 'OperationOutcome',
        issue: [{
            severity: 'error',
            code: 'security',
            diagnostics: 'Authentication failed'
        }]
    });
};

/**
 * Wraps passport.authenticate with a custom callback so that auth failures
 * return a JSON OperationOutcome instead of Passport's default plain-text body.
 * Also captures failure details on req for audit logging.
 * @param {string} strategy
 * @param {object} [options]
 * @returns {import('express').RequestHandler}
 */
const authenticateWithJsonFailure = (strategy, options = {session: false}) => {
    return (req, res, next) => {
        passport.authenticate(strategy, options, (err, user, info) => {
            if (err) {
                return next(err);
            }
            if (!user) {
                // Classify the failure for audit logging
                if (info && info.message === 'No auth token') {
                    req.authFailureDetail = 'No token available';
                } else if (req.jwtPayload) {
                    req.authFailureDetail = info && info.reason
                        ? 'Invalid Token: ' + info.reason
                        : 'Invalid Token';
                } else if (info && info.message === 'jwt expired') {
                    req.authFailureDetail = 'Token Expired';
                } else if (info && (info.message === 'jwt malformed' || info.message === 'invalid token')) {
                    req.authFailureDetail = 'Malformed Token';
                } else {
                    req.authFailureDetail = 'Invalid signature';
                }
                if (req.isGraphQLRoute) {
                    const authErr = new Error(req.authFailureDetail || 'Authentication failed');
                    authErr.statusCode = 401;
                    return next(authErr);
                }
                return sendUnauthorizedJson(res);
            }
            // Supplying a callback disables Passport's default req.logIn/authInfo
            // wiring, so we replicate it here via transformAuthInfo.
            req.logIn(user, {session: options.session === true}, (loginErr) => {
                if (loginErr) {
                    return next(loginErr);
                }
                passport.transformAuthInfo(info, req, (transformErr, tinfo) => {
                    if (transformErr) {
                        return next(transformErr);
                    }
                    req.authInfo = tinfo;
                    return next();
                });
            });
        })(req, res, next);
    };
};

/**
 * @description Middleware for doing authentication, wrapper around passport.
 * Uses a custom callback to capture failure details on req for audit logging.
 * @param {Object} config - Configurations for the application
 * @return {function} valid express middleware
 */
module.exports = function authenticationMiddleware (config) {
    // Don't do any validation for testing
    if (process.env.NODE_ENV === 'test') {
        return noOpMiddleware;
    } // if strategy is configured

    if (config.auth && config.auth.strategy) {
        const {
            name,
            useSession = false
        } = config.auth.strategy;
        return authenticateWithJsonFailure(name, {session: useSession});
    } else {
        return noOpMiddleware;
    }
};

module.exports.authenticateWithJsonFailure = authenticateWithJsonFailure;
module.exports.sendUnauthorizedJson = sendUnauthorizedJson;
