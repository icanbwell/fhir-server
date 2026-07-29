const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Security tests for forbidForUserTypes middleware.
 *
 * These tests assert CORRECT behavior so they FAIL on buggy code:
 * 1. Missing authInfo (unauthenticated) must be DENIED, not allowed through
 * 2. Missing authInfo.context must be DENIED, not allowed through
 * 3. Case-insensitive matching must be enforced for user types
 * 4. Forbidden user type gets 403 (happy path)
 * 5. GraphQL route gets error via next() not res.json()
 */

const forbidForUserTypes = require('../../../middleware/forbidForUserTypes.middleware');

describe('forbidForUserTypes middleware - Security', () => {
    let mockRes;
    let mockNext;

    beforeEach(() => {
        mockRes = {
            status: jestGlobal.fn().mockReturnThis(),
            json: jestGlobal.fn().mockReturnThis()
        };
        mockNext = jestGlobal.fn();
    });

    describe('Authentication bypass vulnerabilities', () => {
        test('CRITICAL: denies access when req.authInfo is undefined (unauthenticated request)', () => {
            // BUG: The middleware extracts userType via optional chaining: req.authInfo?.context?.userType
            // When authInfo is undefined, userType becomes undefined, the condition
            // `if (userType && userTypes.includes(userType))` is false, and next() is called — allowing access.
            // CORRECT behavior: unauthenticated requests (missing authInfo) should be DENIED by default.
            const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
            const req = { /* no authInfo at all */ };

            middleware(req, mockRes, mockNext);

            // Correct behavior: should NOT call next() without error — should deny access
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('CRITICAL: denies access when req.authInfo.context is undefined', () => {
            // BUG: If authInfo exists but context is undefined, optional chaining gives undefined
            // for userType, and the request passes through unblocked.
            // CORRECT behavior: missing context should be treated as unauthorized.
            const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
            const req = { authInfo: {} };

            middleware(req, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('CRITICAL: denies access when req.authInfo.context.userType is undefined', () => {
            // BUG: If context exists but userType is not set, the middleware allows access.
            // A request without a declared userType should not bypass restrictions.
            const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
            const req = { authInfo: { context: {} } };

            middleware(req, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });
    });

    describe('Case-sensitivity bypass', () => {
        test('BUG: case-insensitive matching blocks Admin when configured with admin', () => {
            // BUG: userTypes.includes() is case-sensitive. If the auth system returns 'Admin'
            // but the middleware is configured with 'admin', the check fails and user passes through.
            // CORRECT behavior: comparison should be case-insensitive.
            const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
            const req = { authInfo: { context: { userType: 'Admin' } } };

            middleware(req, mockRes, mockNext);

            // Correct behavior: 'Admin' should match 'admin' (case-insensitive)
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('BUG: case-insensitive matching blocks RESTRICTEDUSER when configured with restrictedUser', () => {
            const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
            const req = { authInfo: { context: { userType: 'RESTRICTEDUSER' } } };

            middleware(req, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockNext).not.toHaveBeenCalled();
        });
    });

    describe('Happy path - forbidden user type blocked', () => {
        test('returns 403 OperationOutcome for forbidden user type on REST route', () => {
            const middleware = forbidForUserTypes(['cmsPartnerUser', 'restrictedUser']);
            const req = {
                authInfo: { context: { userType: 'cmsPartnerUser' } },
                isGraphQLRoute: false
            };

            middleware(req, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'OperationOutcome',
                    issue: expect.arrayContaining([
                        expect.objectContaining({
                            severity: 'error',
                            code: 'forbidden',
                            details: expect.objectContaining({
                                text: expect.stringContaining('cmsPartnerUser')
                            })
                        })
                    ])
                })
            );
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('returns error via next() for forbidden user type on GraphQL route', () => {
            const middleware = forbidForUserTypes(['cmsPartnerUser']);
            const req = {
                authInfo: { context: { userType: 'cmsPartnerUser' } },
                isGraphQLRoute: true
            };

            middleware(req, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('cmsPartnerUser'),
                    statusCode: 403
                })
            );
            // Should NOT call res.status/json for GraphQL routes
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });

    describe('Allowed user types pass through', () => {
        test('allows access for user type not in forbidden list', () => {
            const middleware = forbidForUserTypes(['cmsPartnerUser', 'restrictedUser']);
            const req = {
                authInfo: { context: { userType: 'normalUser' } }
            };

            middleware(req, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith();
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });
});
