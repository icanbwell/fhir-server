/**
 * Unit tests for EverythingHelper
 * Top 3 largest methods: retriveEverythingAsync, retrieveEverythingMulipleIdsAsync, retriveveRelatedResourcesParallelyAsync
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/metrics', () => ({
    recordOutboundEverything: jest.fn()
}));

// Mock assertTypeEquals to avoid instanceof checks during construction
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const httpContext = require('express-http-context');

describe('EverythingHelper', () => {
    let everythingHelper;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockBundleManager;
    let mockSearchManager;
    let mockScopesValidator;
    let mockEnrichmentManager;
    let mockR4ArgsParser;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockSearchParametersManager;
    let mockEverythingRelatedResourceMapper;
    let mockCustomTracer;
    let mockPatientDataViewControlManager;
    let mockAuditLogger;
    let mockPostRequestProcessor;
    let mockRedisStreamManager;

    beforeEach(() => {
        jest.clearAllMocks();

        mockDatabaseQueryFactory = {
            createQuery: jest.fn()
        };
        mockConfigManager = {
            useAccessIndex: false,
            everythingBatchSize: 10,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            writeToCacheForEverythingOperation: false,
            readFromCacheForEverythingOperation: false,
            everythingCacheTtlSeconds: 300,
            everythingMaxParallelProcess: 5,
            mongoInQueryIdBatchSize: 100,
            externalServicesWithRestrictions: {}
        };
        mockBundleManager = {
            createRawBundle: jest.fn().mockReturnValue({ resourceType: 'Bundle', type: 'searchset', entry: [] })
        };
        mockSearchManager = {
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {} })
        };
        mockScopesValidator = {
            hasValidScopesAsync: jest.fn().mockResolvedValue(true)
        };
        mockEnrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };
        mockR4ArgsParser = {
            parseArgs: jest.fn().mockReturnValue({
                get: jest.fn(),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {}
            })
        };
        mockDatabaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        mockBase64DataManager = {
            transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        mockSearchParametersManager = {
            getFieldNameForSearchParameter: jest.fn().mockReturnValue('subject.reference')
        };
        mockEverythingRelatedResourceMapper = {};
        mockCustomTracer = {
            trace: jest.fn().mockImplementation(({ func }) => func())
        };
        mockPatientDataViewControlManager = {
            getConsentAsync: jest.fn().mockResolvedValue({
                viewControlResourceToExcludeMap: {},
                viewControlConsentQueries: [],
                viewControlConsentQueryOptions: []
            })
        };
        mockAuditLogger = {
            logAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockPostRequestProcessor = {
            add: jest.fn()
        };
        mockRedisStreamManager = {
            hasCachedStream: jest.fn().mockResolvedValue(false),
            deleteStream: jest.fn().mockResolvedValue(undefined)
        };

        // Import EverythingHelper after mocks are set up
        const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');

        everythingHelper = Object.create(EverythingHelper.prototype);
        everythingHelper.databaseQueryFactory = mockDatabaseQueryFactory;
        everythingHelper.configManager = mockConfigManager;
        everythingHelper.bundleManager = mockBundleManager;
        everythingHelper.searchManager = mockSearchManager;
        everythingHelper.scopesValidator = mockScopesValidator;
        everythingHelper.enrichmentManager = mockEnrichmentManager;
        everythingHelper.r4ArgsParser = mockR4ArgsParser;
        everythingHelper.databaseAttachmentManager = mockDatabaseAttachmentManager;
        everythingHelper.base64DataManager = mockBase64DataManager;
        everythingHelper.searchParametersManager = mockSearchParametersManager;
        everythingHelper.everythingRelatedResourceMapper = mockEverythingRelatedResourceMapper;
        everythingHelper.customTracer = mockCustomTracer;
        everythingHelper.patientDataViewControlManager = mockPatientDataViewControlManager;
        everythingHelper.auditLogger = mockAuditLogger;
        everythingHelper.postRequestProcessor = mockPostRequestProcessor;
        everythingHelper.redisStreamManager = mockRedisStreamManager;
        everythingHelper.supportedResources = ['Patient'];
        everythingHelper.relatedResourceNeedingPatientScopeFilter = {
            Patient: ['Subscription', 'SubscriptionTopic', 'SubscriptionStatus', 'Person']
        };
        everythingHelper.uuidProjection = {
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            resourceType: 1
        };
    });

    describe('fetchOriginalIdsFromParams', () => {
        test('returns empty array when no id param exists', () => {
            const parsedArgs = {
                getOriginal: jest.fn().mockReturnValue(null)
            };
            const result = everythingHelper.fetchOriginalIdsFromParams(parsedArgs);
            expect(result).toEqual([]);
        });

        test('returns single id', () => {
            const parsedArgs = {
                getOriginal: jest.fn().mockImplementation((key) => {
                    if (key === 'id') return { queryParameterValue: { value: 'patient-123' } };
                    return null;
                })
            };
            const result = everythingHelper.fetchOriginalIdsFromParams(parsedArgs);
            expect(result).toEqual(['patient-123']);
        });

        test('returns multiple comma-separated ids', () => {
            const parsedArgs = {
                getOriginal: jest.fn().mockImplementation((key) => {
                    if (key === 'id') return { queryParameterValue: { value: 'id1,id2,id3' } };
                    return null;
                })
            };
            const result = everythingHelper.fetchOriginalIdsFromParams(parsedArgs);
            expect(result).toEqual(['id1', 'id2', 'id3']);
        });

        test('uses _id when id is not present', () => {
            const parsedArgs = {
                getOriginal: jest.fn().mockImplementation((key) => {
                    if (key === '_id') return { queryParameterValue: { value: 'uuid-456' } };
                    return null;
                })
            };
            const result = everythingHelper.fetchOriginalIdsFromParams(parsedArgs);
            expect(result).toEqual(['uuid-456']);
        });
    });

    describe('fetchPatientUUID', () => {
        test('returns uuids from database cursor', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                next: jest.fn()
                    .mockResolvedValueOnce({ _uuid: 'uuid-1' })
                    .mockResolvedValueOnce({ _uuid: 'uuid-2' })
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });
            const parsedArgs = {};
            const requestInfo = {
                user: 'testUser',
                scope: 'patient/*.*',
                isUser: true,
                userType: null,
                personIdFromJwtToken: 'person-1',
                requestId: 'req-1',
                actor: 'actor-1'
            };
            const result = await everythingHelper.fetchPatientUUID(parsedArgs, requestInfo, 'Patient', '4_0_0');
            expect(result).toEqual(['uuid-1', 'uuid-2']);
        });

        test('returns empty array when cursor has no results', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false),
                next: jest.fn()
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });
            const result = await everythingHelper.fetchPatientUUID({}, {
                user: 'u', scope: 's', isUser: true, userType: null,
                personIdFromJwtToken: 'p', requestId: 'r', actor: 'a'
            }, 'Patient', '4_0_0');
            expect(result).toEqual([]);
        });
    });

    describe('getCacheKey', () => {
        test('returns undefined when personIdFromJwtToken is missing', async () => {
            const requestInfo = { personIdFromJwtToken: null, userType: null };
            const parsedArgs = { getOriginal: jest.fn().mockReturnValue(null) };
            const result = await everythingHelper.getCacheKey(parsedArgs, requestInfo, 'Patient', '4_0_0');
            expect(result).toBeUndefined();
        });

        test('returns undefined when userType is present', async () => {
            const requestInfo = { personIdFromJwtToken: 'person-1', userType: 'service' };
            const parsedArgs = { getOriginal: jest.fn().mockReturnValue(null) };
            const result = await everythingHelper.getCacheKey(parsedArgs, requestInfo, 'Patient', '4_0_0');
            expect(result).toBeUndefined();
        });
    });

    describe('retriveEverythingAsync', () => {
        test('throws error for unsupported resource types', async () => {
            const parsedArgs = { get: jest.fn() };
            const requestInfo = { user: 'u', requestId: 'r' };
            await expect(
                everythingHelper.retriveEverythingAsync({
                    requestInfo,
                    base_version: '4_0_0',
                    resourceType: 'Observation',
                    parsedArgs
                })
            ).rejects.toThrow('$everything is not supported for resource: Observation');
        });

        test('throws BadRequestError when no id passed', async () => {
            const parsedArgs = {
                get: jest.fn().mockReturnValue(null),
                _since: null,
                _explain: false,
                _debug: false,
                _includeHidden: false,
                headers: { prefer: '' },
                resourceFilterList: null,
                clone: jest.fn().mockReturnThis(),
                getRawArgs: jest.fn().mockReturnValue({})
            };
            // Pretend ParsedArgs type check passes
            const { assertTypeEquals } = require('../../../../utils/assertType');
            assertTypeEquals.mockImplementation(() => {});

            const requestInfo = {
                user: 'u',
                requestId: 'r',
                userRequestId: 'ur',
                host: 'host',
                protocol: 'https',
                isUser: false,
                skipCachedData: jest.fn().mockReturnValue(false)
            };
            await expect(
                everythingHelper.retriveEverythingAsync({
                    requestInfo,
                    base_version: '4_0_0',
                    resourceType: 'Patient',
                    parsedArgs
                })
            ).rejects.toThrow('No id was passed');
        });
    });

    describe('getPropertiesForEntity - in EverythingHelper', () => {
        test('returns nested property value', () => {
            const resource = {
                subject: { reference: 'Patient/123', _uuid: 'Patient/uuid-1' }
            };
            const result = everythingHelper.getPropertiesForEntity({
                resource,
                property: 'subject.reference'
            });
            expect(result).toEqual(['Patient/123']);
        });

        test('returns empty array for missing nested property', () => {
            const resource = { id: '123' };
            const result = everythingHelper.getPropertiesForEntity({
                resource,
                property: 'subject.reference'
            });
            expect(result).toEqual([]);
        });

        test('returns top-level property value', () => {
            const resource = { status: 'active' };
            const result = everythingHelper.getPropertiesForEntity({
                resource,
                property: 'status'
            });
            expect(result).toEqual(['active']);
        });

        test('applies filter on nested property', () => {
            const resource = {
                contact: {
                    telecom: [
                        { system: 'phone', value: '555-1234' },
                        { system: 'email', value: 'test@test.com' }
                    ]
                }
            };
            const result = everythingHelper.getPropertiesForEntity({
                resource,
                property: 'contact.telecom',
                filterProperty: 'system',
                filterValue: 'phone'
            });
            expect(result).toEqual([{ system: 'phone', value: '555-1234' }]);
        });
    });

    describe('getReferencesFromPropertyValue - EverythingHelper version', () => {
        test('returns uuids for array property values (no legacy)', () => {
            mockConfigManager.supportLegacyIds = false;
            const propertyValue = [
                { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' },
                { _uuid: 'Patient/uuid-2', reference: 'Patient/id-2' }
            ];
            const result = everythingHelper.getReferencesFromPropertyValue({ propertyValue });
            expect(result).toEqual(['Patient/uuid-1', 'Patient/uuid-2']);
        });

        test('returns uuids and references for array values with legacy support', () => {
            mockConfigManager.supportLegacyIds = true;
            const propertyValue = [
                { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' }
            ];
            const result = everythingHelper.getReferencesFromPropertyValue({ propertyValue, supportLegacyId: true });
            expect(result).toEqual(['Patient/uuid-1', 'Patient/id-1']);
        });

        test('returns uuid for single value (no legacy)', () => {
            mockConfigManager.supportLegacyIds = false;
            const propertyValue = { _uuid: 'Patient/uuid-1', reference: 'Patient/id-1' };
            const result = everythingHelper.getReferencesFromPropertyValue({ propertyValue });
            expect(result).toEqual(['Patient/uuid-1']);
        });
    });

    describe('parseQueryStringIntoArgs', () => {
        test('parses simple query string', () => {
            const mockParsed = { id: 'parsed' };
            mockR4ArgsParser.parseArgs.mockReturnValue(mockParsed);
            const result = everythingHelper.parseQueryStringIntoArgs({
                resourceType: 'Observation',
                queryString: 'subject=Patient/123&status=final'
            });
            expect(mockR4ArgsParser.parseArgs).toHaveBeenCalled();
            const callArgs = mockR4ArgsParser.parseArgs.mock.calls[0][0];
            expect(callArgs.resourceType).toBe('Observation');
            expect(callArgs.args.subject).toBe('Patient/123');
            expect(callArgs.args.status).toBe('final');
        });

        test('merges commonArgs with query string params', () => {
            mockR4ArgsParser.parseArgs.mockReturnValue({});
            everythingHelper.parseQueryStringIntoArgs({
                resourceType: 'Condition',
                queryString: 'patient=Patient/1',
                commonArgs: { _includeHidden: true }
            });
            const callArgs = mockR4ArgsParser.parseArgs.mock.calls[0][0];
            expect(callArgs.args._includeHidden).toBe(true);
            expect(callArgs.args.patient).toBe('Patient/1');
        });
    });

    describe('loop boundaries', () => {
        test('fetchPatientUUID with 0 results', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false),
                next: jest.fn()
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });
            const result = await everythingHelper.fetchPatientUUID({}, {
                user: 'u', scope: 's', isUser: true, userType: null,
                personIdFromJwtToken: 'p', requestId: 'r', actor: 'a'
            }, 'Patient', '4_0_0');
            expect(result).toHaveLength(0);
        });

        test('fetchPatientUUID with 1 result', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                next: jest.fn().mockResolvedValueOnce({ _uuid: 'single-uuid' })
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });
            const result = await everythingHelper.fetchPatientUUID({}, {
                user: 'u', scope: 's', isUser: true, userType: null,
                personIdFromJwtToken: 'p', requestId: 'r', actor: 'a'
            }, 'Patient', '4_0_0');
            expect(result).toHaveLength(1);
            expect(result[0]).toBe('single-uuid');
        });

        test('fetchPatientUUID with >1 results', async () => {
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jest.fn()
                    .mockResolvedValueOnce({ _uuid: 'u1' })
                    .mockResolvedValueOnce({ _uuid: 'u2' })
                    .mockResolvedValueOnce({ _uuid: 'u3' })
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });
            const result = await everythingHelper.fetchPatientUUID({}, {
                user: 'u', scope: 's', isUser: true, userType: null,
                personIdFromJwtToken: 'p', requestId: 'r', actor: 'a'
            }, 'Patient', '4_0_0');
            expect(result).toHaveLength(3);
        });
    });

    describe('processCursorAsync', () => {
        test('returns empty array when cursor has no items', async () => {
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false),
                next: jest.fn()
            };
            const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');
            const bundleEntryIdsProcessedTracker = {
                has: jest.fn().mockReturnValue(false),
                add: jest.fn()
            };
            const everythingRelatedResourceManager = {
                allowedToBeSent: jest.fn().mockReturnValue(true)
            };

            const result = await everythingHelper.processCursorAsync({
                cursor: mockCursor,
                requestInfo: { userType: null, actor: null, isUser: false },
                responseStreamer: undefined,
                parentParsedArgs: { _since: null, headers: { prefer: '' } },
                bundleEntryIdsProcessedTracker,
                resourceIdentifiers: [],
                nonClinicalReferencesExtractor: null,
                everythingRelatedResourceManager
            });
            expect(result.bundleEntries).toEqual([]);
            expect(result.streamedResources).toEqual([]);
        });

        test('processes single resource from cursor', async () => {
            const mockResource = {
                id: 'obs-1',
                _uuid: 'obs-uuid-1',
                _sourceId: 'obs-1',
                resourceType: 'Observation',
                meta: { lastUpdated: new Date() }
            };
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                next: jest.fn().mockResolvedValueOnce(mockResource)
            };
            const bundleEntryIdsProcessedTracker = {
                has: jest.fn().mockReturnValue(false),
                add: jest.fn()
            };
            const everythingRelatedResourceManager = {
                allowedToBeSent: jest.fn().mockReturnValue(true)
            };
            const { ResourceMapper } = require('../../../../operations/everything/resourceMapper');

            const result = await everythingHelper.processCursorAsync({
                cursor: mockCursor,
                requestInfo: { userType: null, actor: null, isUser: false },
                responseStreamer: undefined,
                parentParsedArgs: { _since: null, headers: { prefer: '' } },
                bundleEntryIdsProcessedTracker,
                resourceIdentifiers: [],
                nonClinicalReferencesExtractor: null,
                everythingRelatedResourceManager,
                useUuidProjection: false,
                resourceMapper: { map: (r) => r }
            });
            expect(result.bundleEntries).toHaveLength(1);
            expect(result.bundleEntries[0].resource.resourceType).toBe('Observation');
        });
    });
});
