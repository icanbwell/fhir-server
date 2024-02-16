const {
    commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

const {customIndexes} = require('./mockCustomIndexes');
const {IndexProvider} = require('../../../indexes/indexProvider');
const {logInfo} = require('../../../operations/common/logging');

class MockIndexProvider extends IndexProvider {
    getIndexes() {
        // noinspection JSValidateTypes
        return customIndexes;
    }
}

describe('Synchronize Index Tests', () => {
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

    // function delay(time) {
    //     return new Promise(resolve => setTimeout(resolve, time));
    // }

    describe('Synchronize Index Tests', () => {
        test('no synchronizeIndex after Patient collection is indexed', async () => {
            await createTestRequest();
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
            const synchronizeIndexesResult = await indexManager.synchronizeIndexesWithConfigAsync({
                audit: false
            });
            logInfo('', {created: synchronizeIndexesResult.created});
            expect(synchronizeIndexesResult.created.length).toStrictEqual(0);
            expect(synchronizeIndexesResult.dropped.length).toStrictEqual(0);
        });
        test('synchronizeIndex if Patient collection is missing indexes', async () => {
            await createTestRequest();
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
             * @type {{created: {indexes: IndexConfig[], collectionName: string}[], dropped: {indexes: IndexConfig[], collectionName: string}[]}}
             */
            const synchronizeIndexesResult = await indexManager.synchronizeIndexesWithConfigAsync({
                audit: false
            });
            expect(synchronizeIndexesResult.created.length).toStrictEqual(1);
            expect(synchronizeIndexesResult.dropped.length).toStrictEqual(0);
            /**
             * @type {IndexConfig[]}
             */
            const indexes = synchronizeIndexesResult.created[0].indexes;
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
        });
        test('synchronizeIndex works for AuditEvent', async () => {
            await createTestRequest();
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
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            const collectionName = 'AuditEvent_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const auditEventCollection = auditEventDb.collection(collectionName);
            await auditEventCollection.insertOne({id: '1', resourceType: 'AuditEvent'});
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
            const indexResult = await auditEventCollection.createIndex(indexSpec, options);
            expect(indexResult).toStrictEqual('id_1');
            /**
             * @type {{created: {indexes: IndexConfig[], collectionName: string}[], dropped: {indexes: IndexConfig[], collectionName: string}[]}}
             */
            const synchronizeIndexesResult = await indexManager.synchronizeIndexesWithConfigAsync({
                audit: true
            });
            expect(synchronizeIndexesResult.created.length).toStrictEqual(1);
            expect(synchronizeIndexesResult.dropped.length).toStrictEqual(0);
            /**
             * @type {IndexConfig[]}
             */
            const indexes = synchronizeIndexesResult.created[0].indexes;
            /**
             * @type {IndexConfig[]}
             */
            const sortedIndexes = indexes.sort((a, b) => (a.options.name > b.options.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(6);
            expect(sortedIndexes[0]).toStrictEqual(
                {
                    'keys': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'options': {
                        'name': 'helix_auditEvent_recorded'
                    }
                }
            );
            expect(sortedIndexes[1]).toStrictEqual(
                {
                    'keys': {
                        '_access.client': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'options': {
                        'name': 'helix_auditEvent_recorded_access_client'
                    }
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    'keys': {
                        '_access.client': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'options': {
                        'name': 'helix_auditEvent_security_access_client'
                    }
                }
            );
            expect(sortedIndexes[3]).toStrictEqual(
                {
                    'keys': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'options': {
                        'name': 'helix_audit_event_security'
                    }
                }
            );
            expect(sortedIndexes[4]).toStrictEqual(
                {
                    'keys': {
                        'meta.source': 1
                    },
                    'options': {
                        'name': 'meta.source_1'
                    }
                }
            );
            expect(sortedIndexes[5]).toStrictEqual(
                {
                    'keys': {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    'options': {
                        'name': 'security.system_code_1'
                    }
                }
            );
        });
        test('synchronizeIndex after Patient and Practitioner collection is indexed', async () => {
            await createTestRequest();
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
            const patientCollectionName = 'Patient_4_0_0';
            const patientHistoryCollectionName = 'Patient_4_0_0_History';
            const practitionerCollectionName = 'Practitioner_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientCollection = fhirDb.collection(patientCollectionName);
            await patientCollection.insertOne({id: '1', resourceType: 'Patient'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName: patientCollectionName, db: fhirDb
            });
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientHistoryCollection = fhirDb.collection(patientHistoryCollectionName);
            await patientHistoryCollection.insertOne({id: '1', resourceType: 'Patient'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName: patientHistoryCollectionName, db: fhirDb
            });
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const practitionerCollection = fhirDb.collection(practitionerCollectionName);
            await practitionerCollection.insertOne({id: '1', resourceType: 'Practitioner'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName: practitionerCollectionName, db: fhirDb
            });
            /**
             * @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}[]}
             */
            const synchronizeIndexes = await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
                audit: false
            });
            expect(synchronizeIndexes.length).toStrictEqual(3);
            expect(synchronizeIndexes[0].indexes.filter(ia => ia.missing).length).toStrictEqual(0);
            expect(synchronizeIndexes[1].indexes.filter(ia => ia.missing).length).toStrictEqual(0);
            expect(synchronizeIndexes[2].indexes.filter(ia => ia.missing).length).toStrictEqual(0);
        });
        test('synchronizeIndex after Patient history collection is indexed', async () => {
            await createTestRequest();
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
            const collectionName = 'Patient_4_0_0_History';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientHistoryCollection = fhirDb.collection(collectionName);
            await patientHistoryCollection.insertOne({id: '1', resourceType: 'Patient'});
            const synchronizeIndexesResult = await indexManager.synchronizeIndexesWithConfigAsync({
                audit: false
            });
            expect(synchronizeIndexesResult.created.length).toStrictEqual(1);
            expect(synchronizeIndexesResult.dropped.length).toStrictEqual(0);
            expect(synchronizeIndexesResult.created[0].collectionName).toStrictEqual('Patient_4_0_0_History');
            const indexes = synchronizeIndexesResult.created[0].indexes;
            expect(indexes.length).toStrictEqual(1);
            expect(indexes[0]).toStrictEqual({
                'keys': {
                    'id': 1
                },
                'options': {
                    'name': 'id_1'
                }
            });
        });

        test('synchronizeIndex removes extra Patient index', async () => {
            await createTestRequest();
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
             * @type {IndexConfig}
             */
            const extraIndex = {
                keys: {
                    'id': 1
                },
                options: {
                    // unique: true,
                    name: 'extra_patient_index'
                }
            };
            const indexResult = await patientCollection.createIndex(extraIndex.keys, extraIndex.options);
            expect(indexResult).toStrictEqual('extra_patient_index');
            /**
             * @type {{created: {indexes: IndexConfig[], collectionName: string}[], dropped: {indexes: IndexConfig[], collectionName: string}[]}}
             */
            const synchronizeIndexesResult = await indexManager.synchronizeIndexesWithConfigAsync({
                audit: false
            });
            expect(synchronizeIndexesResult.created.length).toStrictEqual(1);
            expect(synchronizeIndexesResult.dropped.length).toStrictEqual(1);
            /**
             * @type {IndexConfig[]}
             */
            const createdIndexes = synchronizeIndexesResult.created[0].indexes;
            /**
             * @type {IndexConfig[]}
             */
            const sortedIndexes = createdIndexes.sort((a, b) => (a.options.name > b.options.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(4);
            expect(sortedIndexes).toStrictEqual([
                {
                    keys: {
                        'id': 1
                    },
                    options: {
                        name: 'id_1'
                    },
                    exclude: [
                        'AuditEvent_4_0_0'
                    ]
                },
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
                },
                {
                    keys: {
                        'meta.source': 1
                    },
                    options: {
                        name: 'meta.source_1'
                    }
                },
                {
                    keys: {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    options: {
                        name: 'security.system_code_1'
                    }
                }
            ]);

            /**
             * @type {IndexConfig[]}
             */
            const droppedIndexes = synchronizeIndexesResult.dropped[0].indexes;
            expect(droppedIndexes.length).toStrictEqual(1);
            expect(droppedIndexes[0]).toStrictEqual(
                {
                    keys: {
                        'id': 1
                    },
                    options: {
                        name: extraIndex.options.name,
                        unique: undefined
                    }
                }
            );
        });
    });
});
