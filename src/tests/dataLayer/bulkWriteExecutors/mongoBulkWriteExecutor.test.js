'use strict';

const { describe, beforeEach, test, expect, jest } = require('@jest/globals');
const { MongoInvalidArgumentError } = require('mongodb');
const { MongoBulkWriteExecutor } = require('../../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');
const { BulkInsertUpdateEntry } = require('../../../dataLayer/bulkInsertUpdateEntry');
const { MergeResultEntry } = require('../../../operations/common/mergeResultEntry');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { MONGO_ERROR } = require('../../../constants');
const { RethrownError } = require('../../../utils/rethrownError');

// Suppress logging noise in tests
jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));
jest.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemErrorAsync: jest.fn().mockResolvedValue(undefined),
    logTraceSystemEventAsync: jest.fn().mockResolvedValue(undefined)
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal FhirRequestInfo that passes assertTypeEquals
 * @param {string} requestId
 * @returns {FhirRequestInfo}
 */
function makeRequestInfo (requestId = 'test-request-1') {
    return new FhirRequestInfo({
        user: 'test-user',
        scope: 'user/*.read user/*.write access/*.*',
        remoteIpAddress: '127.0.0.1',
        requestId,
        userRequestId: requestId,
        protocol: 'https',
        originalUrl: '/4_0_0/Patient',
        path: '/4_0_0/Patient',
        host: 'localhost',
        body: null,
        accept: 'application/fhir+json',
        isUser: false,
        userType: null,
        personIdFromJwtToken: null,
        masterPersonIdFromJwtToken: null,
        managingOrganizationId: null,
        headers: {},
        method: 'POST',
        contentTypeFromHeader: null,
        alternateUserId: ''
    });
}

/**
 * Build a BulkInsertUpdateEntry for testing
 */
function makeEntry ({
    operationType = 'insertUniqueId',
    isCreateOperation = true,
    isUpdateOperation = false,
    resourceType = 'Patient',
    id = 'patient-1',
    uuid = 'uuid-patient-1',
    sourceAssigningAuthority = 'testAuth',
    skipped = false,
    contextData = null
} = {}) {
    return new BulkInsertUpdateEntry({
        operationType,
        isCreateOperation,
        isUpdateOperation,
        resourceType,
        id,
        uuid,
        sourceAssigningAuthority,
        resource: { id, _uuid: uuid, resourceType },
        operation: { insertOne: { document: { id } } },
        patches: null,
        skipped,
        contextData
    });
}

/**
 * Build the standard mock collection returned by resource locator
 */
function makeMockCollection ({ bulkWriteImpl } = {}) {
    const defaultBulkWrite = jest.fn().mockResolvedValue({
        insertedCount: 1,
        upsertedCount: 1,
        modifiedCount: 0,
        matchedCount: 1,
        hasWriteErrors: () => false,
        getWriteErrors: () => []
    });
    return {
        bulkWrite: bulkWriteImpl || defaultBulkWrite
    };
}

/**
 * Build the executor with injectable overrides
 */
function makeExecutor (overrides = {}) {
    const mockResourceLocator = {
        getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
        getHistoryCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0_History'),
        getCollectionByNameAsync: jest.fn(),
        getAccessLogCollectionAsync: jest.fn()
    };
    const mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
    mockResourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue(
        overrides.resourceLocator || mockResourceLocator
    );

    const mockConfigManager = Object.create(ConfigManager.prototype);
    Object.defineProperty(mockConfigManager, 'handleConcurrency', {
        get: () => overrides.handleConcurrency ?? false
    });

    const mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
    mockPostSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
    mockPostSaveProcessor.needsSyncFor = jest.fn().mockReturnValue(false);

    const mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
    mockPostRequestProcessor.add = jest.fn();

    const executor = new MongoBulkWriteExecutor({
        resourceLocatorFactory: overrides.resourceLocatorFactory || mockResourceLocatorFactory,
        configManager: overrides.configManager || mockConfigManager,
        postSaveProcessor: overrides.postSaveProcessor || mockPostSaveProcessor,
        postRequestProcessor: overrides.postRequestProcessor || mockPostRequestProcessor,
        cloneResource: overrides.cloneResource || (r => ({ ...r })),
        createUpdateManager: overrides.createUpdateManager || jest.fn()
    });

    return {
        executor,
        resourceLocator: overrides.resourceLocator || mockResourceLocator,
        configManager: overrides.configManager || mockConfigManager,
        postSaveProcessor: overrides.postSaveProcessor || mockPostSaveProcessor,
        postRequestProcessor: overrides.postRequestProcessor || mockPostRequestProcessor,
        resourceLocatorFactory: overrides.resourceLocatorFactory || mockResourceLocatorFactory
    };
}

