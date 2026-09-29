const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

// Mock express-http-context at top level
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

const httpContext = require('express-http-context');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { ConfigManager } = require('../../../utils/configManager');
const { SearchManager } = require('../../../operations/search/searchManager');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { HTTP_CONTEXT_KEYS, CONSENT_CATEGORY } = require('../../../constants');

/**
 * CACHE ANALYSIS for PatientDataViewControlManager.getConsentAsync:
 *
 * 1. Cache mechanism: httpContext.get() reads person owner from request-scoped context
 * 2. Cache KEY dimensions: `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${personIdFromJwtToken}` = "personOwnerFor-<personId>"
 * 3. Method PARAMETERS: requestInfo (contains personIdFromJwtToken), base_version, patientFilterReferences, raiseErrorForMissingUserOwner
 * 4. Params NOT in key: base_version, patientFilterReferences, raiseErrorForMissingUserOwner - the cache key only uses personIdFromJwtToken
 * 5. Cached VALUE: The owner code string (e.g., "clientA") set previously by PersonToPatientIdsExpander
 * 6. Downstream consumer: Used to check if owner is in clientsWithDataConnectionViewControl list
 * 7. Required test: Call with same personId but different base_version/patientFilterReferences, verify same cached owner is used
 * 8. Mock setup: httpContext.get mock returns different values; configManager with clientsWithDataConnectionViewControl getter
 * 9. Assertion: When httpContext returns stale owner, the consent logic may incorrectly skip/apply filtering
 */

// Helper to create mock instances that pass assertTypeEquals
function createMockConfigManager(overrides = {}) {
    const instance = Object.create(ConfigManager.prototype);
    Object.defineProperty(instance, 'clientsWithDataConnectionViewControl', {
        get: () => overrides.clientsWithDataConnectionViewControl || [],
        configurable: true
    });
    return instance;
}

function createMockSearchManager() {
    const instance = Object.create(SearchManager.prototype);
    instance.fetchResourcesByArgsAsync = jest.fn().mockResolvedValue({
        entries: [],
        queryItems: [],
        options: []
    });
    return instance;
}

function createMockR4ArgsParser() {
    const instance = Object.create(R4ArgsParser.prototype);
    instance.parseArgs = jest.fn().mockReturnValue({ parsedArgItems: [] });
    return instance;
}

function createRequestInfo(personId, overrides = {}) {
    return {
        personIdFromJwtToken: personId,
        user: overrides.user || 'test-user',
        scope: overrides.scope || 'patient/*.*',
        isUser: overrides.isUser !== undefined ? overrides.isUser : true,
        userType: overrides.userType || 'user',
        requestId: overrides.requestId || 'req-123',
        ...overrides
    };
}

