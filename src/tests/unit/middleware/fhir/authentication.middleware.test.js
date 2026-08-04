'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('passport', () => ({
    authenticate: jestObj.fn(),
    transformAuthInfo: jestObj.fn()
}));

jestObj.mock('../../noop.middleware.js', () => (req, res, next) => next(), { virtual: true });

const passport = require('passport');
const authenticationMiddleware = require('../../../../middleware/fhir/authentication.middleware');
const { authenticateWithJsonFailure, sendUnauthorizedJson } = authenticationMiddleware;

describe('authentication.middleware', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
        req = {
            logIn: jestObj.fn((user, opts, cb) => cb(null)),
            isGraphQLRoute: false,
            jwtPayload: null,
            authFailureDetail: undefined
        };
        res = {
            status: jestObj.fn().mockReturnThis(),
            json: jestObj.fn()
        };
        next = jestObj.fn();
        jestObj.clearAllMocks();
    });

    describe('sendUnauthorizedJson', () => {
        test('sends 401 with OperationOutcome', () => {
            sendUnauthorizedJson(res);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                resourceType: 'OperationOutcome',
                issue: expect.arrayContaining([
                    expect.objectContaining({
                        severity: 'error',
                        code: 'security',
                        diagnostics: 'Authentication failed'
                    })
                ])
            }));
        });
    });

    describe('authenticateWithJsonFailure', () => {
        test('calls next with error when passport returns an error', () => {
            const passportError = new Error('Strategy error');
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(passportError, null, null);
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(next).toHaveBeenCalledWith(passportError);
        });

        test('sends 401 JSON when user is not authenticated', () => {
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { message: 'No auth token' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalled();
        });

        test('sets authFailureDetail to "No token available" when no auth token', () => {
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { message: 'No auth token' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.authFailureDetail).toBe('No token available');
        });

        test('sets authFailureDetail to "Token Expired" for jwt expired', () => {
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { message: 'jwt expired' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.authFailureDetail).toBe('Token Expired');
        });

        test('sets authFailureDetail to "Malformed Token" for jwt malformed', () => {
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { message: 'jwt malformed' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.authFailureDetail).toBe('Malformed Token');
        });

        test('sets authFailureDetail to "Invalid Token" when jwtPayload exists', () => {
            req.jwtPayload = { sub: 'user-1' };
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, {});
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.authFailureDetail).toBe('Invalid Token');
        });

        test('sets authFailureDetail to "Invalid Token: <reason>" when jwtPayload exists with reason', () => {
            req.jwtPayload = { sub: 'user-1' };
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { reason: 'wrong audience' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.authFailureDetail).toBe('Invalid Token: wrong audience');
        });

        test('defaults to "Invalid signature" for unknown auth failure', () => {
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { message: 'something else' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.authFailureDetail).toBe('Invalid signature');
        });

        test('calls next with 401 error for GraphQL routes', () => {
            req.isGraphQLRoute = true;
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, false, { message: 'No auth token' });
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 401
            }));
            expect(res.status).not.toHaveBeenCalled();
        });

        test('calls next() on successful auth after logIn and transformAuthInfo', () => {
            const user = { id: 'user-1', name: 'Test' };
            const info = { scope: 'patient/*.read' };
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, user, info);
                };
            });
            passport.transformAuthInfo.mockImplementation((authInfo, innerReq, cb) => {
                cb(null, authInfo);
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(req.logIn).toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith();
            expect(req.authInfo).toEqual(info);
        });

        test('passes logIn error to next', () => {
            const loginErr = new Error('login failed');
            req.logIn = jestObj.fn((user, opts, cb) => cb(loginErr));
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, { id: 'user' }, {});
                };
            });

            const middleware = authenticateWithJsonFailure('bearer');
            middleware(req, res, next);
            expect(next).toHaveBeenCalledWith(loginErr);
        });
    });

    // DCON-4806: a missing/falsy auth strategy must fail closed (deny), not fail open
    // (pass through unauthenticated) -- see authenticationMiddleware's default export.
    describe('authenticationMiddleware (default export) fail-closed behavior', () => {
        const savedNodeEnv = process.env.NODE_ENV;

        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        afterEach(() => {
            process.env.NODE_ENV = savedNodeEnv;
        });

        test('denies with 401 when config.auth.strategy is missing entirely', () => {
            const middleware = authenticationMiddleware({ auth: {} });
            middleware(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                resourceType: 'OperationOutcome'
            }));
            expect(next).not.toHaveBeenCalled();
        });

        test('denies with 401 when config.auth is entirely missing', () => {
            const middleware = authenticationMiddleware({});
            middleware(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('does NOT fall through to next() when strategy is missing', () => {
            const middleware = authenticationMiddleware({ auth: { strategy: null } });
            middleware(req, res, next);
            expect(next).not.toHaveBeenCalled();
        });

        test('uses the real passport-backed middleware when a strategy is configured', () => {
            passport.authenticate.mockImplementation((strategy, options, callback) => {
                return (innerReq, innerRes, innerNext) => {
                    callback(null, { id: 'user-1' }, {});
                };
            });
            passport.transformAuthInfo.mockImplementation((authInfo, innerReq, cb) => cb(null, authInfo));

            const middleware = authenticationMiddleware({ auth: { strategy: { name: 'jwt' } } });
            middleware(req, res, next);
            expect(passport.authenticate).toHaveBeenCalledWith('jwt', expect.objectContaining({ session: false }), expect.any(Function));
            expect(next).toHaveBeenCalledWith();
        });

        test('returns noOpMiddleware in test env even with no strategy configured', () => {
            process.env.NODE_ENV = 'test';
            const middleware = authenticationMiddleware({});
            middleware(req, res, next);
            expect(next).toHaveBeenCalledWith();
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});