// ---------------------------------------------------------------------------
// Strategy configurations for test.each
// ---------------------------------------------------------------------------
const strategies = [
    {
        name: 'standard clone',
        cloneResource: (r) => ({ ...r }),
        createUpdateManager: jest.fn()
    },
    {
        name: 'deepcopy',
        cloneResource: (r) => JSON.parse(JSON.stringify(r)),
        createUpdateManager: jest.fn()
    }
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MongoBulkWriteExecutor', () => {
    const base_version = '4_0_0';
    let requestInfo;

    beforeEach(() => {
        jest.clearAllMocks();
        requestInfo = makeRequestInfo();
    });

    // 13. canHandle returns true for any resource type
    describe('canHandle', () => {
        test('returns true for any resource type', () => {
            const { executor } = makeExecutor();
            expect(executor.canHandle('Patient')).toBe(true);
            expect(executor.canHandle('Observation')).toBe(true);
            expect(executor.canHandle('AuditEvent')).toBe(true);
            expect(executor.canHandle('SomeCustomType')).toBe(true);
        });
    });

    describe.each(strategies)('with $name strategy', ({ cloneResource, createUpdateManager }) => {
        // 1. Happy path: successful bulk write with inserts and updates
        test('happy path: successful bulk write with inserts and updates', async () => {
            // Arrange
            const insertEntry = makeEntry({
                operationType: 'insertUniqueId',
                isCreateOperation: true,
                isUpdateOperation: false,
                id: 'p1',
                uuid: 'uuid-p1'
            });
            const updateEntry = makeEntry({
                operationType: 'merge',
                isCreateOperation: false,
                isUpdateOperation: true,
                id: 'p2',
                uuid: 'uuid-p2'
            });

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockResolvedValue({
                    insertedCount: 1,
                    upsertedCount: 1,
                    modifiedCount: 1,
                    matchedCount: 2,
                    hasWriteErrors: () => false,
                    getWriteErrors: () => []
                })
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            // Act
            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [insertEntry, updateEntry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert
            expect(result.resourceType).toBe('Patient');
            expect(result.error).toBeNull();
            expect(result.mergeResultEntries).toHaveLength(2);
            expect(result.mergeResultEntries[0].created).toBe(true);
            expect(result.mergeResultEntries[0].updated).toBe(false);
            expect(result.mergeResultEntries[1].created).toBe(false);
            expect(result.mergeResultEntries[1].updated).toBe(true);
            expect(mockCollection.bulkWrite).toHaveBeenCalledTimes(1);
        });

        // 2. Error path: MongoInvalidArgumentError (RESOURCE_SIZE_EXCEEDS)
        test('MongoInvalidArgumentError with RESOURCE_SIZE_EXCEEDS returns error MergeResultEntries', async () => {
            // Arrange
            const entry1 = makeEntry({ id: 'p1', uuid: 'uuid-p1' });
            const entry2 = makeEntry({ id: 'p2', uuid: 'uuid-p2' });

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockRejectedValue(
                    new MongoInvalidArgumentError(MONGO_ERROR.RESOURCE_SIZE_EXCEEDS)
                )
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            // Act
            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry1, entry2],
                requestInfo,
                insertOneHistoryFn: jest.fn()
            });

            // Assert: returns early with error merge result entries (not thrown)
            expect(result.error).toBeInstanceOf(MongoInvalidArgumentError);
            expect(result.mergeResultEntries).toHaveLength(2);
            for (const entry of result.mergeResultEntries) {
                expect(entry).toBeInstanceOf(MergeResultEntry);
                expect(entry.created).toBe(false);
                expect(entry.updated).toBe(false);
                expect(entry.issue).toBeDefined();
                expect(entry.issue.severity).toBe('error');
                expect(entry.issue.diagnostics).toContain('Error in one of the resources of Patient');
            }
        });

        // 3. Error path: bulk write throws non-RESOURCE_SIZE_EXCEEDS error (should rethrow)
        test('non-RESOURCE_SIZE_EXCEEDS error is rethrown', async () => {
            // Arrange
            const entry = makeEntry();
            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockRejectedValue(new Error('some other mongo error'))
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            // Act + Assert
            await expect(executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn()
            })).rejects.toThrow(RethrownError);
        });

        // 3a. Error path: MongoBulkWriteError with code 17419 (BSONObj size invalid)
        test('MongoBulkWriteError with code 17419 returns error MergeResultEntries (not thrown)', async () => {
            const entry1 = makeEntry({ id: 'p1', uuid: 'uuid-p1' });
            const entry2 = makeEntry({ id: 'p2', uuid: 'uuid-p2' });

            // Mimic a top-level MongoServerError shape carrying a numeric code
            const mongoServerError = Object.assign(new Error('BSONObj size is invalid'), {
                code: 17419,
                name: 'MongoServerError'
            });

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockRejectedValue(mongoServerError)
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry1, entry2],
                requestInfo,
                insertOneHistoryFn: jest.fn()
            });

            expect(result.error).toBe(mongoServerError);
            expect(result.mergeResultEntries).toHaveLength(2);
            for (const entry of result.mergeResultEntries) {
                expect(entry).toBeInstanceOf(MergeResultEntry);
                expect(entry.created).toBe(false);
                expect(entry.updated).toBe(false);
                expect(entry.issue.severity).toBe('error');
                expect(entry.issue.diagnostics).toContain('Error in one of the resources of Patient');
            }
        });

        // 3b. Error path: Node RangeError [ERR_OUT_OF_RANGE] from BSON's 17 MiB scratch buffer
        test('Node RangeError from oversized BSON document returns error MergeResultEntries (not thrown)', async () => {
            const entry = makeEntry({ id: 'p1', uuid: 'uuid-p1' });

            // Reproduces the exact error observed in production trace 419ea91b…: a Node
            // RangeError thrown by Buffer.write* when libbson serializes a >16 MiB document.
            const rangeError = Object.assign(
                new RangeError('The value of "offset" is out of range. It must be >= 0 && <= 17825792. Received 17825794'),
                { code: 'ERR_OUT_OF_RANGE' }
            );

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockRejectedValue(rangeError)
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Composition_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            const result = await executor.executeBulkAsync({
                resourceType: 'Composition',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn()
            });

            expect(result.error).toBe(rangeError);
            expect(result.mergeResultEntries).toHaveLength(1);
            const entryResult = result.mergeResultEntries[0];
            expect(entryResult.issue.severity).toBe('error');
            expect(entryResult.issue.diagnostics).toContain('17825792');
        });

        // 3c. Telemetry: outer rethrow preserves the original error class and message
        // (regression for "operationFailed: ... : RethrownError: undefined" audit log line).
        test('non-size error propagates with original message preserved', async () => {
            const entry = makeEntry();
            const originalError = new Error('the underlying mongo failure');

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockRejectedValue(originalError)
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            let caught;
            try {
                await executor.executeBulkAsync({
                    resourceType: 'Patient',
                    base_version,
                    useHistoryCollection: false,
                    operations: [entry],
                    requestInfo,
                    insertOneHistoryFn: jest.fn()
                });
            } catch (e) {
                caught = e;
            }

            expect(caught).toBeInstanceOf(RethrownError);
            // The inner bulkWrite catch wraps with a contextual message;
            // outer catches must NOT re-wrap and lose it.
            expect(caught.message).toBe('mongoBulkWriteExecutor: Error bulkWrite');
            expect(caught.original_error).toBe(originalError);
            // constructor.name is what fhirLoggingManager appends to audit log entries —
            // exactly one wrap, not double-wrapped to a RethrownError of a RethrownError.
            expect(caught.nested).toBe(originalError);
        });

        // 4. Concurrency: insert count mismatch triggers one-by-one fallback
        test('concurrency fallback for inserts when upsertedCount < expected', async () => {
            // Arrange
            const entry1 = makeEntry({
                operationType: 'insertUniqueId',
                isCreateOperation: true,
                isUpdateOperation: false,
                id: 'p1',
                uuid: 'uuid-p1',
                resourceType: 'Patient'
            });
            const entry2 = makeEntry({
                operationType: 'insertUniqueId',
                isCreateOperation: true,
                isUpdateOperation: false,
                id: 'p2',
                uuid: 'uuid-p2',
                resourceType: 'Patient'
            });

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockResolvedValue({
                    insertedCount: 0,
                    upsertedCount: 0, // less than expected 2
                    modifiedCount: 0,
                    matchedCount: 0,
                    hasWriteErrors: () => false,
                    getWriteErrors: () => []
                })
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockConfigManager = Object.create(ConfigManager.prototype);
            Object.defineProperty(mockConfigManager, 'handleConcurrency', { get: () => true });

            const mockUpdateManager = {
                replaceOneAsync: jest.fn().mockResolvedValue({
                    savedResource: { id: 'p1', resourceType: 'Patient' },
                    patches: []
                })
            };
            const localCreateUpdateManager = jest.fn().mockReturnValue(mockUpdateManager);

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                configManager: mockConfigManager,
                cloneResource,
                createUpdateManager: localCreateUpdateManager
            });

            // Act
            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry1, entry2],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert: _updateResourcesOneByOneAsync was called (via createUpdateManager)
            expect(localCreateUpdateManager).toHaveBeenCalledTimes(2);
            expect(mockUpdateManager.replaceOneAsync).toHaveBeenCalledTimes(2);
            expect(result.error).toBeNull();
            expect(result.mergeResultEntries).toHaveLength(2);
        });

        // 5. Concurrency: update count mismatch triggers one-by-one fallback
        test('concurrency fallback for updates when modifiedCount < expected', async () => {
            // Arrange
            const updateEntry1 = makeEntry({
                operationType: 'merge',
                isCreateOperation: false,
                isUpdateOperation: true,
                id: 'p1',
                uuid: 'uuid-p1',
                resourceType: 'Patient'
            });
            const updateEntry2 = makeEntry({
                operationType: 'merge',
                isCreateOperation: false,
                isUpdateOperation: true,
                id: 'p2',
                uuid: 'uuid-p2',
                resourceType: 'Patient'
            });

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockResolvedValue({
                    insertedCount: 0,
                    upsertedCount: 0,
                    modifiedCount: 0, // less than expected 2
                    matchedCount: 0,
                    hasWriteErrors: () => false,
                    getWriteErrors: () => []
                })
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockConfigManager = Object.create(ConfigManager.prototype);
            Object.defineProperty(mockConfigManager, 'handleConcurrency', { get: () => true });

            const mockUpdateManager = {
                replaceOneAsync: jest.fn().mockResolvedValue({
                    savedResource: { id: 'p1', resourceType: 'Patient' },
                    patches: []
                })
            };
            const localCreateUpdateManager = jest.fn().mockReturnValue(mockUpdateManager);

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                configManager: mockConfigManager,
                cloneResource,
                createUpdateManager: localCreateUpdateManager
            });

            // Act
            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [updateEntry1, updateEntry2],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert
            expect(localCreateUpdateManager).toHaveBeenCalledTimes(2);
            expect(mockUpdateManager.replaceOneAsync).toHaveBeenCalledTimes(2);
            expect(result.error).toBeNull();
        });

        // 6. Post-save: history write called for non-AuditEvent resources
        test('insertOneHistoryFn is called for non-AuditEvent resources', async () => {
            // Arrange
            const entry = makeEntry({ resourceType: 'Patient' });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            const insertOneHistoryFn = jest.fn().mockResolvedValue(undefined);

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            // Assert
            expect(insertOneHistoryFn).toHaveBeenCalledTimes(1);
            expect(insertOneHistoryFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo,
                    base_version,
                    resourceType: 'Patient'
                })
            );
        });

        // 7. Post-save: history write skipped for AuditEvent
        test('insertOneHistoryFn is NOT called for AuditEvent resources', async () => {
            // Arrange
            const entry = makeEntry({ resourceType: 'AuditEvent', id: 'ae-1', uuid: 'uuid-ae-1' });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('AuditEvent_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            const insertOneHistoryFn = jest.fn().mockResolvedValue(undefined);

            // Act
            await executor.executeBulkAsync({
                resourceType: 'AuditEvent',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            // Assert
            expect(insertOneHistoryFn).not.toHaveBeenCalled();
        });

        // 8. Post-save: change events fired for non-AuditEvent
        test('change events are fired for non-AuditEvent resources', async () => {
            // Arrange
            const entry = makeEntry({ resourceType: 'Patient' });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
            mockPostSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
            mockPostSaveProcessor.needsSyncFor = jest.fn().mockReturnValue(false);

            const mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
            mockPostRequestProcessor.add = jest.fn();

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                postSaveProcessor: mockPostSaveProcessor,
                postRequestProcessor: mockPostRequestProcessor,
                cloneResource,
                createUpdateManager
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert: postRequestProcessor.add was called (async mode by default)
            expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(1);
            expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: requestInfo.requestId
                })
            );
        });

        // 9. Post-save: change events skipped for AuditEvent
        test('change events are NOT fired for AuditEvent resources', async () => {
            // Arrange
            const entry = makeEntry({ resourceType: 'AuditEvent', id: 'ae-1', uuid: 'uuid-ae-1' });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('AuditEvent_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
            mockPostSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
            mockPostSaveProcessor.needsSyncFor = jest.fn().mockReturnValue(false);

            const mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
            mockPostRequestProcessor.add = jest.fn();

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                postSaveProcessor: mockPostSaveProcessor,
                postRequestProcessor: mockPostRequestProcessor,
                cloneResource,
                createUpdateManager
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'AuditEvent',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert
            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        // 10. Post-save: sync mode for Group (needsSyncFor returns true)
        test('sync mode: afterSaveAsync called directly when needsSyncFor returns true', async () => {
            // Arrange
            const entry = makeEntry({ resourceType: 'Group', id: 'g1', uuid: 'uuid-g1' });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Group_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
            mockPostSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
            mockPostSaveProcessor.needsSyncFor = jest.fn().mockReturnValue(true);

            const mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
            mockPostRequestProcessor.add = jest.fn();

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                postSaveProcessor: mockPostSaveProcessor,
                postRequestProcessor: mockPostRequestProcessor,
                cloneResource,
                createUpdateManager
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Group',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert: afterSaveAsync called directly, not deferred
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledTimes(1);
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: requestInfo.requestId,
                    eventType: 'C',
                    resourceType: 'Group'
                })
            );
            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        // 11. Post-save: async mode for other resources (deferred to postRequestProcessor)
        test('async mode: afterSaveAsync deferred to postRequestProcessor when needsSyncFor is false', async () => {
            // Arrange
            const entry = makeEntry({ resourceType: 'Patient' });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
            mockPostSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
            mockPostSaveProcessor.needsSyncFor = jest.fn().mockReturnValue(false);

            const mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
            mockPostRequestProcessor.add = jest.fn();

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                postSaveProcessor: mockPostSaveProcessor,
                postRequestProcessor: mockPostRequestProcessor,
                cloneResource,
                createUpdateManager
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert: deferred, not called directly
            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
            expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(1);

            // Verify the deferred task calls afterSaveAsync when executed
            const fnTask = mockPostRequestProcessor.add.mock.calls[0][0].fnTask;
            await fnTask();
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledTimes(1);
        });

        // 12. Error path: bulkWriteResult.hasWriteErrors() returns true
        test('hasWriteErrors sets error issue on MergeResultEntry', async () => {
            // Arrange
            const entry = makeEntry({ id: 'p1', uuid: 'uuid-p1' });
            const writeErrorJson = { code: 11000, index: 0, errMsg: 'Duplicate key' };
            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockResolvedValue({
                    insertedCount: 1,
                    upsertedCount: 1,
                    modifiedCount: 0,
                    matchedCount: 1,
                    hasWriteErrors: () => true,
                    getWriteErrors: () => [
                        {
                            code: 11000,
                            index: 0,
                            errMsg: 'Duplicate key',
                            toJSON: () => writeErrorJson
                        }
                    ]
                })
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                cloneResource,
                createUpdateManager
            });

            // Act
            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert
            expect(result.mergeResultEntries).toHaveLength(1);
            const mergeEntry = result.mergeResultEntries[0];
            expect(mergeEntry.created).toBe(false); // hasWriteErrors => not created
            expect(mergeEntry.updated).toBe(false);
            expect(mergeEntry.issue).toBeDefined();
            expect(mergeEntry.issue.severity).toBe('error');
            expect(mergeEntry.issue.code).toBe('exception');
            expect(mergeEntry.issue.diagnostics).toContain('Duplicate key');
        });
    });

    // ----------- Tests that do not vary by strategy -----------

    // _updateResourcesOneByOneAsync: resource saved -> updates entry; resource null -> marks skipped
    describe('_updateResourcesOneByOneAsync', () => {
        test('updates entry resource when replaceOneAsync returns a savedResource', async () => {
            // Arrange
            const insertEntry = makeEntry({
                operationType: 'insertUniqueId',
                isCreateOperation: true,
                isUpdateOperation: false,
                id: 'p1',
                uuid: 'uuid-p1',
                resourceType: 'Patient'
            });

            const savedResource = { id: 'p1', resourceType: 'Patient', meta: { versionId: '2' } };
            const mockUpdateManager = {
                replaceOneAsync: jest.fn().mockResolvedValue({
                    savedResource,
                    patches: [{ op: 'replace', path: '/meta/versionId', value: '2' }]
                })
            };

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockResolvedValue({
                    insertedCount: 0,
                    upsertedCount: 0,
                    modifiedCount: 0,
                    matchedCount: 0,
                    hasWriteErrors: () => false,
                    getWriteErrors: () => []
                })
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockConfigManager = Object.create(ConfigManager.prototype);
            Object.defineProperty(mockConfigManager, 'handleConcurrency', { get: () => true });

            const localCreateUpdateManager = jest.fn().mockReturnValue(mockUpdateManager);

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                configManager: mockConfigManager,
                createUpdateManager: localCreateUpdateManager
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [insertEntry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert: the entry resource was replaced with the saved one
            expect(insertEntry.resource).toEqual(savedResource);
            expect(insertEntry.patches).toEqual([{ op: 'replace', path: '/meta/versionId', value: '2' }]);
        });

        test('marks entry as skipped when replaceOneAsync returns null savedResource', async () => {
            // Arrange
            const insertEntry = makeEntry({
                operationType: 'insertUniqueId',
                isCreateOperation: true,
                isUpdateOperation: false,
                id: 'p1',
                uuid: 'uuid-p1',
                resourceType: 'Patient'
            });

            const mockUpdateManager = {
                replaceOneAsync: jest.fn().mockResolvedValue({
                    savedResource: null,
                    patches: null
                })
            };

            const mockCollection = makeMockCollection({
                bulkWriteImpl: jest.fn().mockResolvedValue({
                    insertedCount: 0,
                    upsertedCount: 0,
                    modifiedCount: 0,
                    matchedCount: 0,
                    hasWriteErrors: () => false,
                    getWriteErrors: () => []
                })
            });

            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockConfigManager = Object.create(ConfigManager.prototype);
            Object.defineProperty(mockConfigManager, 'handleConcurrency', { get: () => true });

            const localCreateUpdateManager = jest.fn().mockReturnValue(mockUpdateManager);

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                configManager: mockConfigManager,
                createUpdateManager: localCreateUpdateManager
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [insertEntry],
                requestInfo,
                insertOneHistoryFn: jest.fn().mockResolvedValue(undefined)
            });

            // Assert: the entry was marked as skipped
            expect(insertEntry.skipped).toBe(true);
        });
    });

    // Outer catch block: logs and wraps prep-phase errors in RethrownError exactly once
    describe('outer catch block', () => {
        test('wraps a raw prep-phase error in RethrownError (preserves upstream contract)', async () => {
            // Arrange: make resourceLocatorFactory.createResourceLocator throw a plain Error
            const originalError = new Error('unexpected locator error');
            const mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
            mockResourceLocatorFactory.createResourceLocator = jest.fn().mockImplementation(() => {
                throw originalError;
            });

            const { executor } = makeExecutor({
                resourceLocatorFactory: mockResourceLocatorFactory
            });

            const entry = makeEntry();

            // Act
            let caught;
            try {
                await executor.executeBulkAsync({
                    resourceType: 'Patient',
                    base_version,
                    useHistoryCollection: false,
                    operations: [entry],
                    requestInfo,
                    insertOneHistoryFn: jest.fn()
                });
            } catch (e) {
                caught = e;
            }

            // Asserts the upstream contract: outer catch must wrap a non-RethrownError so
            // consumers still receive a RethrownError with .original_error, .nested, and
            // .statusCode = 500 set.
            expect(caught).toBeInstanceOf(RethrownError);
            expect(caught.original_error).toBe(originalError);
            expect(caught.nested).toBe(originalError);
            expect(caught.statusCode).toBe(500);
        });

        test('a RethrownError from a lower layer is rethrown without double-wrapping', async () => {
            // Arrange: prep phase throws a RethrownError (simulating a lower-layer wrap).
            const innerCause = new Error('inner cause');
            const preWrapped = new RethrownError({ message: 'inner', error: innerCause });
            const mockResourceLocatorFactory = Object.create(ResourceLocatorFactory.prototype);
            mockResourceLocatorFactory.createResourceLocator = jest.fn().mockImplementation(() => {
                throw preWrapped;
            });

            const { executor } = makeExecutor({
                resourceLocatorFactory: mockResourceLocatorFactory
            });

            // Act
            let caught;
            try {
                await executor.executeBulkAsync({
                    resourceType: 'Patient',
                    base_version,
                    useHistoryCollection: false,
                    operations: [makeEntry()],
                    requestInfo,
                    insertOneHistoryFn: jest.fn()
                });
            } catch (e) {
                caught = e;
            }

            // No double-wrap: the SAME RethrownError instance propagates, message preserved,
            // .original_error not pointing to a wrapping RethrownError.
            expect(caught).toBe(preWrapped);
            expect(caught.message).toBe('inner');
            expect(caught.original_error).toBe(innerCause);
        });
    });

    // Skipped entry: history and change events not fired
    describe('skipped entries', () => {
        test('does not write history or fire change events for skipped entries', async () => {
            // Arrange
            const entry = makeEntry({ skipped: true });
            const mockCollection = makeMockCollection();
            const mockResourceLocator = {
                getCollectionNameForResource: jest.fn().mockReturnValue('Patient_4_0_0'),
                getCollectionByNameAsync: jest.fn().mockResolvedValue(mockCollection)
            };

            const mockPostSaveProcessor = Object.create(PostSaveProcessor.prototype);
            mockPostSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
            mockPostSaveProcessor.needsSyncFor = jest.fn().mockReturnValue(false);

            const mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
            mockPostRequestProcessor.add = jest.fn();

            const insertOneHistoryFn = jest.fn().mockResolvedValue(undefined);

            const { executor } = makeExecutor({
                resourceLocator: mockResourceLocator,
                postSaveProcessor: mockPostSaveProcessor,
                postRequestProcessor: mockPostRequestProcessor
            });

            // Act
            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version,
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            // Assert
            expect(insertOneHistoryFn).not.toHaveBeenCalled();
            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });
    });
});
