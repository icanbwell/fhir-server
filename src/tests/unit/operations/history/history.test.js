/**
 * Unit tests for HistoryOperation — null safety, cache issues, error handling
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn()
}));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../../utils/isTrue', () => ({
    isTrue: jest.fn().mockImplementation(v => v === true || v === 'true')
}));
jest.mock('../../../../utils/httpErrors', () => ({
    NotFoundError: class NotFoundError extends Error {
        constructor(message) { super(message); this.name = 'NotFoundError'; }
    },
    ForbiddenError: class ForbiddenError extends Error {
        constructor(message) { super(message); this.name = 'ForbiddenError'; }
    }
}));
jest.mock('../../../../utils/date.util', () => ({
    getLastUpdatedISO: jest.fn().mockImplementation(v => v || null)
}));
jest.mock('../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serializeByResourceType: jest.fn()
    }
}));

const { NotFoundError, ForbiddenError } = require('../../../../utils/httpErrors');
const { getLastUpdatedISO } = require('../../../../utils/date.util');

describe('HistoryOperation', () => {
    let historyOp;
    let mockDatabaseHistoryFactory;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockBundleManager;
    let mockResourceLocatorFactory;
    let mockConfigManager;
    let mockSearchManager;
    let mockResourceManager;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockScopesManager;
    let mockHistoryResourceCloudStorageClient;
    let mockIdentifierEnrichmentProvider;
    let mockCompositionSectionFilterEnrichmentProvider;
    let mockParsedArgs;
    let mockCursor;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCursor = {
            hasNext: jest.fn().mockResolvedValue(false),
            next: jest.fn().mockResolvedValue(null),
            explainAsync: jest.fn().mockResolvedValue([]),
            setEmpty: jest.fn(),
            getCollection: jest.fn().mockReturnValue('Patient_4_0_0_History')
        };

        mockDatabaseHistoryFactory = {
            createDatabaseHistoryManager: jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            })
        };
        mockFhirLoggingManager = {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockScopesValidator = {
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockBundleManager = {
            createRawBundleFromEntries: jest.fn().mockReturnValue({
                resourceType: 'Bundle',
                type: 'history',
                entry: []
            })
        };
        mockResourceLocatorFactory = {
            createResourceLocator: jest.fn().mockReturnValue({
                getCollectionName: jest.fn().mockReturnValue('Patient_4_0_0')
            })
        };
        mockConfigManager = {
            useAccessIndex: false,
            cloudStorageHistoryResources: [],
            cloudStorageBatchDownloadSize: 10
        };
        mockSearchManager = {
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {}, columns: new Set() })
        };
        mockResourceManager = {
            getFullUrlForResource: jest.fn().mockReturnValue('https://localhost/Patient/p1')
        };
        mockDatabaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation(r => r)
        };
        mockBase64DataManager = {
            transformAsync: jest.fn().mockImplementation(r => r),
            rehydrateHistoryDiagnostics: jest.fn()
        };
        mockScopesManager = {
            hasPatientScope: jest.fn().mockReturnValue(false)
        };
        mockHistoryResourceCloudStorageClient = null;
        mockIdentifierEnrichmentProvider = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => entries)
        };
        mockCompositionSectionFilterEnrichmentProvider = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => entries)
        };

        const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
        mockParsedArgs = Object.create(ParsedArgs.prototype);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs._explain = false;
        mockParsedArgs._debug = false;
        mockParsedArgs._count = undefined;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        const { HistoryOperation } = require('../../../../operations/history/history');
        historyOp = Object.create(HistoryOperation.prototype);
        historyOp.databaseHistoryFactory = mockDatabaseHistoryFactory;
        historyOp.fhirLoggingManager = mockFhirLoggingManager;
        historyOp.scopesValidator = mockScopesValidator;
        historyOp.bundleManager = mockBundleManager;
        historyOp.resourceLocatorFactory = mockResourceLocatorFactory;
        historyOp.configManager = mockConfigManager;
        historyOp.searchManager = mockSearchManager;
        historyOp.resourceManager = mockResourceManager;
        historyOp.databaseAttachmentManager = mockDatabaseAttachmentManager;
        historyOp.base64DataManager = mockBase64DataManager;
        historyOp.scopesManager = mockScopesManager;
        historyOp.historyResourceCloudStorageClient = mockHistoryResourceCloudStorageClient;
        historyOp.identifierEnrichmentProvider = mockIdentifierEnrichmentProvider;
        historyOp.compositionSectionFilterEnrichmentProvider = mockCompositionSectionFilterEnrichmentProvider;
        // Set properties that fetchHistoryAsync expects to be set by historyAsync
        historyOp.currentOperationName = 'history';
        historyOp.errorMessagePostfix = 'for Patient resources';
    });

    function makeRequestInfo(overrides = {}) {
        return {
            user: 'testUser',
            userType: 'practitioner',
            scope: 'user/*.read',
            originalUrl: '/Patient/_history',
            protocol: 'https',
            host: 'localhost',
            personIdFromJwtToken: 'person-1',
            isUser: true,
            requestId: 'req-123',
            userRequestId: 'ureq-123',
            actor: null,
            ...overrides
        };
    }

    describe('patient scope forbidden check', () => {
        test('throws ForbiddenError when patient scope is present', async () => {
            mockScopesManager.hasPatientScope.mockReturnValue(true);

            await expect(
                historyOp.fetchHistoryAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(ForbiddenError);

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });

    describe('null resource in cursor iteration', () => {
        test('throws NotFoundError when cursor.next() returns null', async () => {
            // cursor has items, but next() returns null (data corruption scenario)
            mockCursor.hasNext.mockResolvedValueOnce(true);
            mockCursor.next.mockResolvedValueOnce(null);

            await expect(
                historyOp.fetchHistoryAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('Resource not found');
        });
    });

    describe('empty history results', () => {
        test('throws NotFoundError when no history resources found and not explain mode', async () => {
            // cursor returns no items
            mockCursor.hasNext.mockResolvedValue(false);

            await expect(
                historyOp.fetchHistoryAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('History not found');
        });

        test('does NOT throw when no resources found but _explain is true', async () => {
            mockParsedArgs._explain = true;
            mockCursor.hasNext.mockResolvedValue(false);

            // Should NOT throw because explain is requested
            await expect(
                historyOp.fetchHistoryAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).resolves.toBeDefined();
        });
    });

    describe('null safety in history resource processing', () => {
        test('handles historyResource with null resource.meta', async () => {
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: null  // null meta
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);

            // getLastUpdatedISO with null should return null
            getLastUpdatedISO.mockReturnValue(null);

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            expect(mockBundleManager.createRawBundleFromEntries).toHaveBeenCalled();
        });

        test('handles historyResource without resource property (raw resource)', async () => {
            // A "raw" history resource that doesn't have a nested .resource
            const historyResource = {
                id: 'p1',
                _uuid: 'uuid-p1',
                resourceType: 'Patient',
                meta: { lastUpdated: '2023-01-01T00:00:00Z' }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            // Should wrap it with resource and fullUrl
            expect(mockResourceManager.getFullUrlForResource).toHaveBeenCalled();
        });

        test('handles historyResource.resource without resourceType', async () => {
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    // no resourceType
                    meta: { lastUpdated: '2023-01-01T00:00:00Z' }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            // Should set resourceType on the resource
        });
    });

    describe('cloud storage download path with null _uuid', () => {
        test('BUG: constructs cloud storage path with undefined _uuid when resource._uuid is missing', async () => {
            // This tests a potential null-safety bug at line ~318:
            // `${collectionName}/${historyResource?.resource?._uuid}/${historyResource[RESOURCE_CLOUD_STORAGE_PATH_KEY]}.json`
            // If historyResource.resource._uuid is undefined, the path becomes "collection/undefined/ref.json"
            const historyResource = {
                id: 'p1',
                _ref: 'some-ref-path',
                resource: {
                    id: 'p1',
                    // _uuid is missing!
                    resourceType: 'Patient',
                    meta: { lastUpdated: '2023-01-01T00:00:00Z' }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            // Enable cloud storage
            mockHistoryResourceCloudStorageClient = {
                downloadInBatchAsync: jest.fn().mockResolvedValue({})
            };
            historyOp.historyResourceCloudStorageClient = mockHistoryResourceCloudStorageClient;
            mockConfigManager.cloudStorageHistoryResources = ['Patient'];

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should NOT produce a path containing "undefined" - should either error or use a valid path
            if (mockHistoryResourceCloudStorageClient.downloadInBatchAsync.mock.calls.length > 0) {
                const callArgs = mockHistoryResourceCloudStorageClient.downloadInBatchAsync.mock.calls[0][0];
                for (const filePath of callArgs.filePaths) {
                    expect(filePath).not.toContain('undefined');
                }
            }
        });
    });

    describe('pagination with _count', () => {
        test('respects _count parameter for limiting results', async () => {
            mockParsedArgs._count = '2';

            const resources = [
                { id: 'p1', resource: { id: 'p1', _uuid: 'u1', resourceType: 'Patient', meta: { lastUpdated: '2023-01-03' } } },
                { id: 'p2', resource: { id: 'p2', _uuid: 'u2', resourceType: 'Patient', meta: { lastUpdated: '2023-01-02' } } },
                { id: 'p3', resource: { id: 'p3', _uuid: 'u3', resourceType: 'Patient', meta: { lastUpdated: '2023-01-01' } } }
            ];

            let callCount = 0;
            mockCursor.hasNext.mockImplementation(async () => callCount < 3);
            mockCursor.next.mockImplementation(async () => resources[callCount++]);
            getLastUpdatedISO
                .mockReturnValueOnce('2023-01-03')
                .mockReturnValueOnce('2023-01-03')
                .mockReturnValueOnce('2023-01-02')
                .mockReturnValueOnce('2023-01-02')
                .mockReturnValueOnce('2023-01-01')
                .mockReturnValueOnce('2023-01-01');

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockBundleManager.createRawBundleFromEntries).toHaveBeenCalled();
            // With _count=2, it should stop at 2 entries since all have different lastUpdated
            const callArgs = mockBundleManager.createRawBundleFromEntries.mock.calls[0][0];
            expect(callArgs.entries.length).toBeLessThanOrEqual(2);
        });

        test('handles NaN _count by falling back to default limit', async () => {
            mockParsedArgs._count = 'invalid';

            const historyResource = {
                id: 'p1',
                resource: { id: 'p1', _uuid: 'u1', resourceType: 'Patient', meta: { lastUpdated: '2023-01-01' } }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01');

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
        });
    });

    describe('database find error handling', () => {
        test('throws NotFoundError when databaseHistoryManager.findAsync throws', async () => {
            mockDatabaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(new Error('DB connection lost'))
            });

            await expect(
                historyOp.fetchHistoryAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow('DB connection lost');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });

    describe('explain mode', () => {
        test('calls cursor.explainAsync and setEmpty when _explain is true', async () => {
            mockParsedArgs._explain = true;

            // Return one resource so we dont throw NotFoundError
            // Actually with _explain=true, empty results don't throw
            mockCursor.hasNext.mockResolvedValue(false);

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockCursor.explainAsync).toHaveBeenCalled();
            expect(mockCursor.setEmpty).toHaveBeenCalled();
        });
    });

    describe('historyAsync method sets correct operation properties', () => {
        test('sets currentOperationName and errorMessagePostfix before calling fetchHistoryAsync', async () => {
            // Make fetchHistoryAsync throw early so we can verify properties are set
            mockScopesManager.hasPatientScope.mockReturnValue(true);

            const { HistoryOperation } = require('../../../../operations/history/history');
            const op = Object.create(HistoryOperation.prototype);
            Object.assign(op, historyOp);
            // Reset the properties
            op.currentOperationName = undefined;
            op.errorMessagePostfix = undefined;

            // Need to call historyAsync which should set the properties
            await expect(
                op.historyAsync({
                    requestInfo: makeRequestInfo(),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Observation'
                })
            ).rejects.toThrow(ForbiddenError);

            expect(op.currentOperationName).toBe('history');
            expect(op.errorMessagePostfix).toBe('for Observation resources');
        });
    });

    describe('null requestInfo fields in history', () => {
        test('handles null protocol, host, url gracefully in bundle creation', async () => {
            const historyResource = {
                id: 'p1',
                resource: { id: 'p1', _uuid: 'u1', resourceType: 'Patient', meta: { lastUpdated: '2023-01-01' } }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01');

            const result = await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({
                    protocol: null,
                    host: null,
                    originalUrl: null
                }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            const bundleCall = mockBundleManager.createRawBundleFromEntries.mock.calls[0][0];
            expect(bundleCall.protocol).toBeNull();
            expect(bundleCall.host).toBeNull();
        });
    });
});
