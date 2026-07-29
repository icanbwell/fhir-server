const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock assertType
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

jest.mock('../../../../utils/mongoQueryStringify', () => ({
    mongoQueryStringify: jest.fn().mockReturnValue('{}')
}));

jest.mock('../../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error }) {
            super(message);
            this.originalError = error;
        }
    }
}));

jest.mock('../../../../utils/memoryManager', () => ({
    MemoryManager: jest.fn().mockImplementation(() => ({
        memoryUsed: '100MB',
        formatBytes: jest.fn().mockReturnValue('1KB')
    }))
}));

const { PartitionAuditEventRunner } = require('../../../../admin/runners/partitionAuditEventRunner');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { IndexManager } = require('../../../../indexes/indexManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const moment = require('moment-timezone');

describe('PartitionAuditEventRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockIndexManager;

    beforeEach(() => {
        mockAdminLogger = Object.create(AdminLogger.prototype);
        mockAdminLogger.logInfo = jest.fn();
        mockAdminLogger.logError = jest.fn();

        mockMongoDatabaseManager = Object.create(MongoDatabaseManager.prototype);
        mockMongoDatabaseManager.createClientAsync = jest.fn();
        mockMongoDatabaseManager.disconnectClientAsync = jest.fn().mockResolvedValue(undefined);
        mockMongoDatabaseManager.getClientConfigAsync = jest.fn().mockResolvedValue({
            connection: 'mongodb://user:pass@localhost:27017',
            db_name: 'fhir',
            options: { maxPoolSize: 10 }
        });
        mockMongoDatabaseManager.getAuditConfigAsync = jest.fn().mockResolvedValue({
            connection: 'mongodb://user:pass@localhost:27017',
            db_name: 'audit',
            options: { maxPoolSize: 10 }
        });

        mockIndexManager = Object.create(IndexManager.prototype);
        mockIndexManager.indexCollectionAsync = jest.fn().mockResolvedValue(undefined);
    });

    function createRunner(overrides = {}) {
        return new PartitionAuditEventRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            recordedAfter: moment('2023-01-01'),
            recordedBefore: moment('2023-03-01'),
            batchSize: 100,
            skipExistingIds: false,
            useAuditDatabase: false,
            dropDestinationCollection: false,
            adminLogger: mockAdminLogger,
            indexManager: mockIndexManager,
            sourceCollection: 'AuditEvent_4_0_0',
            ...overrides
        });
    }

    describe('copyRecordAsync', () => {
        test('creates a replaceOne operation for a valid document', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'client1' },
                        { system: SecurityTagSystem.owner, code: 'owner1' }
                    ]
                }
            };
            const operations = await runner.copyRecordAsync(doc);
            expect(operations).toHaveLength(1);
            expect(operations[0].replaceOne.filter._id).toBe('doc1');
            expect(operations[0].replaceOne.upsert).toBe(true);
            // Should set _access
            expect(doc._access).toEqual({ client1: 1 });
        });

        test('does not overwrite existing _access field', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                _access: { existingClient: 1 },
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'newClient' }
                    ]
                }
            };
            const operations = await runner.copyRecordAsync(doc);
            expect(operations).toHaveLength(1);
            // Existing _access should not be overwritten
            expect(doc._access).toEqual({ existingClient: 1 });
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle doc.meta being null', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                meta: null
            };
            // Should handle null meta gracefully
            const operations = await runner.copyRecordAsync(doc);
            expect(operations).toHaveLength(1);
            expect(operations[0].replaceOne.filter._id).toBe('doc1');
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle doc.meta being undefined', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc2'
                // meta is not defined at all
            };
            // Should handle undefined meta gracefully
            const operations = await runner.copyRecordAsync(doc);
            expect(operations).toHaveLength(1);
            expect(operations[0].replaceOne.filter._id).toBe('doc2');
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle doc.meta.security being undefined', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc3',
                meta: {
                    // security is not defined
                }
            };
            // Should handle undefined security gracefully
            const operations = await runner.copyRecordAsync(doc);
            expect(operations).toHaveLength(1);
            expect(operations[0].replaceOne.filter._id).toBe('doc3');
        });

        test('handles documents with no access codes', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'owner1' }
                    ]
                }
            };
            const operations = await runner.copyRecordAsync(doc);
            expect(operations).toHaveLength(1);
            // _access should NOT be set since there are no access codes
            expect(doc._access).toBeUndefined();
        });
    });

    describe('setAccessIndexRecordAsync', () => {
        test('creates updateOne operation when access codes exist and no _access field', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'client1' },
                        { system: SecurityTagSystem.access, code: 'client2' }
                    ]
                }
            };
            const operations = await runner.setAccessIndexRecordAsync(doc);
            expect(operations).toHaveLength(1);
            expect(operations[0].updateOne.filter._id).toBe('doc1');
            expect(operations[0].updateOne.update.$set._access).toEqual({
                client1: 1,
                client2: 1
            });
        });

        test('returns empty operations when doc already has _access', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                _access: { existingClient: 1 },
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'client1' }
                    ]
                }
            };
            const operations = await runner.setAccessIndexRecordAsync(doc);
            // Since _access already exists, no operations should be created
            expect(operations).toHaveLength(0);
        });

        test('returns empty operations when no access codes', async () => {
            runner = createRunner();
            const doc = {
                _id: 'doc1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'owner1' }
                    ]
                }
            };
            const operations = await runner.setAccessIndexRecordAsync(doc);
            expect(operations).toHaveLength(0);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle doc.meta being undefined in setAccessIndexRecordAsync', async () => {
            runner = createRunner();
            const doc = { _id: 'doc1' };
            // Should return empty operations when meta is undefined
            const operations = await runner.setAccessIndexRecordAsync(doc);
            expect(operations).toHaveLength(0);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle doc.meta.security being undefined in setAccessIndexRecordAsync', async () => {
            runner = createRunner();
            const doc = { _id: 'doc1', meta: {} };
            // Should return empty operations when security is undefined
            const operations = await runner.setAccessIndexRecordAsync(doc);
            expect(operations).toHaveLength(0);
        });
    });

    describe('processAsync', () => {
        test('processes month-by-month in reverse and disconnects client', async () => {
            const mockCollection = {
                countDocuments: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([])
                })
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                listCollections: jest.fn().mockReturnValue({
                    hasNext: jest.fn().mockResolvedValue(false)
                }),
                dropCollection: jest.fn().mockResolvedValue(undefined)
            };
            const mockClient = {
                db: jest.fn().mockReturnValue(mockDb),
                startSession: jest.fn().mockReturnValue({
                    endSession: jest.fn().mockResolvedValue(undefined)
                })
            };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);

            runner = createRunner({
                recordedAfter: moment('2023-01-01'),
                recordedBefore: moment('2023-02-01')
            });

            // Mock init from BaseScriptRunner
            runner.init = jest.fn().mockResolvedValue(undefined);
            runner.createStartFromIdContainer = jest.fn().mockReturnValue({ startFromId: '' });
            runner.startFromIdContainer = { startFromId: '' };
            runner.runForQueryBatchesAsync = jest.fn().mockResolvedValue('done');
            runner.shutdown = jest.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(runner.init).toHaveBeenCalled();
            expect(mockMongoDatabaseManager.disconnectClientAsync).toHaveBeenCalled();
        });

        test('skips processing when no source documents match', async () => {
            const mockCollection = {
                countDocuments: jest.fn().mockResolvedValue(0)
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                listCollections: jest.fn().mockReturnValue({
                    hasNext: jest.fn().mockResolvedValue(false)
                })
            };
            const mockClient = {
                db: jest.fn().mockReturnValue(mockDb)
            };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);

            runner = createRunner({
                recordedAfter: moment('2023-01-01'),
                recordedBefore: moment('2023-02-01')
            });
            runner.init = jest.fn().mockResolvedValue(undefined);
            runner.createStartFromIdContainer = jest.fn().mockReturnValue({ startFromId: '' });
            runner.startFromIdContainer = { startFromId: '' };
            runner.shutdown = jest.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                expect.stringContaining('No documents matched')
            );
        });

        test('drops destination collection when dropDestinationCollection is true', async () => {
            const mockCollection = {
                countDocuments: jest.fn().mockResolvedValue(5),
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([])
                })
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                listCollections: jest.fn().mockReturnValue({
                    hasNext: jest.fn().mockResolvedValue(true)
                }),
                dropCollection: jest.fn().mockResolvedValue(undefined)
            };
            const mockClient = {
                db: jest.fn().mockReturnValue(mockDb)
            };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);

            runner = createRunner({
                recordedAfter: moment('2023-01-01'),
                recordedBefore: moment('2023-02-01'),
                dropDestinationCollection: true
            });
            runner.init = jest.fn().mockResolvedValue(undefined);
            runner.createStartFromIdContainer = jest.fn().mockReturnValue({ startFromId: '' });
            runner.startFromIdContainer = { startFromId: '' };
            runner.runForQueryBatchesAsync = jest.fn().mockResolvedValue('done');
            runner.shutdown = jest.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            expect(mockDb.dropCollection).toHaveBeenCalledWith('AuditEvent_4_0_0');
        });

        test('uses $out pipeline when destination collection does not exist', async () => {
            const mockCollection = {
                countDocuments: jest.fn()
                    .mockResolvedValueOnce(5)  // source count
                    .mockResolvedValueOnce(5), // destination count
                aggregate: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([])
                })
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                listCollections: jest.fn().mockReturnValue({
                    hasNext: jest.fn().mockResolvedValue(false)  // destination doesn't exist
                })
            };
            const mockClient = {
                db: jest.fn().mockReturnValue(mockDb)
            };
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockClient);

            runner = createRunner({
                recordedAfter: moment('2023-01-01'),
                recordedBefore: moment('2023-02-01')
            });
            runner.init = jest.fn().mockResolvedValue(undefined);
            runner.createStartFromIdContainer = jest.fn().mockReturnValue({ startFromId: '' });
            runner.startFromIdContainer = { startFromId: '' };
            runner.runForQueryBatchesAsync = jest.fn().mockResolvedValue('done');
            runner.shutdown = jest.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            // Verify $out was used in pipeline (not $merge)
            const aggregateCall = mockCollection.aggregate.mock.calls[0];
            const pipeline = aggregateCall[0];
            expect(pipeline[pipeline.length - 1]).toHaveProperty('$out');
        });

        test('catches error in inner loop and continues', async () => {
            mockMongoDatabaseManager.createClientAsync.mockRejectedValue(new Error('Connection failed'));

            runner = createRunner({
                recordedAfter: moment('2023-01-01'),
                recordedBefore: moment('2023-02-01')
            });
            runner.init = jest.fn().mockResolvedValue(undefined);
            runner.createStartFromIdContainer = jest.fn().mockReturnValue({ startFromId: '' });
            runner.startFromIdContainer = { startFromId: '' };
            runner.shutdown = jest.fn().mockResolvedValue(undefined);

            // Should not throw - errors are caught
            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalled();
        });
    });
});
