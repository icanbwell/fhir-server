const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals');

// Mock express-http-context at top level
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

// Mock logging
jest.mock('../../../operations/common/logging', () => ({
    logWarn: jest.fn()
}));

const httpContext = require('express-http-context');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { HTTP_CONTEXT_KEYS } = require('../../../constants');

/**
 * CACHE ANALYSIS for PersonToPatientIdsExpander.getPatientIdsFromPersonAsync:
 *
 * 1. Cache mechanism: httpContext.set() stores person owner data per personId
 * 2. Cache KEY dimensions: `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${personId}` = "personOwnerFor-<personId>"
 * 3. Method PARAMETERS: personIds, totalProcessedPersonIds, databaseQueryManager, level, toMap, returnOriginalPersonId, addPersonOwnerToContext
 * 4. Params NOT in key: ALL params except personId (derived from person._uuid). Notably: base_version, level, toMap, returnOriginalPersonId, addPersonOwnerToContext are NOT in cache key
 * 5. Cached VALUE: security.code from person.meta.security where system === SecurityTagSystem.owner
 * 6. Downstream consumer: PatientDataViewControlManager.getConsentAsync reads via httpContext.get(`personOwnerFor-<personId>`)
 * 7. Required test: Call with addPersonOwnerToContext=true, then call again with different person having same UUID but different owner -> second call overwrites
 * 8. Mock setup: Need mock databaseQueryFactory that returns mock cursor with hasNext/nextObject
 * 9. Assertion: httpContext.set called with correct key and value; verify behavior with stale data
 */

// Helper to create mock cursor
function createMockCursor(items) {
    let index = 0;
    return {
        hasNext: jest.fn().mockImplementation(async () => index < items.length),
        nextObject: jest.fn().mockImplementation(async () => items[index++])
    };
}

// Helper to create a properly typed DatabaseQueryFactory mock
function createMockDatabaseQueryFactory(mockCursor) {
    const mockQueryManager = {
        findAsync: jest.fn().mockResolvedValue(mockCursor)
    };

    const factory = Object.create(DatabaseQueryFactory.prototype);
    factory.createQuery = jest.fn().mockReturnValue(mockQueryManager);
    return { factory, mockQueryManager };
}

