/**
 * Unit tests for MigrateToCloudStorageRunner
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

jest.mock('../../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../../../utils/uid.util', () => ({
    generateUUID: jest.fn().mockReturnValue('generated-uuid-123')
}));

jest.mock('moment-timezone', () => {
    const momentMock = jest.fn(() => ({
        diff: jest.fn().mockReturnValue(0)
    }));
    return momentMock;
});

const { MigrateToCloudStorageRunner } = require('../../../../../operations/history/script/migrateToCloudStorageRunner');
const { MongoDatabaseManager } = require('../../../../../utils/mongoDatabaseManager');
const { CloudStorageClient } = require('../../../../../utils/cloudStorageClient');
const { ConfigManager } = require('../../../../../utils/configManager');
const { logError, logInfo } = require('../../../../../operations/common/logging');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('MigrateToCloudStorageRunner', () => {
    let runner;
    let mockMongoDatabaseManager;
    let mockCloudStorageClient;
    let mockConfigManager;

    beforeEach(() => {
        jest.clearAllMocks();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockCloudStorageClient = createMockInstance(CloudStorageClient);
        mockConfigManager = createMockInstance(ConfigManager);

        // Setup default mock implementations
        mockCloudStorageClient.uploadAsync = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(mockConfigManager, 'historyResourceMongodbFields', {
            get: () => ['_id', 'resource._uuid', 'resource.resourceType'],
            configurable: true
        });

        runner = new MigrateToCloudStorageRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collectionName: 'Patient_4_0_0_History',
            batchSize: 10,
            limit: undefined,
            historyResourceCloudStorageClient: mockCloudStorageClient,
            configManager: mockConfigManager
        });
    });

    describe('constructor', () => {
        test('initializes with correct properties', () => {
            expect(runner.collectionName).toBe('Patient_4_0_0_History');
            expect(runner.batchSize).toBe(10);
            expect(runner.limit).toBeUndefined();
            expect(runner.documentsUploaded).toBe(0);
            expect(runner.documentsUpdated).toBe(0);
            expect(runner.documentsSkipped).toBe(0);
            expect(runner.batchCount).toBe(1);
            expect(runner.lastBatchDocId).toBeNull();
            expect(runner.historyBatch).toEqual([]);
        });

        test('accepts null historyResourceCloudStorageClient', () => {
            const runnerWithNull = new MigrateToCloudStorageRunner({
                mongoDatabaseManager: mockMongoDatabaseManager,
                collectionName: 'Observation_4_0_0_History',
                batchSize: 5,
                limit: 100,
                historyResourceCloudStorageClient: null,
                configManager: mockConfigManager
            });
            expect(runnerWithNull.historyResourceCloudStorageClient).toBeNull();
            expect(runnerWithNull.limit).toBe(100);
        });
    });

    describe('processRecordAsync', () => {
        test('skips record when resource field is missing (old format)', async () => {
            const doc = { _id: 'doc-1', someOldField: 'value' };
            const result = await runner.processRecordAsync(doc);
            expect(result).toBeNull();
            expect(runner.documentsSkipped).toBe(1);
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('is in old format')
            );
        });

        test('skips record when _ref already exists (already migrated)', async () => {
            const doc = {
                _id: 'doc-2',
                resource: { _uuid: 'uuid-2', resourceType: 'Patient' },
                _ref: 'existing-ref'
            };
            const result = await runner.processRecordAsync(doc);
            expect(result).toBeNull();
            expect(runner.documentsSkipped).toBe(1);
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('already migrated')
            );
        });

        test('uploads document to cloud storage and returns replaceOne operation', async () => {
            const doc = {
                _id: 'doc-3',
                resource: { _uuid: 'patient-uuid-3', resourceType: 'Patient', name: 'Test' },
                meta: { versionId: '1' }
            };

            const result = await runner.processRecordAsync(doc);

            expect(mockCloudStorageClient.uploadAsync).toHaveBeenCalledWith({
                filePath: 'Patient_4_0_0_History/patient-uuid-3/generated-uuid-123.json',
                data: expect.any(Buffer)
            });
            expect(result).toBeDefined();
            expect(result.replaceOne).toBeDefined();
            expect(result.replaceOne.filter).toEqual({ _id: 'doc-3' });
            expect(runner.documentsUploaded).toBe(1);
        });

        test('uploaded data is a JSON buffer of the full document', async () => {
            const doc = {
                _id: 'doc-4',
                resource: { _uuid: 'uuid-4', resourceType: 'Observation', code: 'test' }
            };

            await runner.processRecordAsync(doc);

            const uploadCall = mockCloudStorageClient.uploadAsync.mock.calls[0][0];
            const uploadedData = JSON.parse(uploadCall.data.toString());
            expect(uploadedData._id).toBe('doc-4');
            expect(uploadedData.resource._uuid).toBe('uuid-4');
        });

        test('sets _ref in replacement doc to the generated UUID', async () => {
            const { generateUUID } = require('../../../../../utils/uid.util');
            generateUUID.mockReturnValue('new-file-uuid');

            const doc = {
                _id: 'doc-5',
                resource: { _uuid: 'uuid-5', resourceType: 'Patient' }
            };

            const result = await runner.processRecordAsync(doc);
            expect(result.replaceOne.replacement._ref).toBe('new-file-uuid');
        });

        test('skips record when cloud storage upload fails', async () => {
            mockCloudStorageClient.uploadAsync.mockRejectedValue(new Error('Upload timeout'));

            const doc = {
                _id: 'doc-6',
                resource: { _uuid: 'uuid-6', resourceType: 'Patient' }
            };

            const result = await runner.processRecordAsync(doc);
            expect(result).toBeNull();
            expect(runner.documentsSkipped).toBe(1);
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to upload resource')
            );
        });

        test('increments documentsUploaded on success', async () => {
            const doc1 = { _id: 'doc-a', resource: { _uuid: 'uuid-a', resourceType: 'Patient' } };
            const doc2 = { _id: 'doc-b', resource: { _uuid: 'uuid-b', resourceType: 'Patient' } };

            await runner.processRecordAsync(doc1);
            await runner.processRecordAsync(doc2);

            expect(runner.documentsUploaded).toBe(2);
        });
    });

    describe('processBatch', () => {
        test('processes batch and calls bulkWrite with non-null operations', async () => {
            runner.historyBatch = [
                { _id: 'doc-1', resource: { _uuid: 'uuid-1', resourceType: 'Patient' } },
                { _id: 'doc-2' }, // old format, will be null
                { _id: 'doc-3', resource: { _uuid: 'uuid-3', resourceType: 'Patient' } }
            ];
            runner.lastBatchDocId = 'doc-3';

            const mockCollection = {
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 2,
                    upsertedCount: 0
                })
            };
            const mockSession = {};

            await runner.processBatch(mockCollection, mockSession);

            // bulkWrite should be called with filtered (non-null) operations
            expect(mockCollection.bulkWrite).toHaveBeenCalledWith(
                expect.any(Array),
                { session: mockSession }
            );
            const operations = mockCollection.bulkWrite.mock.calls[0][0];
            // 2 valid + 1 old format (null) = 2 operations after filtering
            expect(operations.every(op => op !== null)).toBe(true);
        });

        test('updates documentsUpdated counter', async () => {
            runner.historyBatch = [
                { _id: 'doc-1', resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            runner.lastBatchDocId = 'doc-1';

            const mockCollection = {
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 1,
                    upsertedCount: 0
                })
            };

            await runner.processBatch(mockCollection, {});

            expect(runner.documentsUpdated).toBe(1);
        });

        test('increments batchCount after processing', async () => {
            runner.historyBatch = [
                { _id: 'doc-1', resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            runner.lastBatchDocId = 'doc-1';

            const mockCollection = {
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 1,
                    upsertedCount: 0
                })
            };

            expect(runner.batchCount).toBe(1);
            await runner.processBatch(mockCollection, {});
            expect(runner.batchCount).toBe(2);
        });

        test('clears historyBatch after processing', async () => {
            runner.historyBatch = [
                { _id: 'doc-1', resource: { _uuid: 'uuid-1', resourceType: 'Patient' } }
            ];
            runner.lastBatchDocId = 'doc-1';

            const mockCollection = {
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 1,
                    upsertedCount: 0
                })
            };

            await runner.processBatch(mockCollection, {});
            expect(runner.historyBatch).toEqual([]);
        });

        test('sets lastProcessId to lastBatchDocId', async () => {
            runner.historyBatch = [
                { _id: 'doc-99', resource: { _uuid: 'uuid-99', resourceType: 'Patient' } }
            ];
            runner.lastBatchDocId = 'doc-99';

            const mockCollection = {
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 1,
                    upsertedCount: 0
                })
            };

            await runner.processBatch(mockCollection, {});
            expect(runner.lastProcessId).toBe('doc-99');
        });
    });

    describe('processAsync', () => {
        test('establishes mongo connection and processes documents', async () => {
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jest.fn().mockResolvedValueOnce({
                    _id: 'doc-1',
                    resource: { _uuid: 'uuid-1', resourceType: 'Patient' }
                })
            };

            const mockCollection = {
                find: jest.fn().mockReturnValue({
                    maxTimeMS: jest.fn().mockReturnValue({
                        batchSize: jest.fn().mockReturnValue({
                            addCursorFlag: jest.fn().mockReturnValue(mockCursor)
                        })
                    })
                }),
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 1,
                    upsertedCount: 0
                })
            };

            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                admin: jest.fn().mockReturnValue({
                    command: jest.fn().mockResolvedValue({ ok: 1 })
                })
            };

            const mockSession = {
                serverSession: { id: 'session-123' },
                endSession: jest.fn().mockResolvedValue(undefined)
            };

            const mockClient = {
                startSession: jest.fn().mockReturnValue(mockSession),
                db: jest.fn().mockReturnValue(mockDb)
            };

            mockMongoDatabaseManager.getResourceHistoryConfigAsync = jest.fn().mockResolvedValue({
                db_name: 'fhir_history'
            });
            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockClient);

            await runner.processAsync();

            expect(mockMongoDatabaseManager.getResourceHistoryConfigAsync).toHaveBeenCalled();
            expect(mockMongoDatabaseManager.createClientAsync).toHaveBeenCalled();
            expect(mockClient.db).toHaveBeenCalledWith('fhir_history');
            expect(mockDb.collection).toHaveBeenCalledWith('Patient_4_0_0_History');
            expect(mockSession.endSession).toHaveBeenCalled();
        });

        test('applies limit to cursor when limit is set', async () => {
            const limitRunner = new MigrateToCloudStorageRunner({
                mongoDatabaseManager: mockMongoDatabaseManager,
                collectionName: 'Patient_4_0_0_History',
                batchSize: 10,
                limit: 50,
                historyResourceCloudStorageClient: mockCloudStorageClient,
                configManager: mockConfigManager
            });

            const mockLimitedCursor = {
                hasNext: jest.fn().mockResolvedValue(false),
                next: jest.fn()
            };

            const mockCursorChain = {
                maxTimeMS: jest.fn().mockReturnValue({
                    batchSize: jest.fn().mockReturnValue({
                        addCursorFlag: jest.fn().mockReturnValue({
                            limit: jest.fn().mockReturnValue(mockLimitedCursor)
                        })
                    })
                })
            };

            const mockCollection = {
                find: jest.fn().mockReturnValue(mockCursorChain),
                bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 0, upsertedCount: 0 })
            };

            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                admin: jest.fn().mockReturnValue({
                    command: jest.fn().mockResolvedValue({ ok: 1 })
                })
            };

            const mockSession = {
                serverSession: { id: 'session-456' },
                endSession: jest.fn().mockResolvedValue(undefined)
            };

            const mockClient = {
                startSession: jest.fn().mockReturnValue(mockSession),
                db: jest.fn().mockReturnValue(mockDb)
            };

            mockMongoDatabaseManager.getResourceHistoryConfigAsync = jest.fn().mockResolvedValue({
                db_name: 'fhir_history'
            });
            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockClient);

            await limitRunner.processAsync();

            // Verify limit was called on the cursor chain
            const cursorAfterFlags = mockCursorChain.maxTimeMS.mock.results[0].value
                .batchSize.mock.results[0].value
                .addCursorFlag.mock.results[0].value;
            expect(cursorAfterFlags.limit).toHaveBeenCalledWith(50);
        });

        test('processes remaining batch after cursor is exhausted', async () => {
            // Create a batch of 3 docs but batchSize is 5 so they all go in last partial batch
            const partialRunner = new MigrateToCloudStorageRunner({
                mongoDatabaseManager: mockMongoDatabaseManager,
                collectionName: 'Patient_4_0_0_History',
                batchSize: 5,
                limit: undefined,
                historyResourceCloudStorageClient: mockCloudStorageClient,
                configManager: mockConfigManager
            });

            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jest.fn()
                    .mockResolvedValueOnce({ _id: '1', resource: { _uuid: 'u1', resourceType: 'Patient' } })
                    .mockResolvedValueOnce({ _id: '2', resource: { _uuid: 'u2', resourceType: 'Patient' } })
                    .mockResolvedValueOnce({ _id: '3', resource: { _uuid: 'u3', resourceType: 'Patient' } })
            };

            const mockCollection = {
                find: jest.fn().mockReturnValue({
                    maxTimeMS: jest.fn().mockReturnValue({
                        batchSize: jest.fn().mockReturnValue({
                            addCursorFlag: jest.fn().mockReturnValue(mockCursor)
                        })
                    })
                }),
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 3,
                    upsertedCount: 0
                })
            };

            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                admin: jest.fn().mockReturnValue({
                    command: jest.fn().mockResolvedValue({ ok: 1 })
                })
            };

            const mockSession = {
                serverSession: { id: 'session-789' },
                endSession: jest.fn().mockResolvedValue(undefined)
            };

            const mockClient = {
                startSession: jest.fn().mockReturnValue(mockSession),
                db: jest.fn().mockReturnValue(mockDb)
            };

            mockMongoDatabaseManager.getResourceHistoryConfigAsync = jest.fn().mockResolvedValue({
                db_name: 'fhir_history'
            });
            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockClient);

            await partialRunner.processAsync();

            // The final partial batch should be processed
            expect(mockCollection.bulkWrite).toHaveBeenCalledTimes(1);
        });

        test('handles error in processAsync gracefully (logs error)', async () => {
            mockMongoDatabaseManager.getResourceHistoryConfigAsync = jest.fn().mockRejectedValue(
                new Error('Connection refused')
            );

            // Should not throw - outer catch logs the error
            await runner.processAsync();

            expect(logError).toHaveBeenCalled();
        });

        test('breaks iteration when cursor.next returns null', async () => {
            const mockCursor = {
                hasNext: jest.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true),
                next: jest.fn()
                    .mockResolvedValueOnce(null) // null returned - should break
            };

            const mockCollection = {
                find: jest.fn().mockReturnValue({
                    maxTimeMS: jest.fn().mockReturnValue({
                        batchSize: jest.fn().mockReturnValue({
                            addCursorFlag: jest.fn().mockReturnValue(mockCursor)
                        })
                    })
                }),
                bulkWrite: jest.fn().mockResolvedValue({
                    modifiedCount: 0,
                    upsertedCount: 0
                })
            };

            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                admin: jest.fn().mockReturnValue({
                    command: jest.fn().mockResolvedValue({ ok: 1 })
                })
            };

            const mockSession = {
                serverSession: { id: 'session-null' },
                endSession: jest.fn().mockResolvedValue(undefined)
            };

            const mockClient = {
                startSession: jest.fn().mockReturnValue(mockSession),
                db: jest.fn().mockReturnValue(mockDb)
            };

            mockMongoDatabaseManager.getResourceHistoryConfigAsync = jest.fn().mockResolvedValue({
                db_name: 'fhir_history'
            });
            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockClient);

            await runner.processAsync();

            // Should have logged the error about null document
            expect(logError).toHaveBeenCalledWith('error in getting next document from cursor');
        });
    });
});
