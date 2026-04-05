const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { ObjectId } = require('mongodb');
const { HistorySyncJob } = require('../../../consumers/historySync/historySyncJob');
const { HistorySyncTransformer } = require('../../../consumers/historySync/historySyncTransformer');

/**
 * Creates a mock MongoDB cursor that yields documents from the provided array
 */
function createMockCursor(docs) {
    let index = 0;
    return {
        sort: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        batchSize: jest.fn().mockReturnThis(),
        addCursorFlag: jest.fn().mockReturnThis(),
        hasNext: async () => index < docs.length,
        next: async () => docs[index++] || null
    };
}

describe('HistorySyncJob', () => {
    let job;
    let mockMongoDatabaseManager;
    let mockClickHouseClientManager;
    let mockCheckpointManager;
    let mockConfigManager;
    let mockCollection;
    let insertedRows;
    let deletedIds;
    let checkpoints;

    beforeEach(async () => {
        await commonBeforeEach();

        insertedRows = [];
        deletedIds = [];
        checkpoints = [];

        mockCollection = {
            find: jest.fn(),
            deleteMany: jest.fn(async ({ _id }) => {
                const ids = _id.$in || [];
                deletedIds.push(...ids);
                return { deletedCount: ids.length };
            })
        };

        const mockHistoryDb = {
            collection: () => mockCollection,
            admin: () => ({
                command: async () => ({ ok: 1 })
            }),
            listCollections: () => ({
                [Symbol.asyncIterator]: async function* () {
                    yield { name: 'Patient_4_0_0_History' };
                    yield { name: 'Person_4_0_0_History' };
                }
            })
        };

        mockMongoDatabaseManager = {
            getResourceHistoryDbAsync: async () => mockHistoryDb,
            getResourceHistoryConfigAsync: async () => ({ db_name: 'fhir_history' }),
            createClientAsync: async () => ({
                startSession: () => ({
                    serverSession: { id: 'test-session' },
                    endSession: async () => {}
                }),
                db: () => mockHistoryDb
            })
        };

        mockClickHouseClientManager = {
            insertAsync: jest.fn(async ({ values }) => {
                insertedRows.push(...values);
            }),
            queryAsync: jest.fn(async ({ query_params }) => {
                const ids = query_params?.ids || [];
                return [{ cnt: ids.length }];
            })
        };

        mockCheckpointManager = {
            getCheckpointAsync: async () => null,
            updateCheckpointAsync: jest.fn(async (resourceType, lastMongoId, lastUpdated) => {
                checkpoints.push({ resourceType, lastMongoId, lastUpdated });
            })
        };

        mockConfigManager = {
            historySyncBatchSize: 3, // small batch for testing
            historySyncMaxRetries: 3
        };

        job = new HistorySyncJob({
            mongoDatabaseManager: mockMongoDatabaseManager,
            clickHouseClientManager: mockClickHouseClientManager,
            checkpointManager: mockCheckpointManager,
            historySyncTransformer: new HistorySyncTransformer(),
            configManager: mockConfigManager
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    function createHistoryDoc(index) {
        const oid = new ObjectId();
        return {
            _id: oid,
            id: `uuid-${index}`,
            resource: {
                resourceType: 'Patient',
                id: `patient-${index}`,
                meta: {
                    versionId: '1',
                    lastUpdated: `2025-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
                }
            },
            request: { id: `req-${index}`, method: 'POST', url: `/Patient/patient-${index}` }
        };
    }

    test('should process a single batch of documents', async () => {
        const docs = [createHistoryDoc(0), createHistoryDoc(1)];
        mockCollection.find = jest.fn(() => createMockCursor(docs));

        await job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' });

        expect(insertedRows).toHaveLength(2);
        expect(insertedRows[0].resource_type).toBe('Patient');
        expect(insertedRows[1].resource_type).toBe('Patient');
        expect(deletedIds).toHaveLength(2);
        expect(checkpoints).toHaveLength(1);
    });

    test('should process multiple batches', async () => {
        // Batch size is 3, so 5 docs = 2 batches (3 + 2)
        const docs = Array.from({ length: 5 }, (_, i) => createHistoryDoc(i));
        mockCollection.find = jest.fn(() => createMockCursor(docs));

        await job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' });

        expect(insertedRows).toHaveLength(5);
        expect(deletedIds).toHaveLength(5);
        expect(checkpoints).toHaveLength(2); // one per batch
    });

    test('should skip malformed documents', async () => {
        const validDoc = createHistoryDoc(0);
        const malformedDoc = { _id: new ObjectId(), id: 'bad' }; // no resource
        const anotherValid = createHistoryDoc(2);
        mockCollection.find = jest.fn(() => createMockCursor([validDoc, malformedDoc, anotherValid]));

        await job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' });

        // 2 valid + 1 malformed skipped, but all 3 mongo _ids tracked for deletion
        expect(insertedRows).toHaveLength(2);
        expect(checkpoints).toHaveLength(1);
    });

    test('should resolve all resource types when not specified', async () => {
        const docs = [createHistoryDoc(0)];
        mockCollection.find = jest.fn(() => createMockCursor(docs));

        await job.executeAsync({ jobId: 'test-job' });

        // Should process Patient and Person (from listCollections mock)
        expect(mockCollection.find).toHaveBeenCalledTimes(2);
    });

    test('should throw when ClickHouse insert fails after retries', async () => {
        const docs = [createHistoryDoc(0)];
        mockCollection.find = jest.fn(() => createMockCursor(docs));
        mockClickHouseClientManager.insertAsync = jest.fn(async () => {
            throw new Error('ClickHouse unavailable');
        });

        await expect(
            job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' })
        ).rejects.toThrow('ClickHouse insert failed after 3 attempts');

        expect(deletedIds).toHaveLength(0); // no deletes on failure
        expect(checkpoints).toHaveLength(0); // no checkpoint on failure
    });

    test('should continue when MongoDB delete fails', async () => {
        const docs = [createHistoryDoc(0)];
        mockCollection.find = jest.fn(() => createMockCursor(docs));
        mockCollection.deleteMany = jest.fn(async () => {
            throw new Error('MongoDB delete failed');
        });

        // Should not throw — delete failure is non-fatal
        await job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' });

        expect(insertedRows).toHaveLength(1);
        expect(checkpoints).toHaveLength(1); // checkpoint still updated
    });

    test('should stop processing when shuttingDown is set', async () => {
        const docs = Array.from({ length: 10 }, (_, i) => createHistoryDoc(i));
        mockCollection.find = jest.fn(() => createMockCursor(docs));

        // Set shutting down after first batch
        const originalProcessBatch = job._processBatchAsync.bind(job);
        let batchCount = 0;
        job._processBatchAsync = async (params) => {
            batchCount++;
            await originalProcessBatch(params);
            if (batchCount >= 1) {
                job.shuttingDown = true;
            }
        };

        await job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' });

        // Should have processed only the first batch (3 docs with batchSize=3)
        expect(insertedRows).toHaveLength(3);
    });

    test('should use checkpoint when resuming', async () => {
        const checkpointMongoId = new ObjectId().toString();
        mockCheckpointManager.getCheckpointAsync = async () => ({
            lastMongoId: checkpointMongoId
        });

        const docs = [createHistoryDoc(0)];
        mockCollection.find = jest.fn((query) => {
            // Verify query uses checkpoint
            expect(query._id.$gt.toString()).toBe(checkpointMongoId);
            return createMockCursor(docs);
        });

        await job.executeAsync({ jobId: 'test-job', resourceType: 'Patient' });

        expect(insertedRows).toHaveLength(1);
    });
});
