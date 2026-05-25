'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('passport', () => ({
    authenticate: jest.fn()
}));

const passport = require('passport');
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
    beforeEach(() => {
        passport.authenticate.mockReset();
    });

    const mockAuthFailure = (info) => {
        passport.authenticate.mockImplementation((_strategy, _options, cb) => {
            return (req, _res, _next) => cb(null, false, info);
        });
    };

    test('returns OperationOutcome JSON 401 on auth failure', () => {
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
        expect(next).not.toHaveBeenCalled();
    });
});
