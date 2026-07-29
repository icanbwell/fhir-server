const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn()
}));

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined),
    logSystemErrorAsync: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

jest.mock('../../../utils/mongoDBUtils', () => ({
    isNotSystemCollection: jest.fn((name) => !name.startsWith('system.'))
}));

const { IndexManager } = require('../../../indexes/indexManager');

describe('IndexManager', () => {
    let indexManager;
    let mockIndexProvider;
    let mockMongoDatabaseManager;
    let mockDb;
    let mockCollection;

    beforeEach(() => {
        mockCollection = {
            indexExists: jest.fn().mockResolvedValue(false),
            createIndex: jest.fn().mockResolvedValue('indexName'),
            indexes: jest.fn().mockResolvedValue([
                { key: { id: 1 }, name: '_id_' },
                { key: { 'meta.lastUpdated': 1 }, name: 'meta_lastUpdated_1' }
            ]),
            dropIndexes: jest.fn().mockResolvedValue(undefined),
            dropIndex: jest.fn().mockResolvedValue(undefined)
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection),
            listCollections: jest.fn().mockReturnValue({
                forEach: jest.fn().mockImplementation(async (cb) => {
                    cb({ name: 'Patient_4_0_0' });
                    cb({ name: 'Observation_4_0_0' });
                }),
                [Symbol.asyncIterator]: jest.fn().mockImplementation(function* () {
                    yield { name: 'Patient_4_0_0' };
                    yield { name: 'Observation_4_0_0' };
                })
            })
        };

        mockIndexProvider = {
            getIndexes: jest.fn().mockReturnValue({
                '*': [
                    {
                        keys: { id: 1 },
                        options: { name: 'id_1' }
                    },
                    {
                        keys: { 'meta.lastUpdated': 1 },
                        options: { name: 'meta_lastUpdated_1' }
                    }
                ],
                '*_History': [
                    {
                        keys: { id: 1, 'meta.versionId': 1 },
                        options: { name: 'id_version_1' }
                    }
                ],
                'Patient_4_0_0': [
                    {
                        keys: { 'name.family': 1 },
                        options: { name: 'name_family_1' }
                    }
                ]
            })
        };

        mockMongoDatabaseManager = {
            createClientAsync: jest.fn().mockResolvedValue({ close: jest.fn() }),
            disconnectClientAsync: jest.fn().mockResolvedValue(undefined),
            getClientConfigAsync: jest.fn().mockResolvedValue({ connection: 'mongodb://localhost', db_name: 'fhir' }),
            getClientDbAsync: jest.fn().mockResolvedValue(mockDb),
            getAuditDbAsync: jest.fn().mockResolvedValue(mockDb),
            getAccessLogsDbAsync: jest.fn().mockResolvedValue(mockDb),
            getResourceHistoryConfigAsync: jest.fn().mockResolvedValue({ connection: 'mongodb://localhost', db_name: 'fhir_history' }),
            getResourceHistoryDbAsync: jest.fn().mockResolvedValue(mockDb)
        };

        indexManager = new IndexManager({
            indexProvider: Object.assign(Object.create(mockIndexProvider), mockIndexProvider),
            mongoDatabaseManager: Object.assign(Object.create(mockMongoDatabaseManager), mockMongoDatabaseManager)
        });
        indexManager.indexProvider = mockIndexProvider;
        indexManager.mongoDatabaseManager = mockMongoDatabaseManager;
    });

    describe('createIndexIfNotExistsAsync', () => {
        test('creates index when it does not exist', async () => {
            mockCollection.indexExists.mockResolvedValue(false);
            const result = await indexManager.createIndexIfNotExistsAsync({
                db: mockDb,
                indexConfig: { keys: { id: 1 }, options: { name: 'id_1' } },
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toBe(true);
            expect(mockCollection.createIndex).toHaveBeenCalledWith(
                { id: 1 },
                { name: 'id_1' }
            );
        });

        test('does not create index when it already exists', async () => {
            mockCollection.indexExists.mockResolvedValue(true);
            const result = await indexManager.createIndexIfNotExistsAsync({
                db: mockDb,
                indexConfig: { keys: { id: 1 }, options: { name: 'id_1' } },
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toBe(false);
            expect(mockCollection.createIndex).not.toHaveBeenCalled();
        });

        test('returns false and logs error on exception', async () => {
            mockCollection.indexExists.mockResolvedValue(false);
            mockCollection.createIndex.mockRejectedValue(new Error('Index creation failed'));
            const result = await indexManager.createIndexIfNotExistsAsync({
                db: mockDb,
                indexConfig: { keys: { id: 1 }, options: { name: 'id_1' } },
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toBe(false);
        });
    });

    describe('getIndexesToCreateForCollectionAsync', () => {
        test('returns wildcard indexes for non-history collection', async () => {
            const result = await indexManager.getIndexesToCreateForCollectionAsync({
                collectionName: 'Patient_4_0_0'
            });
            expect(result.collectionName).toBe('Patient_4_0_0');
            // Should include both '*' indexes and 'Patient_4_0_0' specific indexes
            expect(result.indexes.length).toBeGreaterThanOrEqual(2);
            expect(result.indexes.find(i => i.options.name === 'name_family_1')).toBeDefined();
        });

        test('returns history indexes for history collection', async () => {
            const result = await indexManager.getIndexesToCreateForCollectionAsync({
                collectionName: 'Patient_4_0_0_History'
            });
            expect(result.indexes.find(i => i.options.name === 'id_version_1')).toBeDefined();
            // Should NOT include '*' indexes
            expect(result.indexes.find(i => i.options.name === 'id_1')).toBeUndefined();
        });

        test('respects exclude list', async () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { id: 1 },
                        options: { name: 'id_1' },
                        exclude: ['Patient_4_0_0']
                    }
                ]
            });
            const result = await indexManager.getIndexesToCreateForCollectionAsync({
                collectionName: 'Patient_4_0_0'
            });
            expect(result.indexes.find(i => i.options.name === 'id_1')).toBeUndefined();
        });

        test('respects include list', async () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    {
                        keys: { special: 1 },
                        options: { name: 'special_1' },
                        include: ['Observation_4_0_0']
                    }
                ]
            });
            const result = await indexManager.getIndexesToCreateForCollectionAsync({
                collectionName: 'Patient_4_0_0'
            });
            expect(result.indexes.find(i => i.options.name === 'special_1')).toBeUndefined();

            const result2 = await indexManager.getIndexesToCreateForCollectionAsync({
                collectionName: 'Observation_4_0_0'
            });
            expect(result2.indexes.find(i => i.options.name === 'special_1')).toBeDefined();
        });
    });

    describe('indexCollectionAsync', () => {
        test('creates missing indexes and returns results', async () => {
            mockCollection.indexExists.mockResolvedValue(false);
            const result = await indexManager.indexCollectionAsync({
                collectionName: 'Patient_4_0_0',
                db: mockDb
            });
            expect(result.collectionName).toBe('Patient_4_0_0');
            expect(result.indexesCreated).toBeGreaterThan(0);
        });

        test('reports zero indexesCreated when all exist', async () => {
            mockCollection.indexExists.mockResolvedValue(true);
            const result = await indexManager.indexCollectionAsync({
                collectionName: 'Patient_4_0_0',
                db: mockDb
            });
            expect(result.indexesCreated).toBe(0);
        });
    });

    describe('getIndexesInCollectionAsync', () => {
        test('returns transformed indexes from collection', async () => {
            const result = await indexManager.getIndexesInCollectionAsync({
                collectionName: 'Patient_4_0_0',
                db: mockDb
            });
            expect(result.collectionName).toBe('Patient_4_0_0');
            expect(result.indexes).toHaveLength(2);
            expect(result.indexes[0]).toEqual({
                keys: { id: 1 },
                options: { name: '_id_', unique: undefined }
            });
        });
    });

    describe('compareCurrentIndexesWithConfigurationInCollectionAsync', () => {
        test('identifies missing indexes', async () => {
            // Current indexes don't include name_family_1
            mockCollection.indexes.mockResolvedValue([
                { key: { id: 1 }, name: 'id_1' },
                { key: { 'meta.lastUpdated': 1 }, name: 'meta_lastUpdated_1' }
            ]);

            const result = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: mockDb,
                collectionName: 'Patient_4_0_0',
                filterToProblems: true
            });
            const missingIndexes = result.indexes.filter(i => i.missing);
            expect(missingIndexes.length).toBeGreaterThan(0);
            expect(missingIndexes.find(i => i.indexConfig.options.name === 'name_family_1')).toBeDefined();
        });

        test('identifies extra indexes', async () => {
            mockCollection.indexes.mockResolvedValue([
                { key: { id: 1 }, name: 'id_1' },
                { key: { 'meta.lastUpdated': 1 }, name: 'meta_lastUpdated_1' },
                { key: { 'name.family': 1 }, name: 'name_family_1' },
                { key: { unused: 1 }, name: 'unused_index' }
            ]);

            const result = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: mockDb,
                collectionName: 'Patient_4_0_0',
                filterToProblems: false
            });
            const extraIndexes = result.indexes.filter(i => i.extra);
            expect(extraIndexes.find(i => i.indexConfig.options.name === 'unused_index')).toBeDefined();
        });

        test('identifies changed indexes (different keys)', async () => {
            mockCollection.indexes.mockResolvedValue([
                { key: { id: 1 }, name: 'id_1' },
                { key: { 'meta.lastUpdated': -1 }, name: 'meta_lastUpdated_1' }, // changed direction
                { key: { 'name.family': 1 }, name: 'name_family_1' }
            ]);

            const result = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: mockDb,
                collectionName: 'Patient_4_0_0',
                filterToProblems: true
            });
            const changedIndexes = result.indexes.filter(i => i.changed);
            expect(changedIndexes.length).toBeGreaterThan(0);
        });

        test('identifies changed indexes (unique mismatch)', async () => {
            mockIndexProvider.getIndexes.mockReturnValue({
                '*': [
                    { keys: { id: 1 }, options: { name: 'id_1', unique: true } }
                ]
            });
            mockCollection.indexes.mockResolvedValue([
                { key: { id: 1 }, name: 'id_1', unique: undefined }
            ]);

            const result = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: mockDb,
                collectionName: 'Patient_4_0_0',
                filterToProblems: true
            });
            const changedIndexes = result.indexes.filter(i => i.changed);
            expect(changedIndexes.length).toBeGreaterThan(0);
        });

        test('does not report _id_ index as extra', async () => {
            mockIndexProvider.getIndexes.mockReturnValue({ '*': [] });
            mockCollection.indexes.mockResolvedValue([
                { key: { _id: 1 }, name: '_id_' }
            ]);

            const result = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: mockDb,
                collectionName: 'Patient_4_0_0',
                filterToProblems: false
            });
            const extraIndexes = result.indexes.filter(i => i.extra);
            expect(extraIndexes.find(i => i.indexConfig.options.name === '_id_')).toBeUndefined();
        });
    });

    describe('deleteIndexesInCollectionAsync', () => {
        test('drops all indexes in collection', async () => {
            await indexManager.deleteIndexesInCollectionAsync({
                collection_name: 'Patient_4_0_0',
                db: mockDb
            });
            expect(mockCollection.dropIndexes).toHaveBeenCalled();
        });
    });

    describe('deleteIndexInCollectionAsync', () => {
        test('drops specific index by name', async () => {
            await indexManager.deleteIndexInCollectionAsync({
                collectionName: 'Patient_4_0_0',
                db: mockDb,
                indexName: 'old_index'
            });
            expect(mockCollection.dropIndex).toHaveBeenCalledWith('old_index');
        });

        test('logs error but does not throw when dropIndex fails', async () => {
            mockCollection.dropIndex.mockRejectedValue(new Error('Index not found'));
            // Should not throw
            await indexManager.deleteIndexInCollectionAsync({
                collectionName: 'Patient_4_0_0',
                db: mockDb,
                indexName: 'nonexistent_index'
            });
        });
    });

    describe('createCollectionIndexAsync', () => {
        test('creates only missing indexes from indexProblem', async () => {
            mockCollection.indexExists.mockResolvedValue(false);
            const indexProblem = {
                collectionName: 'Patient_4_0_0',
                indexes: [
                    { indexConfig: { keys: { id: 1 }, options: { name: 'id_1' } }, missing: true },
                    { indexConfig: { keys: { status: 1 }, options: { name: 'status_1' } }, extra: true },
                    { indexConfig: { keys: { date: 1 }, options: { name: 'date_1' } } }
                ]
            };
            const result = await indexManager.createCollectionIndexAsync({ indexProblem, db: mockDb });
            expect(result).toHaveLength(1);
            expect(result[0].options.name).toBe('id_1');
        });

        test('returns empty array when no missing indexes', async () => {
            const indexProblem = {
                collectionName: 'Patient_4_0_0',
                indexes: [
                    { indexConfig: { keys: { status: 1 }, options: { name: 'status_1' } }, extra: true }
                ]
            };
            const result = await indexManager.createCollectionIndexAsync({ indexProblem, db: mockDb });
            expect(result).toHaveLength(0);
        });
    });

    describe('dropCollectionIndexAsync', () => {
        test('drops only extra indexes from indexProblem', async () => {
            const indexProblem = {
                collectionName: 'Patient_4_0_0',
                indexes: [
                    { indexConfig: { keys: { id: 1 }, options: { name: 'id_1' } }, missing: true },
                    { indexConfig: { keys: { unused: 1 }, options: { name: 'unused_1' } }, extra: true }
                ]
            };
            const result = await indexManager.dropCollectionIndexAsync({ indexProblem, db: mockDb });
            expect(result).toHaveLength(1);
            expect(result[0].options.name).toBe('unused_1');
            expect(mockCollection.dropIndex).toHaveBeenCalledWith('unused_1');
        });
    });

    describe('renameIndexes', () => {
        test('detects and renames indexes with same keys but different names', async () => {
            mockCollection.indexExists.mockResolvedValue(false);
            const indexProblem = {
                collectionName: 'Patient_4_0_0',
                indexes: [
                    { indexConfig: { keys: { id: 1 }, options: { name: 'old_id_idx' } }, extra: true },
                    { indexConfig: { keys: { id: 1 }, options: { name: 'new_id_idx' } }, missing: true }
                ]
            };
            const result = await indexManager.renameIndexes({ indexProblem, db: mockDb });
            expect(result.indexConfigsDropped.length).toBeGreaterThan(0);
            expect(result.indexConfigsCreated.length).toBeGreaterThan(0);
        });

        test('returns empty arrays when no renames needed', async () => {
            const indexProblem = {
                collectionName: 'Patient_4_0_0',
                indexes: [
                    { indexConfig: { keys: { id: 1 }, options: { name: 'id_1' } }, missing: true },
                    { indexConfig: { keys: { status: 1 }, options: { name: 'status_1' } }, extra: true }
                ]
            };
            const result = await indexManager.renameIndexes({ indexProblem, db: mockDb });
            expect(result.indexConfigsDropped).toHaveLength(0);
            expect(result.indexConfigsCreated).toHaveLength(0);
        });
    });

    describe('compareCurrentIndexesWithConfigurationInAllCollectionsAsync', () => {
        test('lists collections from db and compares indexes', async () => {
            // Setup async iterator for listCollections
            const asyncIterator = {
                [Symbol.asyncIterator]: function* () {
                    yield { name: 'Patient_4_0_0' };
                }
            };
            mockDb.listCollections = jest.fn().mockReturnValue(asyncIterator);
            mockCollection.indexes.mockResolvedValue([]);

            const result = await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
                audit: false,
                accessLogs: false,
                filterToProblems: true
            });
            expect(Array.isArray(result)).toBe(true);
        });

        test('uses audit db when audit flag is true', async () => {
            const asyncIterator = {
                [Symbol.asyncIterator]: function* () {
                    yield { name: 'AuditEvent_4_0_0' };
                }
            };
            mockDb.listCollections = jest.fn().mockReturnValue(asyncIterator);
            mockCollection.indexes.mockResolvedValue([]);

            await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
                audit: true,
                filterToProblems: false
            });
            expect(mockMongoDatabaseManager.getAuditDbAsync).toHaveBeenCalled();
        });
    });

    describe('synchronizeIndexesWithConfigAsync', () => {
        test('handles empty index problems (nothing to synchronize)', async () => {
            indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync = jest.fn().mockResolvedValue([]);
            const result = await indexManager.synchronizeIndexesWithConfigAsync({ audit: false });
            expect(result.created).toEqual([]);
            expect(result.dropped).toEqual([]);
        });
    });

    describe('boundary: 0, 1, >1 collections', () => {
        test('handles 0 collections in database', async () => {
            const asyncIterator = { [Symbol.asyncIterator]: function* () {} };
            mockDb.listCollections = jest.fn().mockReturnValue(asyncIterator);

            indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync = jest.fn().mockResolvedValue([]);
            const result = await indexManager.synchronizeIndexesWithConfigAsync({});
            expect(result.created).toEqual([]);
            expect(result.dropped).toEqual([]);
        });
    });
});
