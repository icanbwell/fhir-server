/**
 * Tests for the Person owner PersonToPatientIdsExpander records in httpContext when asked to
 * (addPersonOwnerToContext). The data view control lookup reads it to decide client enrollment, and
 * tells a Person without an owner tag (null) apart from a Person that was not found (a sentinel).
 */
const { describe, test, expect, afterEach } = require('@jest/globals');
const { jest: jestGlobal } = require('@jest/globals');
const httpContext = require('express-http-context');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');
const { HTTP_CONTEXT_KEYS } = require('../../../constants');

function createStubInstance (RealClass, overrides = {}) {
    const instance = Object.create(RealClass.prototype);
    for (const [key, value] of Object.entries(overrides)) {
        Object.defineProperty(instance, key, {
            value, writable: true, enumerable: true, configurable: true
        });
    }
    return instance;
}

function createCursor (docs) {
    let index = 0;
    return {
        hasNext: jestGlobal.fn(async () => index < docs.length),
        next: jestGlobal.fn(async () => docs[index++])
    };
}

describe('PersonToPatientIdsExpander — Person owner recorded in httpContext', () => {
    const PERSON_ID = 'person-1-uuid';
    const ownerKey = `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${PERSON_ID}`;

    afterEach(() => {
        jestGlobal.restoreAllMocks();
    });

    function createExpander (databaseQueryManager) {
        return new PersonToPatientIdsExpander({
            databaseQueryFactory: createStubInstance(DatabaseQueryFactory, {
                createQuery: () => databaseQueryManager
            }),
            scopesManager: createStubInstance(ScopesManager, {
                isAccessAllowedByPatientScopes: () => false,
                hasPatientScope: () => false
            }),
            securityTagManager: createStubInstance(SecurityTagManager, {
                getSecurityTagsFromScope: () => [],
                getQueryWithSecurityTags: ({ query }) => query
            }),
            configManager: createStubInstance(ConfigManager, { useAccessIndex: false })
        });
    }

    test.each([
        [
            'the owner tag code for a Person with an owner tag',
            [{ _uuid: PERSON_ID, meta: { security: [
                { system: SecurityTagSystem.access, code: 'client-a' },
                { system: SecurityTagSystem.owner, code: 'client-a' }
            ] } }],
            [[ownerKey, 'client-a']]
        ],
        [
            'null for a Person whose tags include no owner',
            [{ _uuid: PERSON_ID, meta: { security: [{ system: SecurityTagSystem.access, code: 'client-a' }] } }],
            [[ownerKey, null]]
        ],
        ['null for a Person with no meta', [{ _uuid: PERSON_ID }], [[ownerKey, null]]],
        ['the not-found sentinel for a Person that was not found', [], [[ownerKey, HTTP_CONTEXT_KEYS.PERSON_OWNER_NOT_FOUND]]]
    ])('records %s', async (_name, persons, expectedOwnerWrites) => {
        const setSpy = jestGlobal.spyOn(httpContext, 'set').mockImplementation(() => {});
        const databaseQueryManager = { findAsync: jestGlobal.fn(async () => createCursor(persons)) };

        await createExpander(databaseQueryManager).getPatientIdsFromPersonAsync({
            personIds: [PERSON_ID],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager,
            level: 1,
            addPersonOwnerToContext: true
        });

        const ownerWrites = setSpy.mock.calls.filter(([key]) => key.startsWith(HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX));
        expect(ownerWrites).toEqual(expectedOwnerWrites);
    });

    test('records nothing when the caller did not ask for the owner', async () => {
        const setSpy = jestGlobal.spyOn(httpContext, 'set').mockImplementation(() => {});
        const persons = [{ _uuid: PERSON_ID, meta: { security: [{ system: SecurityTagSystem.owner, code: 'client-a' }] } }];
        const databaseQueryManager = { findAsync: jestGlobal.fn(async () => createCursor(persons)) };

        await createExpander(databaseQueryManager).getPatientIdsFromPersonAsync({
            personIds: [PERSON_ID],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager,
            level: 1,
            addPersonOwnerToContext: false
        });

        expect(setSpy.mock.calls.filter(([key]) => key.startsWith(HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX))).toEqual([]);
    });
});
