const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { MigrateHistoryToCloudStorageRunner } = require('../../../../admin/runners/migrateHistoryToCloudStorageRunner');
const { CloudStorageClient } = require('../../../../utils/cloudStorageClient');
const { ConfigManager } = require('../../../../utils/configManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../../../constants');

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('MigrateHistoryToCloudStorageRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockCloudStorageClient;
    let mockConfigManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.getResourceHistoryConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_history_db',
            options: {}
        });
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        mockCloudStorageClient = createMockInstance(CloudStorageClient);
        mockCloudStorageClient.uploadAsync = jestGlobal.fn().mockResolvedValue({});

        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'historyResourceMongodbFields', {
            get: () => ['id', 'resource._uuid', 'resource._sourceId', 'resource.meta'],
            configurable: true
        });

        runner = new MigrateHistoryToCloudStorageRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collectionName: 'Patient_4_0_0_History',
            batchSize: 10,
            adminLogger: mockAdminLogger,
            limit: undefined,
            startAfterId: undefined,
            historyResourceCloudStorageClient: mockCloudStorageClient,
            configManager: mockConfigManager
        });
    });

    describe('processRecordAsync', () => {
        test('skips record in old format (no doc.resource)', async () => {
            const doc = { _id: 'old-format-doc', someField: 'value' };

            const result = await runner.processRecordAsync(doc);

            expect(result).toBeNull();
            expect(runner.documentsSkipped).toBe(1);
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('old format')
            );
        });

        test('successfully uploads and returns replaceOne operation', async () => {
            const doc = {
                _id: 'doc-123',
                resource: {
                    _uuid: 'uuid-abc',
                    _sourceId: 'source-1',
                    meta: { lastUpdated: '2023-01-01' }
                }
            };

            const result = await runner.processRecordAsync(doc);

            expect(mockCloudStorageClient.uploadAsync).toHaveBeenCalledTimes(1);
            expect(result).not.toBeNull();
            expect(result.replaceOne).toBeDefined();
            expect(result.replaceOne.filter).toEqual({ _id: 'doc-123' });
            expect(result.replaceOne.replacement[RESOURCE_CLOUD_STORAGE_PATH_KEY]).toBeDefined();
            expect(runner.documentsUploaded).toBe(1);
        });

        test('returns null and increments skipped when upload fails', async () => {
            mockCloudStorageClient.uploadAsync = jestGlobal.fn().mockRejectedValue(new Error('S3 failure'));

            const doc = {
                _id: 'doc-456',
                resource: {
                    _uuid: 'uuid-def',
                    _sourceId: 'source-2',
                    meta: {}
                }
            };

            const result = await runner.processRecordAsync(doc);

            expect(result).toBeNull();
            expect(runner.documentsSkipped).toBe(1);
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to upload')
            );
        });

        test('BUG: when doc.resource._uuid is undefined, filePath contains "undefined" string', async () => {
            // This is a production-reachable scenario when a document has resource object
            // but the _uuid field is missing (e.g., due to data corruption or partial migration)
            const doc = {
                _id: 'doc-789',
                resource: {
                    // _uuid is missing!
                    _sourceId: 'source-3',
                    meta: {}
                }
            };

            const result = await runner.processRecordAsync(doc);

            // The upload succeeds but the file path will contain "undefined"
            // e.g., "Patient_4_0_0_History/undefined/<fileId>.json"
            expect(mockCloudStorageClient.uploadAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: expect.stringContaining('/undefined/')
                })
            );
            // This means the file is saved to an incorrect path
            expect(result).not.toBeNull();
        });

        test('BUG: when historyResourceCloudStorageClient is null, processRecordAsync silently skips instead of uploading', async () => {
            // Constructor allows null for historyResourceCloudStorageClient.
            // In processRecordAsync, calling uploadAsync on null causes a TypeError that is
            // caught by the try/catch, logging an error and returning null (skipping the doc).
            // This means the document is silently never uploaded to cloud storage.
            const runnerWithNullClient = new MigrateHistoryToCloudStorageRunner({
                mongoDatabaseManager: mockMongoDatabaseManager,
                collectionName: 'Patient_4_0_0_History',
                batchSize: 10,
                adminLogger: mockAdminLogger,
                limit: undefined,
                startAfterId: undefined,
                historyResourceCloudStorageClient: null,
                configManager: mockConfigManager
            });

            const doc = {
                _id: 'doc-null-client',
                resource: {
                    _uuid: 'uuid-test',
                    _sourceId: 'source-test',
                    meta: {}
                }
            };

            // The TypeError is caught silently - returns null and increments skipped count
            const result = await runnerWithNullClient.processRecordAsync(doc);
            expect(result).toBeNull();
            expect(runnerWithNullClient.documentsSkipped).toBe(1);
            // Error is logged about the failure but the upload is silently lost
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to upload')
            );
        });
    });

    describe('processBatch', () => {
        test('processBatch should skip bulkWrite when all operations return null (empty batch)', async () => {
            // When all records in a batch are in old format or fail to upload,
            // all processRecordAsync calls return null. After filtering, we get an empty array.
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // The code should check for empty operations and skip the bulkWrite call entirely.
            const mockCollection = {
                bulkWrite: jestGlobal.fn().mockRejectedValue(
                    new Error('Invalid operation, no operations specified')
                )
            };
            const mockSession = {};

            // Setup: all records are old format (no resource property)
            runner.historyBatch = [
                { _id: 'old-1', someField: 'value1' },
                { _id: 'old-2', someField: 'value2' }
            ];
            runner.lastBatchDocId = 'old-2';

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should not throw — empty batch should be skipped gracefully
            await expect(
                runner.processBatch(mockCollection, mockSession)
            ).resolves.not.toThrow();

            // bulkWrite should NOT be called with an empty array
            expect(mockCollection.bulkWrite).not.toHaveBeenCalled();
        });

        test('successfully processes batch with valid operations', async () => {
            const mockCollection = {
                bulkWrite: jestGlobal.fn().mockResolvedValue({
                    modifiedCount: 2,
                    upsertedCount: 0
                })
            };
            const mockSession = {};

            runner.historyBatch = [
                {
                    _id: 'doc-1',
                    resource: { _uuid: 'uuid-1', _sourceId: 'src-1', meta: {} }
                },
                {
                    _id: 'doc-2',
                    resource: { _uuid: 'uuid-2', _sourceId: 'src-2', meta: {} }
                }
            ];
            runner.lastBatchDocId = 'doc-2';

            await runner.processBatch(mockCollection, mockSession);

            expect(mockCollection.bulkWrite).toHaveBeenCalledTimes(1);
            const operations = mockCollection.bulkWrite.mock.calls[0][0];
            expect(operations.length).toBe(2);
            expect(runner.documentsUpdated).toBe(2);
            expect(runner.historyBatch).toEqual([]);
        });
    });

    describe('processAsync', () => {
        test('logs error when collection name does not end with _History', async () => {
            const invalidRunner = new MigrateHistoryToCloudStorageRunner({
                mongoDatabaseManager: mockMongoDatabaseManager,
                collectionName: 'Patient_4_0_0',
                batchSize: 10,
                adminLogger: mockAdminLogger,
                limit: undefined,
                startAfterId: undefined,
                historyResourceCloudStorageClient: mockCloudStorageClient,
                configManager: mockConfigManager
            });

            // Mock the full pipeline to avoid actual DB calls
            const mockSession = {
                serverSession: { id: 'session-123' },
                endSession: jestGlobal.fn().mockResolvedValue(undefined)
            };
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false)
            };
            const mockCollection = {
                find: jestGlobal.fn().mockReturnValue({
                    sort: jestGlobal.fn().mockReturnValue({
                        maxTimeMS: jestGlobal.fn().mockReturnValue({
                            batchSize: jestGlobal.fn().mockReturnValue({
                                addCursorFlag: jestGlobal.fn().mockReturnValue(mockCursor)
                            })
                        })
                    })
                })
            };
            const mockDb = {
                collection: jestGlobal.fn().mockReturnValue(mockCollection),
                admin: jestGlobal.fn().mockReturnValue({ command: jestGlobal.fn() })
            };
            const mockClient = {
                startSession: jestGlobal.fn().mockReturnValue(mockSession),
                db: jestGlobal.fn().mockReturnValue(mockDb)
            };
            mockMongoDatabaseManager.createClientAsync = jestGlobal.fn().mockResolvedValue(mockClient);
            invalidRunner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            await invalidRunner.processAsync();

            // Note: the code logs error but does NOT return early - it continues processing.
            // This is a design issue but not a crash bug.
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('Only History collections are supported')
            );
        });
    });
});
