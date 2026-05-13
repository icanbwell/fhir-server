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
                    // Verify callback ran (signature valid) but validation failed
                    req.authFailureDetail = 'Invalid token';
                } else {
                    // Signature verification or JWKS failed — decode payload without verification for audit
                    req.authFailureDetail = 'Invalid signature';
                    try {
                        const authHeader = req.headers && req.headers.authorization;
                        if (authHeader && authHeader.startsWith('Bearer ')) {
                            const parts = authHeader.slice(7).split('.');
                            if (parts.length === 3) {
                                req.jwtPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
                            }
                        }
                    } catch (_) {
                        req.authFailureDetail = 'Malformed Token';
                    }
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
