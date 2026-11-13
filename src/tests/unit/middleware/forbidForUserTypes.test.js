'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const forbidForUserTypes = require('../../../middleware/forbidForUserTypes.middleware');

describe('forbidForUserTypes middleware', () => {
    const makeRes = () => {
        const res = {};
        res.status = jestObj.fn().mockReturnValue(res);
        res.json = jestObj.fn().mockReturnValue(res);
        return res;
    };

    test('passes through when req.authInfo is undefined', () => {
        const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
        const req = {};
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('passes through when req.authInfo.context is undefined', () => {
        const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
        const req = { authInfo: {} };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('passes through when req.authInfo.context.userType is undefined', () => {
        const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
        const req = { authInfo: { context: {} } };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('passes through when userType is not in forbidden list', () => {
        const middleware = forbidForUserTypes(['admin', 'restrictedUser']);
        const req = { authInfo: { context: { userType: 'normalUser' } } };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('returns 403 OperationOutcome for matching userType on REST route', () => {
        const middleware = forbidForUserTypes(['cmsPartnerUser', 'restrictedUser']);
        const req = {
            authInfo: { context: { userType: 'cmsPartnerUser' } },
            isGraphQLRoute: false
        };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
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
        expect(next).not.toHaveBeenCalled();
    });

    test('calls next(err) with statusCode 403 for matching userType on GraphQL route', () => {
        const middleware = forbidForUserTypes(['cmsPartnerUser']);
        const req = {
            authInfo: { context: { userType: 'cmsPartnerUser' } },
            isGraphQLRoute: true
        };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('cmsPartnerUser'),
                statusCode: 403
            })
        );
        expect(res.status).not.toHaveBeenCalled();
    });

    test('blocks multiple forbidden types - first type blocked', () => {
        const middleware = forbidForUserTypes(['admin', 'restrictedUser', 'cmsPartnerUser']);
        const req = {
            authInfo: { context: { userType: 'admin' } },
            isGraphQLRoute: false
        };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('blocks multiple forbidden types - last type blocked', () => {
        const middleware = forbidForUserTypes(['admin', 'restrictedUser', 'cmsPartnerUser']);
        const req = {
            authInfo: { context: { userType: 'cmsPartnerUser' } },
            isGraphQLRoute: false
        };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('GraphQL error message includes userType', () => {
        const middleware = forbidForUserTypes(['restrictedUser']);
        const req = {
            authInfo: { context: { userType: 'restrictedUser' } },
            isGraphQLRoute: true
        };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain('restrictedUser');
        expect(err.statusCode).toBe(403);
    });
});
