'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const forbidForUserTypes = require('../../../middleware/forbidForUserTypes.middleware');
const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../../../constants');

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

    describe('delegated Organization actor', () => {
        const middleware = forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser, DELEGATED_ACCESS.ORGANIZATION_ACTOR_USER_TYPE]);
        const orgActor = { reference: 'Organization/org-1', sub: 'client-sub', isOrganizationActor: true };

        test.each([
            ['a RelatedPerson actor', { userType: AUTH_USER_TYPES.delegatedUser, actor: { reference: 'RelatedPerson/rp-1', isOrganizationActor: false } }],
            ['an Organization actor flag without delegatedUser type', { userType: 'user', actor: orgActor }],
            ['a delegated user whose actor has no flag', { userType: AUTH_USER_TYPES.delegatedUser, actor: { reference: 'Organization/org-1' } }]
        ])('passes through for %s', (_label, context) => {
            const res = makeRes();
            const next = jestObj.fn();

            middleware({ authInfo: { context } }, res, next);

            expect(next).toHaveBeenCalledWith();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('returns 403 OperationOutcome for an Organization actor on a REST route', () => {
            const res = makeRes();
            const next = jestObj.fn();

            middleware({ authInfo: { context: { userType: AUTH_USER_TYPES.delegatedUser, actor: orgActor } } }, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json.mock.calls[0][0].issue[0].details.text)
                .toBe(`${DELEGATED_ACCESS.ORGANIZATION_ACTOR_USER_TYPE} does not have access to this endpoint`);
        });

        test('passes a 403 error to next for an Organization actor on a GraphQL route', () => {
            const res = makeRes();
            const next = jestObj.fn();

            middleware({
                isGraphQLRoute: true,
                authInfo: { context: { userType: AUTH_USER_TYPES.delegatedUser, actor: orgActor } }
            }, res, next);

            expect(res.status).not.toHaveBeenCalled();
            expect(next.mock.calls[0][0].statusCode).toBe(403);
        });

        test('does not block an Organization actor when the type is not listed', () => {
            const res = makeRes();
            const next = jestObj.fn();

            forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])(
                { authInfo: { context: { userType: AUTH_USER_TYPES.delegatedUser, actor: orgActor } } }, res, next
            );

            expect(next).toHaveBeenCalledWith();
        });
    });
});
