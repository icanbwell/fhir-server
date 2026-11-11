'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const forbidDelegatedOrganizationActor = require('../../../middleware/forbidDelegatedOrganizationActor.middleware');
const { DelegatedAccessManager } = require('../../../utils/delegatedAccessManager');
const { ConfigManager } = require('../../../utils/configManager');
const { AUTH_USER_TYPES } = require('../../../constants');

describe('forbidDelegatedOrganizationActor middleware', () => {
    const middleware = forbidDelegatedOrganizationActor(new DelegatedAccessManager({ configManager: new ConfigManager() }));

    const makeRes = () => {
        const res = {};
        res.status = jestObj.fn().mockReturnValue(res);
        res.json = jestObj.fn().mockReturnValue(res);
        return res;
    };

    const orgActorContext = {
        userType: AUTH_USER_TYPES.delegatedUser,
        actor: { reference: 'Organization/1f0e9d8c-7b6a-4954-8321-0fedcba98765', sub: 'client-org-sub' }
    };

    test.each([
        ['no authInfo', {}],
        ['no context', { authInfo: {} }],
        ['regular user', { authInfo: { context: { userType: 'user' } } }],
        ['RelatedPerson delegated actor', {
            authInfo: {
                context: {
                    userType: AUTH_USER_TYPES.delegatedUser,
                    actor: { reference: 'RelatedPerson/36265db4-0da2-4436-b4e8-85bf7e52a425', sub: 'rp-sub' }
                }
            }
        }],
        ['Organization actor without delegatedUser type', {
            authInfo: { context: { userType: 'user', actor: orgActorContext.actor } }
        }]
    ])('passes through for %s', (_label, req) => {
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('returns a 403 OperationOutcome for an Organization actor on a REST-style route', () => {
        const req = { authInfo: { context: orgActorContext } };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0]).toMatchObject({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'forbidden' }]
        });
    });

    test('passes a 403 error to next for an Organization actor on a GraphQL route', () => {
        const req = { isGraphQLRoute: true, authInfo: { context: orgActorContext } };
        const res = makeRes();
        const next = jestObj.fn();

        middleware(req, res, next);

        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(403);
    });
});