describe('PatientDataViewControlManager', () => {
    let manager;
    let mockConfigManager;
    let mockSearchManager;
    let mockR4ArgsParser;

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigManager = createMockConfigManager({
            clientsWithDataConnectionViewControl: ['clientA', 'clientB']
        });
        mockSearchManager = createMockSearchManager();
        mockR4ArgsParser = createMockR4ArgsParser();

        manager = new PatientDataViewControlManager({
            configManager: mockConfigManager,
            searchManager: mockSearchManager,
            r4ArgsParser: mockR4ArgsParser
        });
    });

    describe('getConsentAsync', () => {
        describe('httpContext.get behavior (cache reading)', () => {
            test('reads person owner from httpContext using correct key', async () => {
                httpContext.get.mockReturnValue('clientA');

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(httpContext.get).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-123`
                );
            });

            test('throws assertion error when owner is null and raiseErrorForMissingUserOwner is true', async () => {
                httpContext.get.mockReturnValue(null);

                await expect(
                    manager.getConsentAsync({
                        requestInfo: createRequestInfo('person-123'),
                        base_version: '4_0_0',
                        patientFilterReferences: null,
                        raiseErrorForMissingUserOwner: true
                    })
                ).rejects.toThrow();
            });

            test('does NOT throw when owner is null and raiseErrorForMissingUserOwner is false', async () => {
                httpContext.get.mockReturnValue(null);

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null,
                    raiseErrorForMissingUserOwner: false
                });

                expect(result).toEqual({
                    viewControlResourceToExcludeMap: {},
                    viewControlConsentQueries: [],
                    viewControlConsentQueryOptions: []
                });
            });

            test('returns empty result when owner is NOT in clientsWithDataConnectionViewControl', async () => {
                httpContext.get.mockReturnValue('clientC'); // Not in [clientA, clientB]

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result).toEqual({
                    viewControlResourceToExcludeMap: {},
                    viewControlConsentQueries: [],
                    viewControlConsentQueryOptions: []
                });
                // Should NOT call searchManager since owner is not in the list
                expect(mockSearchManager.fetchResourcesByArgsAsync).not.toHaveBeenCalled();
            });

            test('calls searchManager when owner IS in clientsWithDataConnectionViewControl', async () => {
                httpContext.get.mockReturnValue('clientA'); // In the list

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalled();
            });
        });

        describe('search parameters construction', () => {
            test('constructs correct consent args with personId', async () => {
                httpContext.get.mockReturnValue('clientA');

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-456'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                    resourceType: 'Consent',
                    args: expect.objectContaining({
                        base_version: '4_0_0',
                        patient: 'Patient/person.person-456',
                        category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
                    })
                });
            });

            test('includes actor when patientFilterReferences provided', async () => {
                httpContext.get.mockReturnValue('clientA');

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-456'),
                    base_version: '4_0_0',
                    patientFilterReferences: ['Patient/pat-1', 'Patient/pat-2']
                });

                expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                    resourceType: 'Consent',
                    args: expect.objectContaining({
                        actor: 'Patient/pat-1,Patient/pat-2'
                    })
                });
            });

            test('does NOT include actor when patientFilterReferences is null', async () => {
                httpContext.get.mockReturnValue('clientA');

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-456'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                const parsedCall = mockR4ArgsParser.parseArgs.mock.calls[0][0];
                expect(parsedCall.args.actor).toBeUndefined();
            });

            test('does NOT include actor when patientFilterReferences is empty array', async () => {
                httpContext.get.mockReturnValue('clientA');

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-456'),
                    base_version: '4_0_0',
                    patientFilterReferences: []
                });

                const parsedCall = mockR4ArgsParser.parseArgs.mock.calls[0][0];
                expect(parsedCall.args.actor).toBeUndefined();
            });
        });

        describe('consent entry processing', () => {
            test('builds viewControlResourceToExcludeMap from consent entries (0 entries)', async () => {
                httpContext.get.mockReturnValue('clientA');
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [],
                    queryItems: ['query1'],
                    options: ['opt1']
                });

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({});
                expect(result.viewControlConsentQueries).toEqual(['query1']);
                expect(result.viewControlConsentQueryOptions).toEqual(['opt1']);
            });

            test('extracts resource types and ids from consent provision data (1 entry)', async () => {
                httpContext.get.mockReturnValue('clientA');
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {
                                data: [{
                                    reference: {
                                        reference: 'Observation/obs-1'
                                    }
                                }]
                            }
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({
                    Observation: ['obs-1']
                });
            });

            test('groups multiple references by resource type (>1 entries)', async () => {
                httpContext.get.mockReturnValue('clientA');
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [
                        {
                            resource: {
                                provision: {
                                    data: [
                                        { reference: { reference: 'Observation/obs-1' } },
                                        { reference: { reference: 'Observation/obs-2' } },
                                        { reference: { reference: 'Condition/cond-1' } }
                                    ]
                                }
                            }
                        },
                        {
                            resource: {
                                provision: {
                                    data: [
                                        { reference: { reference: 'Observation/obs-3' } }
                                    ]
                                }
                            }
                        }
                    ],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({
                    Observation: ['obs-1', 'obs-2', 'obs-3'],
                    Condition: ['cond-1']
                });
            });

            test('handles consent entry with no provision', async () => {
                httpContext.get.mockReturnValue('clientA');
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {}
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({});
            });

            test('handles consent entry with provision but no data', async () => {
                httpContext.get.mockReturnValue('clientA');
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {}
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({});
            });

            test('skips data entries with no reference.reference', async () => {
                httpContext.get.mockReturnValue('clientA');
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {
                                data: [
                                    { reference: {} },  // no reference field
                                    { reference: { reference: 'Observation/obs-1' } }, // valid
                                    { }  // no reference object at all
                                ]
                            }
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({
                    Observation: ['obs-1']
                });
            });
        });

        describe('stale httpContext cache scenarios', () => {
            test('BUG: same personId with different base_version uses same cached owner', async () => {
                // The cache key is ONLY based on personIdFromJwtToken.
                // If the person's owner differs across base_versions (unlikely but possible),
                // the cached value from the first call will be used for all subsequent calls.

                // First call - httpContext returns 'clientA' (set by PersonToPatientIdsExpander for base_version 4_0_0)
                httpContext.get.mockReturnValue('clientA');

                const result1 = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                // searchManager should be called because clientA is in the list
                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(1);

                // Second call with different base_version but same personId
                // httpContext still returns the same 'clientA' because the cache key doesn't include base_version
                httpContext.get.mockReturnValue('clientA');

                const result2 = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '3_0_2', // different base_version
                    patientFilterReferences: ['Patient/pat-new']
                });

                // Both calls used the same cached owner value regardless of base_version
                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(2);

                // The second search should use base_version '3_0_2'
                const secondCall = mockSearchManager.fetchResourcesByArgsAsync.mock.calls[1][0];
                expect(secondCall.base_version).toBe('3_0_2');
            });

            test('BUG: stale httpContext returns wrong owner leading to incorrect skip', async () => {
                // Scenario: PersonToPatientIdsExpander set owner as 'clientC' (not in control list)
                // but the actual owner has changed to 'clientA' (in control list).
                // The stale cache causes getConsentAsync to skip consent filtering entirely.

                // httpContext returns stale value 'clientC' which is NOT in [clientA, clientB]
                httpContext.get.mockReturnValue('clientC');

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                // Because 'clientC' is not in the control list, it returns empty result
                // WITHOUT even querying for consents - this is the stale cache bug
                expect(result.viewControlResourceToExcludeMap).toEqual({});
                expect(mockSearchManager.fetchResourcesByArgsAsync).not.toHaveBeenCalled();
            });

            test('BUG: httpContext returns stale owner leading to unnecessary consent query', async () => {
                // Scenario: PersonToPatientIdsExpander set owner as 'clientA' (in control list)
                // but the actual owner has changed to 'clientC' (not in control list).
                // The stale cache causes getConsentAsync to unnecessarily query for consents.

                // httpContext returns stale value 'clientA' which IS in [clientA, clientB]
                httpContext.get.mockReturnValue('clientA');

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                // searchManager IS called because of stale cache value
                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(1);
            });

            test('calling with different personIds reads different cache keys', async () => {
                httpContext.get
                    .mockReturnValueOnce('clientA') // for person-1
                    .mockReturnValueOnce('clientC'); // for person-2

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-1'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-2'),
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(httpContext.get).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-1`
                );
                expect(httpContext.get).toHaveBeenCalledWith(
                    `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}person-2`
                );

                // First call (clientA in list) should trigger search
                // Second call (clientC not in list) should NOT trigger search
                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(1);
            });
        });

        describe('userOwnerFromContext is null with raiseErrorForMissingUserOwner=false', () => {
            test('BUG: proceeds to search for consents even when owner is null', async () => {
                // When userOwnerFromContext is null and raiseErrorForMissingUserOwner is false,
                // the code does NOT return early. The condition on line 74 is:
                //   if (userOwnerFromContext && !this.configManager.clientsWithDataConnectionViewControl.includes(...))
                // When null, the && short-circuits, so it falls through to the search query.
                // This is likely a bug: with no owner context, we should not be querying for consents.
                httpContext.get.mockReturnValue(null);

                const result = await manager.getConsentAsync({
                    requestInfo: createRequestInfo('person-123'),
                    base_version: '4_0_0',
                    patientFilterReferences: null,
                    raiseErrorForMissingUserOwner: false
                });

                // BUG: searchManager IS called even when owner is null
                // This means unnecessary consent queries are made when no owner is in context
                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(1);

                // The result is whatever the searchManager returns (empty in this case)
                expect(result.viewControlResourceToExcludeMap).toEqual({});
            });
        });
    });
});
