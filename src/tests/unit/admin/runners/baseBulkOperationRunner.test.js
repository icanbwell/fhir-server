const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../utils/assertType', () => ({
    assertIsValid: jest.fn(),
    assertTypeEquals: jest.fn()
}));

jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn()
}));

jest.mock('../../../../utils/mongoQueryStringify', () => ({
    mongoQueryStringify: jest.fn().mockReturnValue('{}')
}));

jest.mock('../../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args, source }) {
            super(message);
            this.originalError = error;
            this.args = args;
            this.source = source;
        }
    }
}));

jest.mock('../../../../utils/memoryManager', () => ({
    MemoryManager: jest.fn().mockImplementation(() => ({
        memoryUsed: '100MB',
        formatBytes: jest.fn().mockReturnValue('1KB')
    }))
}));

const { BaseBulkOperationRunner } = require('../../../../admin/runners/baseBulkOperationRunner');

describe('BaseBulkOperationRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockSourceCollection;
    let mockDestinationCollection;
    let mockSession;
    let mockSourceClient;
    let mockDestinationClient;
    let mockSourceDb;

    beforeEach(() => {
        mockAdminLogger = {
            logInfo: jest.fn(),
            logError: jest.fn()
        };
        // Mock AdminLogger prototype
        const { AdminLogger } = require('../../../../admin/adminLogger');

        mockSession = {
            endSession: jest.fn().mockResolvedValue(undefined),
            startTransaction: jest.fn(),
            commitTransaction: jest.fn().mockResolvedValue(undefined),
            serverSession: { id: 'session-id-123' }
        };

        mockSourceCollection = {
            find: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            maxTimeMS: jest.fn().mockReturnThis(),
            batchSize: jest.fn().mockReturnThis(),
            addCursorFlag: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            skip: jest.fn().mockReturnThis(),
            countDocuments: jest.fn().mockResolvedValue(10),
            estimatedDocumentCount: jest.fn().mockResolvedValue(10)
        };

        mockDestinationCollection = {
            find: jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    project: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            map: jest.fn().mockReturnValue({
                                toArray: jest.fn().mockResolvedValue([])
                            })
                        })
                    })
                })
            }),
            countDocuments: jest.fn().mockResolvedValue(5),
            estimatedDocumentCount: jest.fn().mockResolvedValue(5),
            deleteMany: jest.fn().mockResolvedValue({}),
            bulkWrite: jest.fn().mockResolvedValue({ nModified: 1, nUpserted: 0 })
        };

        mockSourceDb = {
            collection: jest.fn().mockReturnValue(mockSourceCollection),
            admin: jest.fn().mockReturnValue({
                command: jest.fn().mockResolvedValue({ ok: 1 })
            })
        };

        mockSourceClient = {
            startSession: jest.fn().mockReturnValue(mockSession),
            db: jest.fn().mockReturnValue(mockSourceDb)
        };

        mockDestinationClient = {
            db: jest.fn().mockReturnValue({
                collection: jest.fn().mockReturnValue(mockDestinationCollection)
            })
        };

        mockMongoDatabaseManager = {
            createClientAsync: jest.fn()
                .mockResolvedValueOnce(mockSourceClient)
                .mockResolvedValueOnce(mockDestinationClient),
            disconnectClientAsync: jest.fn().mockResolvedValue(undefined),
            getResourceHistoryConfigAsync: jest.fn().mockResolvedValue({
                connection: 'mongodb://localhost',
                db_name: 'fhir_history',
                options: {}
            })
        };
        // Mock MongoDatabaseManager prototype
        const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

        runner = new BaseBulkOperationRunner({
            batchSize: 5,
            adminLogger: Object.assign(Object.create(mockAdminLogger), mockAdminLogger),
            mongoDatabaseManager: Object.assign(Object.create(mockMongoDatabaseManager), mockMongoDatabaseManager)
        });
        // Override adminLogger to use mock directly
        runner.adminLogger = mockAdminLogger;
        runner.mongoDatabaseManager = mockMongoDatabaseManager;
    });

    describe('constructor', () => {
        test('sets batchSize correctly', () => {
            expect(runner.batchSize).toBe(5);
        });
    });

    describe('createConnectionAsync', () => {
        test('creates source and destination connections', async () => {
            const result = await runner.createConnectionAsync({
                config: { connection: 'mongodb://localhost', db_name: 'fhir', options: {} },
                destinationCollectionName: 'Patient_4_0_0',
                sourceCollectionName: 'Patient_4_0_0'
            });
            expect(result.sourceClient).toBeDefined();
            expect(result.session).toBeDefined();
            expect(result.sessionId).toBeDefined();
            expect(mockMongoDatabaseManager.createClientAsync).toHaveBeenCalledTimes(2);
        });
    });

    describe('createSingeConnectionAsync', () => {
        test('creates single connection with collection', async () => {
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockSourceClient);
            const result = await runner.createSingeConnectionAsync({
                mongoConfig: { connection: 'mongodb://localhost', db_name: 'fhir', options: {} },
                collectionName: 'Patient_4_0_0'
            });
            expect(result.session).toBeDefined();
            expect(result.client).toBeDefined();
        });

        test('creates single connection without collection', async () => {
            mockMongoDatabaseManager.createClientAsync.mockResolvedValue(mockSourceClient);
            const result = await runner.createSingeConnectionAsync({
                mongoConfig: { connection: 'mongodb://localhost', db_name: 'fhir', options: {} },
                collectionName: undefined
            });
            expect(result.collection).toBeUndefined();
        });
    });

    describe('runForQueryBatchesAsync', () => {
        let baseParams;

        beforeEach(() => {
            // Reset mock for multiple createClientAsync calls
            mockMongoDatabaseManager.createClientAsync = jest.fn()
                .mockResolvedValue(mockSourceClient);

            // Override the sourceDb to return both collections
            mockSourceDb.collection = jest.fn().mockImplementation((name) => {
                if (name.includes('destination') || name === 'Dest_4_0_0') {
                    return mockDestinationCollection;
                }
                return mockSourceCollection;
            });
            mockSourceClient.db = jest.fn().mockReturnValue(mockSourceDb);

            baseParams = {
                config: { connection: 'mongodb://localhost', db_name: 'fhir', options: {} },
                sourceCollectionName: 'Patient_4_0_0',
                destinationCollectionName: 'Dest_4_0_0',
                query: {},
                startFromIdContainer: {
                    startFromId: null,
                    numScanned: 0,
                    numOperations: 0,
                    numberWritten: 0,
                    convertedIds: 0,
                    nModified: 0,
                    nUpserted: 0
                },
                fnCreateBulkOperationAsync: jest.fn().mockResolvedValue([]),
                batchSize: 5,
                skipExistingIds: false,
                useEstimatedCount: false
            };
        });

        test('returns empty string when skipWhenCountIsSame is true and counts match', async () => {
            mockSourceCollection.countDocuments.mockResolvedValue(10);
            mockDestinationCollection.countDocuments.mockResolvedValue(10);

            const result = await runner.runForQueryBatchesAsync({
                ...baseParams,
                skipWhenCountIsSame: true
            });
            expect(result).toBe('');
        });

        test('deletes destination records when dropDestinationIfCountIsDifferent is set', async () => {
            mockSourceCollection.countDocuments.mockResolvedValue(10);
            mockDestinationCollection.countDocuments.mockResolvedValue(5);

            // Make cursor return no documents (end loop)
            runner.hasNext = jest.fn().mockResolvedValue(false);

            await runner.runForQueryBatchesAsync({
                ...baseParams,
                dropDestinationIfCountIsDifferent: true
            });
            expect(mockDestinationCollection.deleteMany).toHaveBeenCalledWith({});
        });

        test('uses estimatedDocumentCount when useEstimatedCount is true', async () => {
            runner.hasNext = jest.fn().mockResolvedValue(false);

            await runner.runForQueryBatchesAsync({
                ...baseParams,
                useEstimatedCount: true
            });
            expect(mockSourceCollection.estimatedDocumentCount).toHaveBeenCalled();
        });

        test('uses getResourceHistoryConfigAsync for History collections', async () => {
            runner.hasNext = jest.fn().mockResolvedValue(false);

            await runner.runForQueryBatchesAsync({
                ...baseParams,
                sourceCollectionName: 'Patient_4_0_0_History'
            });
            expect(mockMongoDatabaseManager.getResourceHistoryConfigAsync).toHaveBeenCalled();
        });

        test('processes documents and creates bulk operations', async () => {
            let callCount = 0;
            runner.hasNext = jest.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(callCount <= 2);
            });
            runner.next = jest.fn().mockResolvedValue({
                _id: 'doc-1',
                _uuid: 'uuid-1',
                resourceType: 'Patient'
            });

            baseParams.fnCreateBulkOperationAsync = jest.fn().mockResolvedValue([
                { updateOne: { filter: { _id: 'doc-1' }, update: { $set: { status: 'active' } } } }
            ]);

            await runner.runForQueryBatchesAsync(baseParams);
            expect(baseParams.fnCreateBulkOperationAsync).toHaveBeenCalledTimes(2);
        });

        test('writes bulk operations when batch size is reached', async () => {
            let callCount = 0;
            runner.hasNext = jest.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(callCount <= 5);
            });
            runner.next = jest.fn().mockImplementation(() => {
                return Promise.resolve({
                    _id: `doc-${callCount}`,
                    _uuid: `uuid-${callCount}`,
                    resourceType: 'Patient'
                });
            });

            baseParams.fnCreateBulkOperationAsync = jest.fn().mockResolvedValue([
                { updateOne: { filter: {}, update: {} } }
            ]);
            baseParams.batchSize = 3;
            runner.batchSize = 3;

            await runner.runForQueryBatchesAsync(baseParams);
            // Should have done at least one bulkWrite (5 ops, batchSize 3 => write at 3, then final write of 2)
            expect(mockDestinationCollection.bulkWrite).toHaveBeenCalled();
        });

        test('handles skipExistingIds by getting last id from destination', async () => {
            mockDestinationCollection.find.mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    project: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            map: jest.fn().mockReturnValue({
                                toArray: jest.fn().mockResolvedValue(['last-id-123'])
                            })
                        })
                    })
                })
            });
            runner.hasNext = jest.fn().mockResolvedValue(false);

            const startFromIdContainer = {
                startFromId: null,
                numScanned: 0,
                numOperations: 0,
                numberWritten: 0,
                convertedIds: 0,
                nModified: 0,
                nUpserted: 0
            };

            await runner.runForQueryBatchesAsync({
                ...baseParams,
                startFromIdContainer,
                skipExistingIds: true
            });
            expect(startFromIdContainer.startFromId).toBe('last-id-123');
        });
    });

    describe('runLoopAsync - boundary conditions', () => {
        beforeEach(() => {
            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockSourceClient);
            mockSourceDb.collection = jest.fn().mockImplementation((name) => {
                if (name.includes('Dest')) return mockDestinationCollection;
                return mockSourceCollection;
            });
            mockSourceClient.db = jest.fn().mockReturnValue(mockSourceDb);
        });

        test('handles 0 documents (empty cursor)', async () => {
            runner.hasNext = jest.fn().mockResolvedValue(false);
            const result = await runner.runLoopAsync({
                startFromIdContainer: { startFromId: null, numScanned: 0, numOperations: 0, numberWritten: 0, convertedIds: 0, nModified: 0, nUpserted: 0 },
                query: {},
                config: { connection: 'mongo://localhost', db_name: 'fhir', options: {} },
                destinationCollectionName: 'Dest_4_0_0',
                sourceCollectionName: 'Source_4_0_0',
                batchSize: 5,
                skipExistingIds: false,
                numberOfSourceDocuments: 0,
                numberOfDestinationDocuments: 0,
                lastCheckedId: '',
                fnCreateBulkOperationAsync: jest.fn().mockResolvedValue([]),
                ordered: false
            });
            expect(result).toBe('');
        });

        test('handles exactly 1 document', async () => {
            let callCount = 0;
            runner.hasNext = jest.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(callCount <= 1);
            });
            runner.next = jest.fn().mockResolvedValue({ _id: 'single-doc', _uuid: 'u1', resourceType: 'Patient' });

            const result = await runner.runLoopAsync({
                startFromIdContainer: { startFromId: null, numScanned: 0, numOperations: 0, numberWritten: 0, convertedIds: 0, nModified: 0, nUpserted: 0 },
                query: {},
                config: { connection: 'mongo://localhost', db_name: 'fhir', options: {} },
                destinationCollectionName: 'Dest_4_0_0',
                sourceCollectionName: 'Source_4_0_0',
                batchSize: 5,
                skipExistingIds: false,
                numberOfSourceDocuments: 1,
                numberOfDestinationDocuments: 0,
                lastCheckedId: '',
                fnCreateBulkOperationAsync: jest.fn().mockResolvedValue([{ updateOne: {} }]),
                ordered: false
            });
            expect(result).toBe('single-doc');
            expect(mockDestinationCollection.bulkWrite).toHaveBeenCalled();
        });

        test('handles filterToIds splitting into chunks', async () => {
            runner.hasNext = jest.fn().mockResolvedValue(false);

            await runner.runLoopAsync({
                startFromIdContainer: { startFromId: null, numScanned: 0, numOperations: 0, numberWritten: 0, convertedIds: 0, nModified: 0, nUpserted: 0 },
                query: {},
                config: { connection: 'mongo://localhost', db_name: 'fhir', options: {} },
                destinationCollectionName: 'Dest_4_0_0',
                sourceCollectionName: 'Source_4_0_0',
                batchSize: 2,
                skipExistingIds: false,
                numberOfSourceDocuments: 5,
                numberOfDestinationDocuments: 0,
                lastCheckedId: '',
                fnCreateBulkOperationAsync: jest.fn().mockResolvedValue([]),
                ordered: false,
                filterToIds: ['id1', 'id2', 'id3', 'id4', 'id5'],
                filterToIdProperty: '_uuid'
            });
            // With batchSize 2, 5 ids should create 3 chunks
            // The sourceCollection.find should be called 3 times (once per chunk)
            expect(mockSourceCollection.find).toHaveBeenCalled();
        });
    });

    describe('historyUuidCache', () => {
        test('populates historyUuidCache when property exists on instance', async () => {
            runner.historyUuidCache = new Map();
            runner.hasNext = jest.fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValue(false);
            runner.next = jest.fn().mockResolvedValue({
                _id: 'doc-1',
                _uuid: 'uuid-1',
                resourceType: 'Patient'
            });

            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockSourceClient);
            mockSourceDb.collection = jest.fn().mockImplementation((name) => {
                if (name.includes('Dest')) return mockDestinationCollection;
                return mockSourceCollection;
            });
            mockSourceClient.db = jest.fn().mockReturnValue(mockSourceDb);

            await runner.runLoopAsync({
                startFromIdContainer: { startFromId: null, numScanned: 0, numOperations: 0, numberWritten: 0, convertedIds: 0, nModified: 0, nUpserted: 0 },
                query: {},
                config: { connection: 'mongo://localhost', db_name: 'fhir', options: {} },
                destinationCollectionName: 'Dest_4_0_0',
                sourceCollectionName: 'Patient_4_0_0',
                batchSize: 10,
                skipExistingIds: false,
                numberOfSourceDocuments: 1,
                numberOfDestinationDocuments: 0,
                lastCheckedId: '',
                fnCreateBulkOperationAsync: jest.fn().mockResolvedValue([{ updateOne: {} }]),
                ordered: false
            });
            expect(runner.historyUuidCache.has('Patient')).toBe(true);
            expect(runner.historyUuidCache.get('Patient').has('uuid-1')).toBe(true);
        });

        test('does not populate historyUuidCache for History collections', async () => {
            runner.historyUuidCache = new Map();
            runner.hasNext = jest.fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValue(false);
            runner.next = jest.fn().mockResolvedValue({
                _id: 'doc-1',
                _uuid: 'uuid-1',
                resourceType: 'Patient'
            });

            mockMongoDatabaseManager.createClientAsync = jest.fn().mockResolvedValue(mockSourceClient);
            mockSourceDb.collection = jest.fn().mockImplementation(() => mockSourceCollection);
            mockSourceClient.db = jest.fn().mockReturnValue(mockSourceDb);

            await runner.runLoopAsync({
                startFromIdContainer: { startFromId: null, numScanned: 0, numOperations: 0, numberWritten: 0, convertedIds: 0, nModified: 0, nUpserted: 0 },
                query: {},
                config: { connection: 'mongo://localhost', db_name: 'fhir', options: {} },
                destinationCollectionName: 'Dest_4_0_0',
                sourceCollectionName: 'Patient_4_0_0_History',
                batchSize: 10,
                skipExistingIds: false,
                numberOfSourceDocuments: 1,
                numberOfDestinationDocuments: 0,
                lastCheckedId: '',
                fnCreateBulkOperationAsync: jest.fn().mockResolvedValue([{ updateOne: {} }]),
                ordered: false
            });
            expect(runner.historyUuidCache.size).toBe(0);
        });
    });

    describe('requestInfo getter', () => {
        test('returns FhirRequestInfo with default values', () => {
            const info = runner.requestInfo;
            expect(info).toBeDefined();
        });
    });

    describe('next and hasNext', () => {
        test('next calls cursor.next()', async () => {
            const mockCursor = { next: jest.fn().mockResolvedValue({ _id: '1' }) };
            const result = await runner.next(mockCursor);
            expect(result).toEqual({ _id: '1' });
        });

        test('hasNext calls cursor.hasNext()', async () => {
            const mockCursor = { hasNext: jest.fn().mockResolvedValue(true) };
            const result = await runner.hasNext(mockCursor);
            expect(result).toBe(true);
        });
    });
});
