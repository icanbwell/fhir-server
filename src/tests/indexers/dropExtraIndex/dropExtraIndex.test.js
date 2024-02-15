const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { customIndexes } = require('./mockCustomIndexes');
const { IndexProvider } = require('../../../indexes/indexProvider');

class MockIndexProvider extends IndexProvider {
    getIndexes () {
        // noinspection JSValidateTypes
        return customIndexes;
    }
}

describe('Remove Extra Index Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        await createTestRequest((container) => {
            container.register('indexProvider', (c) => new MockIndexProvider({
                configManager: c.configManager
            }));
            return container;
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Remove Extra Index Tests', () => {
        test('no Index is removed after Patient collection is indexed', async () => {
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Patient_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientCollection = fhirDb.collection(collectionName);
            await patientCollection.insertOne({ id: '1', resourceType: 'Patient' });
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName, db: fhirDb
            });
            /**
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}}
             */
            const extraIndexesResult = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: fhirDb, collectionName
            });
            expect(extraIndexesResult.indexes.filter(ia => ia.extra).length).toStrictEqual(0);

            const dropExtraResults = await indexManager.dropExtraIndexesAsync({});

            expect(dropExtraResults.dropped.length).toEqual(0);
        });
        test('Index is remove if Patient collection has extra indexes', async () => {
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Patient_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientCollection = fhirDb.collection(collectionName);
            await patientCollection.insertOne({ id: '1', resourceType: 'Patient' });

            /**
             * @type {import('mongodb').CreateIndexesOptions}
             */
            const options = {
                name: 'meta.source_1'
            };
            /**
             * @type {import('mongodb').IndexSpecification}
             */
            const indexSpec = {
                'meta.source': 1
            };
            const indexResult = await patientCollection.createIndex(indexSpec, options);
            expect(indexResult).toStrictEqual('meta.source_1');
            /**
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}}
             */
            const extraIndexesResult = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: fhirDb, collectionName
            });
            /**
             * @type {IndexConfig[]}
             */
            const indexes = extraIndexesResult.indexes.filter(ia => ia.extra).map(ia => ia.indexConfig);
            /**
             * @type {IndexConfig[]}
             */
            expect(indexes.length).toBe(1);
            expect(indexes[0]).toStrictEqual(
                {
                    keys: {
                        'meta.source': 1
                    },
                    options: {
                        name: 'meta.source_1',
                        unique: undefined
                    }
                }
            );

            const dropExtraResults = await indexManager.dropExtraIndexesAsync({});

            expect(dropExtraResults.dropped.length).toEqual(1);

            const droppedIndexes = dropExtraResults.dropped[0].indexes;

            expect(droppedIndexes.length).toEqual(1);

            expect(droppedIndexes[0]).toStrictEqual(
                {
                    keys: {
                        'meta.source': 1
                    },
                    options: {
                        name: 'meta.source_1',
                        unique: undefined
                    }
                }
            );
        });
    });
});