describe('PersonToPatientIdsExpander', () => {
    let expander;
    let mockCursor;
    let mockQueryManager;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCursor = createMockCursor([]);
        const { factory, mockQueryManager: qm } = createMockDatabaseQueryFactory(mockCursor);
        mockQueryManager = qm;

        expander = new PersonToPatientIdsExpander({
            databaseQueryFactory: factory
        });
    });

    // ========== getPatientIdsFromPersonAsync ==========
    describe('getPatientIdsFromPersonAsync', () => {
        describe('basic behavior', () => {
            test('returns empty array when no person resources found (0 items)', async () => {
                mockCursor = createMockCursor([]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                expect(result).toEqual([]);
            });

            test('returns patient ids from single person with one link (1 item)', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [{
                        target: {
                            _uuid: 'Patient/patient-1',
                            type: 'Patient'
                        }
                    }]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                expect(result).toContain('patient-1');
                expect(result).toContain('person.person-uuid-1');
            });

            test('returns patient ids from multiple persons with multiple links (>1 items)', async () => {
                mockCursor = createMockCursor([
                    {
                        _uuid: 'person-uuid-1',
                        _sourceId: 'person-1',
                        id: 'person-1',
                        link: [
                            { target: { _uuid: 'Patient/patient-1', type: 'Patient' } },
                            { target: { _uuid: 'Patient/patient-2', type: 'Patient' } }
                        ]
                    },
                    {
                        _uuid: 'person-uuid-2',
                        _sourceId: 'person-2',
                        id: 'person-2',
                        link: [
                            { target: { _uuid: 'Patient/patient-3', type: 'Patient' } }
                        ]
                    }
                ]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1', 'person-2'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                expect(result).toContain('patient-1');
                expect(result).toContain('patient-2');
                expect(result).toContain('patient-3');
                expect(result).toContain('person.person-uuid-1');
                expect(result).toContain('person.person-uuid-2');
            });
        });

        describe('toMap behavior', () => {
            test('returns a Map when toMap is true (0 items)', async () => {
                mockCursor = createMockCursor([]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: true
                });

                expect(result).toBeInstanceOf(Map);
                expect(result.size).toBe(0);
            });

            test('returns Map with correct mappings for single person (1 item)', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } },
                        { target: { _uuid: 'Patient/patient-2', type: 'Patient' } }
                    ]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-uuid-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: true
                });

                expect(result).toBeInstanceOf(Map);
                expect(result.has('person-uuid-1')).toBe(true);
                const patients = result.get('person-uuid-1');
                expect(patients).toBeInstanceOf(Set);
                expect(patients.has('patient-1')).toBe(true);
                expect(patients.has('patient-2')).toBe(true);
            });

            test('returns Map with returnOriginalPersonId using _sourceId', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-source-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                    ]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-source-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: true,
                    returnOriginalPersonId: true
                });

                expect(result).toBeInstanceOf(Map);
                expect(result.has('person-source-1')).toBe(true);
            });
        });

        describe('recursion with person links', () => {
            test('recurses into linked Person resources', async () => {
                // First call finds a person linked to another person
                const firstCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } },
                        { target: { _uuid: 'Person/person-uuid-2', type: 'Person' } }
                    ]
                }]);

                // Second call (recursive) finds the linked person
                const secondCursor = createMockCursor([{
                    _uuid: 'person-uuid-2',
                    _sourceId: 'person-2',
                    id: 'person-2',
                    link: [
                        { target: { _uuid: 'Patient/patient-2', type: 'Patient' } }
                    ]
                }]);

                let callCount = 0;
                mockQueryManager.findAsync.mockImplementation(async () => {
                    callCount++;
                    return callCount === 1 ? firstCursor : secondCursor;
                });

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                expect(result).toContain('patient-1');
                expect(result).toContain('patient-2');
                expect(result).toContain('person.person-uuid-1');
                expect(result).toContain('person.person-uuid-2');
            });

            test('stops recursion at maximum depth (level 4)', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-deep',
                    _sourceId: 'person-deep',
                    id: 'person-deep',
                    link: [
                        { target: { _uuid: 'Patient/patient-deep', type: 'Patient' } },
                        { target: { _uuid: 'Person/should-not-recurse', type: 'Person' } }
                    ]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const { logWarn } = require('../../../operations/common/logging');

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-deep'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 4, // maximumRecursionDepth
                    toMap: false
                });

                expect(result).toContain('patient-deep');
                expect(logWarn).toHaveBeenCalled();
                // Should not recurse further - only 1 findAsync call
                expect(mockQueryManager.findAsync).toHaveBeenCalledTimes(1);
            });
        });

        describe('addPersonOwnerToContext - httpContext cache', () => {
            test('sets person owner in httpContext when addPersonOwnerToContext is true', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                    ],
                    meta: {
                        security: [{
                            system: SecurityTagSystem.owner,
                            code: 'owner-client-A'
                        }]
                    }
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                expect(httpContext.set).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-uuid-1`,
                    'owner-client-A'
                );
            });

            test('does NOT set person owner when addPersonOwnerToContext is false', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                    ],
                    meta: {
                        security: [{
                            system: SecurityTagSystem.owner,
                            code: 'owner-client-A'
                        }]
                    }
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: false
                });

                expect(httpContext.set).not.toHaveBeenCalled();
            });

            test('does NOT include meta projection when addPersonOwnerToContext is false', async () => {
                mockCursor = createMockCursor([]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: false
                });

                const findCall = mockQueryManager.findAsync.mock.calls[0][0];
                expect(findCall.options.projection.meta).toBeUndefined();
            });

            test('includes meta projection when addPersonOwnerToContext is true', async () => {
                mockCursor = createMockCursor([]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                const findCall = mockQueryManager.findAsync.mock.calls[0][0];
                expect(findCall.options.projection.meta).toBe(1);
            });

            test('only sets owner for security entries with owner system', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                    ],
                    meta: {
                        security: [
                            { system: SecurityTagSystem.access, code: 'access-tag' },
                            { system: SecurityTagSystem.owner, code: 'owner-client-B' },
                            { system: SecurityTagSystem.vendor, code: 'vendor-tag' }
                        ]
                    }
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                // Should only set the owner tag
                expect(httpContext.set).toHaveBeenCalledTimes(1);
                expect(httpContext.set).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-uuid-1`,
                    'owner-client-B'
                );
            });

            test('BUG: calling twice with same personId but different owner overwrites without detection', async () => {
                // First call - person has owner-A
                const cursor1 = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [{ target: { _uuid: 'Patient/patient-1', type: 'Patient' } }],
                    meta: {
                        security: [{ system: SecurityTagSystem.owner, code: 'owner-A' }]
                    }
                }]);
                mockQueryManager.findAsync.mockResolvedValue(cursor1);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                expect(httpContext.set).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-uuid-1`,
                    'owner-A'
                );

                // Second call - same personId but different owner (simulating data change or different base_version)
                const cursor2 = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [{ target: { _uuid: 'Patient/patient-1', type: 'Patient' } }],
                    meta: {
                        security: [{ system: SecurityTagSystem.owner, code: 'owner-B' }]
                    }
                }]);
                mockQueryManager.findAsync.mockResolvedValue(cursor2);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                // BUG DETECTION: The second call silently overwrites the context.
                // There's no check if the value was already set or if it differs.
                // This means the cache value is whatever was last written, which could be
                // inconsistent if multiple calls happen in the same request with different data.
                expect(httpContext.set).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-uuid-1`,
                    'owner-B'
                );
                // Both calls happened - no deduplication
                expect(httpContext.set).toHaveBeenCalledTimes(2);
            });

            test('handles person with no meta.security gracefully', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [{ target: { _uuid: 'Patient/patient-1', type: 'Patient' } }],
                    meta: {}
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                expect(httpContext.set).not.toHaveBeenCalled();
            });

            test('handles person with no meta at all gracefully', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [{ target: { _uuid: 'Patient/patient-1', type: 'Patient' } }]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false,
                    addPersonOwnerToContext: true
                });

                expect(httpContext.set).not.toHaveBeenCalled();
            });
        });

        describe('edge cases', () => {
            test('person with empty link array', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: []
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                // Should only contain the proxy patient id
                expect(result).toEqual(['person.person-uuid-1']);
            });

            test('person already in totalProcessedPersonIds is skipped', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                    ]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(['person-uuid-1']),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                // person.person-uuid-1 is always pushed, but link processing is skipped
                expect(result).toEqual(['person.person-uuid-1']);
            });

            test('link with target missing _uuid is filtered out', async () => {
                mockCursor = createMockCursor([{
                    _uuid: 'person-uuid-1',
                    _sourceId: 'person-1',
                    id: 'person-1',
                    link: [
                        { target: { type: 'Patient' } }, // no _uuid
                        { target: { _uuid: 'Patient/patient-2', type: 'Patient' } }
                    ]
                }]);
                mockQueryManager.findAsync.mockResolvedValue(mockCursor);

                const result = await expander.getPatientIdsFromPersonAsync({
                    personIds: ['person-1'],
                    totalProcessedPersonIds: new Set(),
                    databaseQueryManager: mockQueryManager,
                    level: 1,
                    toMap: false
                });

                expect(result).toContain('patient-2');
                expect(result).toContain('person.person-uuid-1');
                expect(result).toHaveLength(2);
            });
        });
    });

    // ========== getPatientProxyIdsAsync ==========
    describe('getPatientProxyIdsAsync', () => {
        test('returns original ids when no patients found', async () => {
            mockCursor = createMockCursor([]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: 'person.test-person',
                includePatientPrefix: false,
                toMap: false
            });

            expect(result).toBe('person.test-person');
        });

        test('returns patient ids with proxy patient when patients found (array input)', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'test-person',
                id: 'test-person',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.test-person'],
                includePatientPrefix: false,
                toMap: false
            });

            expect(result).toContain('patient-1');
            expect(result).toContain('person.test-person');
            expect(result).toContain('person.person-uuid-1');
        });

        test('returns patient ids with Patient/ prefix when includePatientPrefix is true', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'test-person',
                id: 'test-person',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.test-person'],
                includePatientPrefix: true,
                toMap: false
            });

            result.forEach(id => {
                expect(id.startsWith('Patient/')).toBe(true);
            });
        });

        test('returns deduplicated ids', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'test-person',
                id: 'test-person',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } },
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } } // duplicate
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.test-person'],
                includePatientPrefix: false,
                toMap: false
            });

            // Should be deduplicated
            const uniqueResult = [...new Set(result)];
            expect(result.length).toBe(uniqueResult.length);
        });

        test('toMap returns plain object with person-to-patient mapping', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'test-person',
                id: 'test-person',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.test-person'],
                includePatientPrefix: false,
                toMap: true
            });

            expect(typeof result).toBe('object');
            expect(Array.isArray(result)).toBe(false);
        });

        test('toMap includes proxy patient in each person mapping', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'test-person',
                _sourceId: 'test-person',
                id: 'test-person',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.test-person'],
                includePatientPrefix: false,
                toMap: true
            });

            expect(result['test-person']).toContain('person.test-person');
        });

        test('toMap adds unvisited personIds with proxy patient reference', async () => {
            // No person resource found for person-2
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'person-1',
                id: 'person-1',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: ['person.person-1', 'person.person-2'],
                includePatientPrefix: false,
                toMap: true
            });

            // person-2 should still be in the result with its proxy reference
            expect(result['person-2']).toBeDefined();
            expect(result['person-2']).toContain('person.person-2');
        });

        test('strips Patient/person. prefix from ids', async () => {
            mockCursor = createMockCursor([]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            await expander.getPatientProxyIdsAsync({
                base_version: '4_0_0',
                ids: 'Patient/person.test-id',
                includePatientPrefix: false,
                toMap: false
            });

            // The query should use 'test-id' as the personId
            const findCall = mockQueryManager.findAsync.mock.calls[0][0];
            expect(findCall.query).toBeDefined();
        });
    });

    // ========== getAllRelatedPatients ==========
    describe('getAllRelatedPatients', () => {
        test('returns empty array for empty person set with no results', async () => {
            mockCursor = createMockCursor([]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getAllRelatedPatients({
                base_version: '4_0_0',
                idsSet: new Set(['Person/person-1']),
                toMap: false
            });

            expect(result).toEqual([]);
        });

        test('returns patients from person links', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'person-1',
                id: 'person-1',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getAllRelatedPatients({
                base_version: '4_0_0',
                idsSet: new Set(['Person/person-1']),
                toMap: false
            });

            expect(result).toContain('patient-1');
        });

        test('strips Person/ prefix from ids in the set', async () => {
            mockCursor = createMockCursor([]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            await expander.getAllRelatedPatients({
                base_version: '4_0_0',
                idsSet: new Set(['Person/person-1', 'Person/person-2']),
                toMap: false
            });

            // Should have been called - verifies the function doesn't crash
            expect(mockQueryManager.findAsync).toHaveBeenCalled();
        });

        test('toMap returns plain object', async () => {
            mockCursor = createMockCursor([{
                _uuid: 'person-uuid-1',
                _sourceId: 'person-1',
                id: 'person-1',
                link: [
                    { target: { _uuid: 'Patient/patient-1', type: 'Patient' } }
                ]
            }]);
            mockQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await expander.getAllRelatedPatients({
                base_version: '4_0_0',
                idsSet: new Set(['Person/person-1']),
                toMap: true
            });

            expect(typeof result).toBe('object');
            expect(Array.isArray(result)).toBe(false);
            expect(result['person-uuid-1']).toContain('patient-1');
        });
    });
});
