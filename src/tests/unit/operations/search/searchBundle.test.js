'use strict';

const { describe, beforeEach, it, expect, jest } = require('@jest/globals');

const { SearchBundleOperation } = require('../../../../operations/search/searchBundle');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { BundleManager } = require('../../../../operations/common/bundleManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

jest.mock('../../../../utils/resourceUpdater', () => ({
    resourceReferenceUpdater: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../../fhir/serializers/4_0_0/custom_utils/referenceEnricher', () => ({
    enrichReferenceExtension: jest.fn()
}));

describe('SearchBundleOperation', () => {
    let searchBundleOp;
    let mockSearchManager;
    let mockResourceLocatorFactory;
    let mockAuditLogger;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockBundleManager;
    let mockConfigManager;
    let mockPostRequestProcessor;

    beforeEach(() => {
        mockSearchManager = Object.create(SearchManager.prototype);
        mockSearchManager.constructQueryAsync = jest.fn();
        mockSearchManager.getCursorForQueryAsync = jest.fn();
        mockSearchManager.readResourcesFromCursorAsync = jest.fn();
        mockSearchManager.validateAuditEventQueryParameters = jest.fn();

        mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
        mockResourceLocatorFactory.createResourceLocator = jest.fn();

        mockAuditLogger = Object.create(AuditLogger.prototype);
        mockAuditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);

        mockFhirLoggingManager = Object.create(FhirLoggingManager.prototype);
        mockFhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

        mockScopesValidator = Object.create(ScopesValidator.prototype);
        mockScopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);

        mockBundleManager = Object.create(BundleManager.prototype);
        mockBundleManager.createRawBundle = jest.fn();

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'useAccessIndex', { get: () => false, configurable: true });
        Object.defineProperty(mockConfigManager, 'mongoTimeout', { get: () => 30000, configurable: true });
        Object.defineProperty(mockConfigManager, 'defaultSortId', { get: () => '_uuid', configurable: true });

        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jest.fn();

        searchBundleOp = new SearchBundleOperation({
            searchManager: mockSearchManager,
            resourceLocatorFactory: mockResourceLocatorFactory,
            auditLogger: mockAuditLogger,
            fhirLoggingManager: mockFhirLoggingManager,
            scopesValidator: mockScopesValidator,
            bundleManager: mockBundleManager,
            configManager: mockConfigManager,
            postRequestProcessor: mockPostRequestProcessor
        });
    });

    describe('searchBundleAsync', () => {
        let mockParsedArgs;
        let mockRequestInfo;

        beforeEach(() => {
            mockParsedArgs = Object.create(ParsedArgs.prototype);
            mockParsedArgs.base_version = '4_0_0';
            mockParsedArgs._useAccessIndex = undefined;
            mockParsedArgs._explain = undefined;
            mockParsedArgs._debug = undefined;
            mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

            mockRequestInfo = {
                user: 'testUser',
                scope: 'patient/*.read',
                originalUrl: '/Patient',
                personIdFromJwtToken: 'person-123',
                isUser: true,
                protocol: 'https',
                host: 'example.com',
                requestId: 'req-123',
                userRequestId: 'ureq-123',
                actor: null,
                userType: 'patient',
                externalReqUrlPrefix: undefined,
                headers: {}
            };
        });

        it('should handle cursor returning null from getCursorForQueryAsync', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: { status: 'active' },
                columns: new Set()
            });

            mockResourceLocatorFactory.createResourceLocator.mockReturnValue({
                getCollectionName: () => 'Patient_4_0_0'
            });

            // cursor is null - resources should be used directly
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: {},
                originalOptions: [{}],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: null
            });

            const mockBundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };
            mockBundleManager.createRawBundle.mockReturnValue(mockBundle);

            const result = await searchBundleOp.searchBundleAsync({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                useAggregationPipeline: false
            });

            expect(result).toBe(mockBundle);
            // When cursor is null, readResourcesFromCursorAsync should NOT be called
            expect(mockSearchManager.readResourcesFromCursorAsync).not.toHaveBeenCalled();
        });

        it('should access last resource defaultSortId property for pagination', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {},
                columns: new Set()
            });

            mockResourceLocatorFactory.createResourceLocator.mockReturnValue({
                getCollectionName: () => 'Patient_4_0_0'
            });

            const mockCursor = {
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn()
            };

            // Resources that are returned from readResourcesFromCursorAsync
            const mockResources = [
                { _uuid: 'uuid-1', id: 'id-1' },
                { _uuid: 'uuid-2', id: 'id-2' }
            ];

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: {},
                originalOptions: [{}],
                resources: [],
                total_count: 2,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });

            mockSearchManager.readResourcesFromCursorAsync.mockResolvedValue(mockResources);

            const mockBundle = { resourceType: 'Bundle', type: 'searchset' };
            mockBundleManager.createRawBundle.mockReturnValue(mockBundle);

            await searchBundleOp.searchBundleAsync({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                useAggregationPipeline: false
            });

            // Verify createRawBundle was called with correct last_id based on defaultSortId
            expect(mockBundleManager.createRawBundle).toHaveBeenCalledWith(
                expect.objectContaining({
                    last_id: 'uuid-2'  // defaultSortId is '_uuid', so it accesses resources[1]._uuid
                })
            );
        });

        it('BUG: when defaultSortId property is missing from resources, last_id is undefined', async () => {
            // This tests the case where defaultSortId points to a field that doesn't exist
            // on the resources. This can happen if DEFAULT_SORT_ID env var is misconfigured.
            Object.defineProperty(mockConfigManager, 'defaultSortId', { get: () => 'nonExistentField', configurable: true });

            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {},
                columns: new Set()
            });

            mockResourceLocatorFactory.createResourceLocator.mockReturnValue({
                getCollectionName: () => 'Patient_4_0_0'
            });

            const mockCursor = {
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn()
            };

            const mockResources = [
                { _uuid: 'uuid-1', id: 'id-1' },
                { _uuid: 'uuid-2', id: 'id-2' }
            ];

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: {},
                originalOptions: [{}],
                resources: [],
                total_count: 2,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });

            mockSearchManager.readResourcesFromCursorAsync.mockResolvedValue(mockResources);

            const mockBundle = { resourceType: 'Bundle', type: 'searchset' };
            mockBundleManager.createRawBundle.mockReturnValue(mockBundle);

            await searchBundleOp.searchBundleAsync({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                useAggregationPipeline: false
            });

            // BUG: last_id will be undefined because 'nonExistentField' doesn't exist on resources
            // This means pagination will break - next page link will be invalid
            expect(mockBundleManager.createRawBundle).toHaveBeenCalledWith(
                expect.objectContaining({
                    last_id: undefined  // BUG: should not allow undefined - pagination broken
                })
            );
        });

        it('should wrap errors from getCursorForQueryAsync in MongoError', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: { status: 'active' },
                columns: new Set()
            });

            mockResourceLocatorFactory.createResourceLocator.mockReturnValue({
                getCollectionName: () => 'Patient_4_0_0'
            });

            const originalError = new Error('Connection timeout');
            mockSearchManager.getCursorForQueryAsync.mockRejectedValue(originalError);

            await expect(
                searchBundleOp.searchBundleAsync({
                    requestInfo: mockRequestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient',
                    useAggregationPipeline: false
                })
            ).rejects.toThrow();

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        it('should not audit log for AuditEvent resourceType', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {},
                columns: new Set()
            });

            mockResourceLocatorFactory.createResourceLocator.mockReturnValue({
                getCollectionName: () => 'AuditEvent_4_0_0'
            });

            const mockCursor = {
                getCollection: jest.fn().mockReturnValue('AuditEvent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                setEmpty: jest.fn()
            };

            const mockResources = [
                { _uuid: 'ae-uuid-1', id: 'ae-1' }
            ];

            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: {},
                originalOptions: [{}],
                resources: [],
                total_count: 1,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: mockCursor
            });

            mockSearchManager.readResourcesFromCursorAsync.mockResolvedValue(mockResources);
            mockBundleManager.createRawBundle.mockReturnValue({ resourceType: 'Bundle' });

            await searchBundleOp.searchBundleAsync({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'AuditEvent',
                useAggregationPipeline: false
            });

            // AuditEvent resources should NOT trigger audit logging
            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        it('BUG: cursor undefined (not null) bypasses null check but fails on method calls', async () => {
            // The code checks `if (cursor !== null)` on line 287
            // but if cursor is `undefined`, this check passes and cursor.getCollection() will throw
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {},
                columns: new Set()
            });

            mockResourceLocatorFactory.createResourceLocator.mockReturnValue({
                getCollectionName: () => 'Patient_4_0_0'
            });

            // Return cursor as undefined instead of null
            mockSearchManager.getCursorForQueryAsync.mockResolvedValue({
                columns: new Set(),
                originalQuery: {},
                originalOptions: [{}],
                resources: [],
                total_count: 0,
                indexHint: null,
                cursorBatchSize: 100,
                cursor: undefined  // BUG: undefined passes `!== null` check
            });

            mockBundleManager.createRawBundle.mockReturnValue({ resourceType: 'Bundle' });

            // Line 276: `cursor ? [cursor.getCollection()] : []` handles undefined correctly (falsy)
            // Line 281: `cursor && !useAggregationPipeline && ...` also handles it (falsy)
            // Line 287: `if (cursor !== null)` - BUG: undefined !== null is true!
            // This means the code enters the if block and tries to call logDebug/readResources
            // with an undefined cursor. readResourcesFromCursorAsync receives {cursor: undefined}
            // which could crash if it calls cursor methods.

            // However, the readResourcesFromCursorAsync mock won't crash. Let's verify behavior:
            mockSearchManager.readResourcesFromCursorAsync.mockResolvedValue([]);

            const result = await searchBundleOp.searchBundleAsync({
                requestInfo: mockRequestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient',
                useAggregationPipeline: false
            });

            // BUG CONFIRMED: When cursor is undefined, the code still calls readResourcesFromCursorAsync
            // with {cursor: undefined}, which in production would crash
            expect(mockSearchManager.readResourcesFromCursorAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    cursor: undefined
                })
            );
        });
    });
});
