'use strict';

const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

jest.mock('passport', () => ({
    authenticate: jest.fn()
}));
jest.mock('../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));

const passport = require('passport');
const { logWarn } = require('../../operations/common/logging');
const {
    authenticateWithJsonFailure
} = require('../../middleware/fhir/authentication.middleware');

const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const makeReq = ({ withAuthHeader = false, url = '/4_0_0/Patient' } = {}) => ({
    method: 'GET',
    url,
    originalUrl: url,
    headers: withAuthHeader ? { authorization: 'Bearer abc' } : {}
});

describe('authenticateWithJsonFailure', () => {
    let originalFlag;

    beforeEach(() => {
        originalFlag = process.env.LOG_AUTH_CONTEXT_ON_401;
        delete process.env.LOG_AUTH_CONTEXT_ON_401;
        passport.authenticate.mockReset();
        logWarn.mockReset();
    });

    afterEach(() => {
        if (originalFlag === undefined) {
            delete process.env.LOG_AUTH_CONTEXT_ON_401;
        } else {
            process.env.LOG_AUTH_CONTEXT_ON_401 = originalFlag;
        }
    });

    const mockAuthFailure = (info) => {
        passport.authenticate.mockImplementation((_strategy, _options, cb) => {
            return (req, _res, _next) => cb(null, false, info);
        });
    };

    test('flag unset: 401 sent, no warn log', () => {
        mockAuthFailure({ reason: 'missing_required_jwt_field' });
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();

        authenticateWithJsonFailure('strategy')(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            resourceType: 'OperationOutcome',
            issue: [
                { severity: 'error', code: 'security', diagnostics: 'Authentication failed' }
            ]
        });
        expect(logWarn).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('flag enabled: warn log emitted with strategy + request + info', () => {
        process.env.LOG_AUTH_CONTEXT_ON_401 = '1';
        const info = { reason: 'client_id_not_allowed_for_issuer' };
        mockAuthFailure(info);
        const req = makeReq({ withAuthHeader: true });
        const res = makeRes();

        authenticateWithJsonFailure('strategy')(req, res, jest.fn());

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn).toHaveBeenCalledWith('Authentication failed (401)', {
            strategy: 'strategy',
            method: 'GET',
            url: '/4_0_0/Patient',
            authorizationHeader: 'Bearer abc',
            info
        });
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('flag enabled with no info: logs info=undefined and does not throw', () => {
        process.env.LOG_AUTH_CONTEXT_ON_401 = '1';
        mockAuthFailure(undefined);
        const req = makeReq();
        const res = makeRes();

        expect(() =>
            authenticateWithJsonFailure('strategy')(req, res, jest.fn())
        ).not.toThrow();

        expect(logWarn).toHaveBeenCalledTimes(1);
        const [, args] = logWarn.mock.calls[0];
        expect(args.info).toBeUndefined();
        expect(args.authorizationHeader).toBeNull();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
