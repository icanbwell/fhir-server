const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const globals = require('../../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB} = require('../../../constants');
const {mongoConfig} = require('../../../config');

describe('Missing Index Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    // function delay(time) {
    //     return new Promise(resolve => setTimeout(resolve, time));
    // }

    describe('Missing Index Tests', () => {
        test('no missingIndex after Patient collection is indexed', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;

            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = globals.get(CLIENT_DB);
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
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean}[], collectionName: string}}
             */
            const missingIndexesResult = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: fhirDb, collectionName
            });
            expect(missingIndexesResult.indexes.filter(ia => ia.missing).length).toStrictEqual(0);
        });
        test('missingIndex if Patient collection is missing indexes', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;

            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = globals.get(CLIENT_DB);
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
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean}[], collectionName: string}}
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
        });
        test('missingIndex works for AuditEvent', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;

            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = globals.get(AUDIT_EVENT_CLIENT_DB);
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
             * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean}[], collectionName: string}}
             */
            const missingIndexesResult = await indexManager.compareCurrentIndexesWithConfigurationInCollectionAsync({
                db: auditEventDb, collectionName
            });
            /**
             * @type {IndexConfig[]}
             */
            const indexes = missingIndexesResult.indexes.filter(ia => ia.missing).map(ia => ia.indexConfig);
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
                        '_access.medstar': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'options': {
                        'name': 'helix_auditEvent_recorded_access_medstar'
                    }
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    'keys': {
                        '_access.medstar': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'options': {
                        'name': 'helix_auditEvent_security_access_medstar'
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
        test('no missingIndex after Patient and Practitioner collection is indexed', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;

            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = globals.get(CLIENT_DB);
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
             * @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean}[], collectionName: string}[]}
             */
            const missingIndexes = await indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
                config: mongoConfig
            });
            expect(missingIndexes.length).toStrictEqual(3);
            expect(missingIndexes[0].indexes.filter(ia => ia.missing).length).toStrictEqual(0);
            expect(missingIndexes[1].indexes.filter(ia => ia.missing).length).toStrictEqual(0);
            expect(missingIndexes[2].indexes.filter(ia => ia.missing).length).toStrictEqual(0);
        });

    });
});
