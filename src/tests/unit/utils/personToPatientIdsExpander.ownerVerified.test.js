/**
 * Tests for PersonToPatientIdsExpander's owner-tag-verified Person->Patient capture, used to
 * build the PROA-safe cache consumed by DataSharingManager (see
 * docs/superpowers/specs/2026-08-08-proa-person-everything-caching-design.md).
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { jest: jestGlobal } = require('@jest/globals');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');

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
        nextObject: jestGlobal.fn(async () => docs[index++])
    };
}

describe('PersonToPatientIdsExpander — owner-verified Person->Patient capture', () => {
    let mockDatabaseQueryManager;

    function mockFindAsyncSequence (docsInCallOrder) {
        let callIndex = 0;
        mockDatabaseQueryManager.findAsync = jestGlobal.fn(async () => {
            const docsForThisCall = docsInCallOrder[callIndex] || [];
            callIndex += 1;
            return createCursor(docsForThisCall);
        });
    }

    beforeEach(() => {
        mockDatabaseQueryManager = { findAsync: jestGlobal.fn() };
    });

    function createExpander () {
        const scopesManager = createStubInstance(ScopesManager, {
            isAccessAllowedByPatientScopes: () => false
        });
        const securityTagManager = createStubInstance(SecurityTagManager, {
            getSecurityTagsFromScope: () => ['tenant_a'],
            getQueryWithSecurityTags: ({ query }) => query
        });
        const configManager = createStubInstance(ConfigManager, {
            useAccessIndex: false,
            enableProxyPersonScopeCheckForEverything: true
        });
        const databaseQueryFactory = createStubInstance(DatabaseQueryFactory, {
            createQuery: () => mockDatabaseQueryManager
        });
        return new PersonToPatientIdsExpander({
            databaseQueryFactory, scopesManager, securityTagManager, configManager
        });
    }

    const requestInfo = { user: 'test-user', scope: 'access/tenant_a.read', originalUrl: '/4_0_0/Person/person-owned-uuid/$everything', method: 'GET' };

    test('includes a person in ownerVerifiedPersonToLinkedPatients when its owner tag matches securityTags', async () => {
        const personOwned = {
            _uuid: 'person-owned-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenant_a' }] },
            link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
        };
        mockFindAsyncSequence([[personOwned]]);
        const expander = createExpander();

        const result = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-owned-uuid'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: true,
            requestInfo,
            captureOwnerVerifiedLinks: true
        });

        expect(result.ownerVerifiedPersonToLinkedPatients.get('person-owned-uuid')).toEqual(
            new Set(['Patient/patient-1-uuid'])
        );
    });

    test('excludes a person from ownerVerifiedPersonToLinkedPatients when it only has a matching access tag, not owner', async () => {
        const personSharedNotOwned = {
            _uuid: 'person-shared-uuid',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'tenant_b' },
                    { system: SecurityTagSystem.access, code: 'tenant_a' }
                ]
            },
            link: [{ target: { _uuid: 'Patient/patient-2-uuid', type: 'Patient' } }]
        };
        mockFindAsyncSequence([[personSharedNotOwned]]);
        const expander = createExpander();

        const result = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-shared-uuid'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: true,
            requestInfo,
            captureOwnerVerifiedLinks: true
        });

        expect(result.ownerVerifiedPersonToLinkedPatients.has('person-shared-uuid')).toBe(false);
    });

    test('existing callers without captureOwnerVerifiedLinks get the unchanged bare-Map return', async () => {
        const person = {
            _uuid: 'person-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenant_a' }] },
            link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
        };
        mockFindAsyncSequence([[person]]);
        const expander = createExpander();

        const result = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-uuid'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: true,
            requestInfo
        });

        expect(result).toBeInstanceOf(Map);
    });

    test('fail-closed: ownerVerifiedPersonToLinkedPatients is empty when security check does not run', async () => {
        const personWithMatchingOwnerTag = {
            _uuid: 'person-uuid',
            meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenant_a' }] },
            link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
        };
        mockFindAsyncSequence([[personWithMatchingOwnerTag]]);
        const expander = createExpander();

        // Use a requestInfo that does NOT satisfy the $everything+GET condition:
        // missing $everything in the URL
        const nonEverythingRequestInfo = {
            user: 'test-user',
            scope: 'access/tenant_a.read',
            originalUrl: '/4_0_0/Person/person-uuid',
            method: 'GET'
        };

        const result = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-uuid'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: true,
            requestInfo: nonEverythingRequestInfo,
            captureOwnerVerifiedLinks: true
        });

        // Even though the person's owner tag would match, the security check never ran,
        // so ownerVerifiedPersonToLinkedPatients must be empty (fail-closed)
        expect(result.ownerVerifiedPersonToLinkedPatients.size).toBe(0);
    });

    describe('getPatientProxyIdsAsync', () => {
        test('throws when captureOwnerVerifiedLinks is true but toMap is false', async () => {
            const personOwned = {
                _uuid: 'person-owned-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenant_a' }] },
                link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
            };
            mockFindAsyncSequence([[personOwned]]);
            const expander = createExpander();

            await expect(
                expander.getPatientProxyIdsAsync({
                    base_version: '4_0_0',
                    ids: ['person.person-owned-uuid'],
                    includePatientPrefix: false,
                    toMap: false,
                    requestInfo,
                    captureOwnerVerifiedLinks: true
                })
            ).rejects.toThrow(/captureOwnerVerifiedLinks.*toMap.*true/i);
        });

        test('returns { plainMap, ownerVerifiedPersonToLinkedPatients } when captureOwnerVerifiedLinks is true', async () => {
            const personOwned = {
                _uuid: 'person-owned-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenant_a' }] },
                link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
            };
            mockFindAsyncSequence([[personOwned]]);
            const expander = createExpander();

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.person-owned-uuid'],
                includePatientPrefix: false,
                toMap: true,
                requestInfo,
                captureOwnerVerifiedLinks: true
            });

            expect(result.plainMap['person-owned-uuid']).toEqual(
                expect.arrayContaining(['patient-1-uuid', 'person.person-owned-uuid'])
            );
            expect(result.ownerVerifiedPersonToLinkedPatients.get('person-owned-uuid')).toEqual(
                new Set(['Patient/patient-1-uuid'])
            );
        });

        test('returns a bare plainMap when captureOwnerVerifiedLinks is omitted (existing behavior)', async () => {
            const person = {
                _uuid: 'person-uuid',
                meta: { security: [{ system: SecurityTagSystem.owner, code: 'tenant_a' }] },
                link: [{ target: { _uuid: 'Patient/patient-1-uuid', type: 'Patient' } }]
            };
            mockFindAsyncSequence([[person]]);
            const expander = createExpander();

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.person-uuid'],
                includePatientPrefix: false,
                toMap: true,
                requestInfo
            });

            expect(result.ownerVerifiedPersonToLinkedPatients).toBeUndefined();
            expect(result['person-uuid']).toBeDefined();
        });
    });
});
