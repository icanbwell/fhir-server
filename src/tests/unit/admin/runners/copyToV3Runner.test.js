const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

// Mock assertType so Object.create(prototype) passes
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));

jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../../config', () => ({
    mongoConfig: {
        connection: 'mongodb://user:pass@localhost:27017',
        db_name: 'fhir',
        options: { maxPoolSize: 10 }
    }
}));

jest.mock('../../../../utils/mongoDBUtils', () => ({
    isNotSystemCollection: jest.fn().mockReturnValue(true)
}));

const { CopyToV3Runner } = require('../../../../admin/runners/copyToV3Runner');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const moment = require('moment-timezone');

describe('CopyToV3Runner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };

        mockAdminLogger = Object.create(AdminLogger.prototype);
        mockAdminLogger.logInfo = jest.fn();
        mockAdminLogger.logError = jest.fn();

        mockMongoDatabaseManager = Object.create(MongoDatabaseManager.prototype);
        mockMongoDatabaseManager.createClientAsync = jest.fn();
        mockMongoDatabaseManager.disconnectClientAsync = jest.fn().mockResolvedValue(undefined);

        process.env.V3_MONGO_URL = 'mongodb+srv://cluster.example.com';
        process.env.V3_MONGO_USERNAME = 'testuser';
        process.env.V3_MONGO_PASSWORD = 'testpass';
        process.env.V3_DB_NAME = 'fhir_v3';
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    function createRunner(overrides = {}) {
        return new CopyToV3Runner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            updatedAfter: moment('2023-01-01'),
            batchSize: 100,
            concurrentRunners: 2,
            _idAbove: undefined,
            collections: undefined,
            startWithCollection: undefined,
            skipHistoryCollections: false,
            adminLogger: mockAdminLogger,
            ...overrides
        });
    }

    describe('getV3ClusterConfig', () => {
        test('constructs v3 cluster config with env vars', () => {
            runner = createRunner();
            const config = runner.getV3ClusterConfig();
            expect(config.db_name).toBe('fhir_v3');
            expect(config.connection).toContain('testuser');
            expect(config.connection).toContain('testpass');
        });

        test('defaults db_name to fhir when V3_DB_NAME is not set', () => {
            delete process.env.V3_DB_NAME;
            runner = createRunner();
            const config = runner.getV3ClusterConfig();
            expect(config.db_name).toBe('fhir');
        });

        test('BUG: crashes with TypeError when V3_MONGO_URL is undefined', () => {
            delete process.env.V3_MONGO_URL;
            runner = createRunner();
            // V3_MONGO_URL is undefined, calling .replace on undefined throws TypeError
            expect(() => runner.getV3ClusterConfig()).toThrow(TypeError);
        });
    });

    describe('getListOfCollections', () => {
        test('filters out non-collection types', () => {
            runner = createRunner();
            const collections = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'myView', type: 'view' },
                { name: 'Observation_4_0_0', type: 'collection' }
            ];
            const result = runner.getListOfCollections(collections);
            expect(result).toEqual(['Patient_4_0_0', 'Observation_4_0_0']);
        });

        test('filters to only specified collections', () => {
            runner = createRunner({ collections: ['Patient_4_0_0'] });
            const collections = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'Observation_4_0_0', type: 'collection' }
            ];
            const result = runner.getListOfCollections(collections);
            expect(result).toEqual(['Patient_4_0_0']);
        });

        test('skips history collections when skipHistoryCollections is true', () => {
            runner = createRunner({ skipHistoryCollections: true });
            const collections = [
                { name: 'Patient_4_0_0', type: 'collection' },
                { name: 'Patient_4_0_0_History', type: 'collection' }
            ];
            const result = runner.getListOfCollections(collections);
            expect(result).toEqual(['Patient_4_0_0']);
        });
    });

    describe('v3BulkWrite', () => {
        test('returns counts from successful bulk write', async () => {
            runner = createRunner();
            const mockCollection = {
                bulkWrite: jest.fn().mockResolvedValue({
                    nModified: 5,
                    nUpserted: 3,
                    nMatched: 8
                })
            };
            const operations = [
                { updateOne: { filter: { _id: 'id1' }, update: { $set: {} }, upsert: true } },
                { updateOne: { filter: { _id: 'id2' }, update: { $set: {} }, upsert: true } }
            ];
            const result = await runner.v3BulkWrite('Patient_4_0_0', mockCollection, operations);
            expect(result.totalDocumentUpdatedCount).toBe(5);
            expect(result.totalDocumentCreatedCount).toBe(3);
            expect(result.totalDocumentHavingSameDataCount).toBe(3); // nMatched - nModified = 8 - 5
            expect(result.lastProcessedId).toBe('id2');
        });

        test('logs error and returns zero counts on bulk write failure', async () => {
            runner = createRunner();
            const mockCollection = {
                bulkWrite: jest.fn().mockRejectedValue(new Error('Write failed'))
            };
            const operations = [
                { updateOne: { filter: { _id: 'id1' }, update: { $set: {} }, upsert: true } }
            ];
            const result = await runner.v3BulkWrite('Patient_4_0_0', mockCollection, operations);
            expect(result.totalDocumentUpdatedCount).toBe(0);
            expect(result.totalDocumentCreatedCount).toBe(0);
            expect(result.lastProcessedId).toBeNull();
            expect(mockAdminLogger.logError).toHaveBeenCalled();
        });
    });

    describe('processAsync', () => {
        test('returns early if _idAbove is set without a single collection', async () => {
            runner = createRunner({
                _idAbove: 'someId',
                collections: ['col1', 'col2']  // multiple collections
            });
            await runner.processAsync();
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('To support _idAbove')
            );
            expect(mockMongoDatabaseManager.createClientAsync).not.toHaveBeenCalled();
        });

        test('returns early if _idAbove is set without collections', async () => {
            runner = createRunner({
                _idAbove: 'someId',
                collections: undefined
            });
            await runner.processAsync();
            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('To support _idAbove')
            );
        });

        test('BUG: readBatchSize is undefined in cursor options (uses this.readBatchSize instead of this.batchSize)', async () => {
            // The constructor assigns this.batchSize but line 267 uses this.readBatchSize
            // which is never set, so cursorOptions.batchSize will be undefined
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false)
            };
            const mockLiveCollection = {
                countDocuments: jest.fn().mockResolvedValue(0),
                find: jest.fn().mockReturnValue(mockCursor)
            };
            const mockV3Collection = {
                bulkWrite: jest.fn().mockResolvedValue({ nModified: 0, nUpserted: 0, nMatched: 0 })
            };
            const mockDb = {
                collection: jest.fn().mockImplementation((name) => {
                    return mockLiveCollection;
                }),
                listCollections: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([
                        { name: 'Patient_4_0_0', type: 'collection' }
                    ])
                })
            };
            const mockClient = {
                db: jest.fn().mockReturnValue(mockDb)
            };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);

            runner = createRunner({ batchSize: 500 });
            await runner.processAsync();

            // Verify that the cursor was called with batchSize option
            const findCall = mockLiveCollection.find.mock.calls[0];
            if (findCall) {
                const cursorOptions = findCall[1];
                // BUG: this.readBatchSize is undefined because constructor uses 'batchSize' not 'readBatchSize'
                expect(cursorOptions.batchSize).toBeUndefined();
            }
        });

        test('disconnects both clients even when processing throws', async () => {
            const mockClient = {
                db: jest.fn().mockImplementation(() => {
                    throw new Error('DB error');
                })
            };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);

            runner = createRunner();
            await runner.processAsync();

            // Should still disconnect both clients in finally block
            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledTimes(2);
            expect(mockAdminLogger.logError).toHaveBeenCalled();
        });

        test('disconnects clients even if one was never assigned (undefined)', async () => {
            // First createClientAsync succeeds, second throws
            const mockClient = { db: jest.fn() };
            mockMongoDatabaseManager.createClientAsync
                .mockResolvedValueOnce(mockClient)
                .mockRejectedValueOnce(new Error('Connection refused'));

            runner = createRunner();
            await runner.processAsync();

            // liveClient is undefined because it threw, disconnectClientAsync should be called with undefined
            // The code in disconnectClientAsync handles this with `if (client)` guard
            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalledTimes(2);
        });
    });
});
