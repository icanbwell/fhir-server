const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {customIndexes} = require('./mockCustomIndexes');
const {IndexProvider} = require('../../../indexes/indexProvider');


class MockIndexProvider extends IndexProvider {
    getIndexes() {
        // noinspection JSValidateTypes
        return customIndexes;
    }
}

describe('Add Missing Index Tests', () => {
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

    describe('Add Missing Index Tests', () => {
        test('no Index is added after Patient collection is indexed', async () => {
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
            await patientCollection.insertOne({id: '1', resourceType: 'Patient'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName, db: fhirDb
            });
            /**
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}}
             */
            const missingIndexesResult = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: fhirDb, collectionName
            });
            expect(missingIndexesResult.indexes.filter(ia => ia.missing).length).toStrictEqual(0);

            const addMissingResults = await indexManager.addMissingIndexesAsync({});

            expect(addMissingResults.created.length).toEqual(0);
        });
        test('Index is added if Patient collection is missing indexes', async () => {
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
            await patientCollection.insertOne({id: '1', resourceType: 'Patient'});

            /**
             *
             * @type {import('mongodb').CreateIndexesOptions}
             */
            const options = {
                // unique: true,
                name: 'id_1'
            };
            /**
             * @type {import('mongodb').IndexSpecification}
             */
            const indexSpec = {
                'id': 1
            };
            const indexResult = await patientCollection.createIndex(indexSpec, options);
            expect(indexResult).toStrictEqual('id_1');
            /**
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}}
             */
            const missingIndexesResult = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: fhirDb, collectionName
            });
            /**
             * @type {IndexConfig[]}
             */
            const indexes = missingIndexesResult.indexes.filter(ia => ia.missing).map(ia => ia.indexConfig);
            /**
             * @type {IndexConfig[]}
             */
            const sortedIndexes = indexes.sort((a, b) => (a.options.name > b.options.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(3);
            expect(sortedIndexes[0]).toStrictEqual(
                {
                    keys: {
                        'meta.lastUpdated': 1
                    },
                    options: {
                        name: 'meta.lastUpdated_1'
                    },
                    exclude: [
                        'AuditEvent_4_0_0'
                    ]
                }
            );
            expect(sortedIndexes[1]).toStrictEqual(
                {
                    keys: {
                        'meta.source': 1
                    },
                    options: {
                        name: 'meta.source_1'
                    }
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    keys: {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    options: {
                        name: 'security.system_code_1'
                    }
                }
            );

            const addMissingResults = await indexManager.addMissingIndexesAsync({});

            expect(addMissingResults.created.length).toEqual(1);

            const createdIndexes = addMissingResults.created[0].indexes.sort((a, b) => (a.options.name > b.options.name) ? 1 : -1);

            expect(createdIndexes.length).toEqual(3);

            expect(createdIndexes[0]).toStrictEqual(
                {
                    keys: {
                        'meta.lastUpdated': 1
                    },
                    options: {
                        name: 'meta.lastUpdated_1'
                    },
                    exclude: [
                        'AuditEvent_4_0_0'
                    ]
                }
            );
            expect(createdIndexes[1]).toStrictEqual(
                {
                    keys: {
                        'meta.source': 1
                    },
                    options: {
                        name: 'meta.source_1'
                    }
                }
            );
            expect(createdIndexes[2]).toStrictEqual(
                {
                    keys: {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    options: {
                        name: 'security.system_code_1'
                    }
                }
            );
        });
    });
});
