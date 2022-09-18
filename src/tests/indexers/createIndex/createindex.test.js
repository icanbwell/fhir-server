const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const globals = require('../../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB} = require('../../../constants');
const {Partitioner} = require('../../../partitioners/partitioner');

describe('Create Index Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    // function delay(time) {
    //     return new Promise(resolve => setTimeout(resolve, time));
    // }

    describe('CreateIndex Tests', () => {
        test('createIndex works for Patient', async () => {
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
                collectionName,
                db: fhirDb
            });
            // await delay(3000); // sleep so indexes are done
            // check that indexes were created properly
            /**
             * @type {Object[]}
             */
            const indexes = await patientCollection.indexes();
            const sortedIndexes = indexes.sort((a, b) => (a.name > b.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(5);
            expect(sortedIndexes[0]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_id': 1
                    },
                    'name': '_id_'
                }
            );
            expect(sortedIndexes[1]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'id': 1
                    },
                    'name': 'id_1'
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.lastUpdated': 1
                    },
                    'name': 'meta.lastUpdated_1'
                }
            );
            expect(sortedIndexes[3]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.source': 1
                    },
                    'name': 'meta.source_1'
                }
            );
            expect(sortedIndexes[4]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    'name': 'security.system_code_1'
                }
            );
        });
        test('createIndex works for AuditEvent', async () => {
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
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: auditEventDb
            });
            // check that indexes were created properly
            /**
             * @type {Object[]}
             */
            const indexes = await auditEventCollection.indexes();
            const sortedIndexes = indexes.sort((a, b) => (a.name > b.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(8);
            expect(sortedIndexes[0]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_id': 1
                    },
                    'name': '_id_'
                }
            );
            expect(sortedIndexes[1]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'name': 'helix_auditEvent_recorded'
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_access.medstar': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'name': 'helix_auditEvent_recorded_access_medstar'
                }
            );
            expect(sortedIndexes[3]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_access.medstar': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'name': 'helix_auditEvent_security_access_medstar'
                }
            );
            expect(sortedIndexes[4]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'name': 'helix_audit_event_security'
                }
            );
            expect(sortedIndexes[5]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'id': 1
                    },
                    'name': 'id_1',
                    // 'unique': true
                }
            );
            expect(sortedIndexes[6]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.source': 1
                    },
                    'name': 'meta.source_1'
                }
            );
            expect(sortedIndexes[7]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    'name': 'security.system_code_1'
                }
            );
        });
        test('createIndex works for AuditEvent partitioned table', async () => {
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
            const collectionName = Partitioner.getPartitionNameFromYearMonth(
                {
                    fieldValue: (new Date()).toString(),
                    resourceWithBaseVersion: 'AuditEvent_4_0_0'
                }
            );
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const auditEventCollection = auditEventDb.collection(collectionName);
            await auditEventCollection.insertOne({id: '1', resourceType: 'AuditEvent'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: auditEventDb
            });
            // check that indexes were created properly
            /**
             * @type {{v:number,key:Object, name:string, unique:boolean|undefined}[]}
             */
            const indexes = await auditEventCollection.indexes();
            const sortedIndexes = indexes.sort((a, b) => (a.name > b.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(8);
            expect(sortedIndexes[0]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_id': 1
                    },
                    'name': '_id_'
                }
            );
            expect(sortedIndexes[1]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'name': 'helix_auditEvent_recorded'
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_access.medstar': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'name': 'helix_auditEvent_recorded_access_medstar'
                }
            );
            expect(sortedIndexes[3]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_access.medstar': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'name': 'helix_auditEvent_security_access_medstar'
                }
            );
            expect(sortedIndexes[4]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'name': 'helix_audit_event_security'
                }
            );
            expect(sortedIndexes[5]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'id': 1
                    },
                    'name': 'id_1',
                    // 'unique': true
                }
            );
            expect(sortedIndexes[6]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.source': 1
                    },
                    'name': 'meta.source_1'
                }
            );
            expect(sortedIndexes[7]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    'name': 'security.system_code_1'
                }
            );
        });
        test('createIndex works for AuditEvent twice', async () => {
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
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: auditEventDb
            });
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: auditEventDb
            });
            // check that indexes were created properly
            /**
             * @type {Object[]}
             */
            const indexes = await auditEventCollection.indexes();
            const sortedIndexes = indexes.sort((a, b) => (a.name > b.name) ? 1 : -1);
            expect(sortedIndexes.length).toBe(8);
            expect(sortedIndexes[0]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_id': 1
                    },
                    'name': '_id_'
                }
            );
            expect(sortedIndexes[1]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'name': 'helix_auditEvent_recorded'
                }
            );
            expect(sortedIndexes[2]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_access.medstar': 1,
                        'id': 1,
                        'recorded': 1
                    },
                    'name': 'helix_auditEvent_recorded_access_medstar'
                }
            );
            expect(sortedIndexes[3]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_access.medstar': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'name': 'helix_auditEvent_security_access_medstar'
                }
            );
            expect(sortedIndexes[4]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1,
                        'id': 1,
                        'meta.lastUpdated': 1
                    },
                    'name': 'helix_audit_event_security'
                }
            );
            expect(sortedIndexes[5]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'id': 1
                    },
                    'name': 'id_1',
                    // 'unique': true
                }
            );
            expect(sortedIndexes[6]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.source': 1
                    },
                    'name': 'meta.source_1'
                }
            );
            expect(sortedIndexes[7]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.security.system': 1,
                        'meta.security.code': 1
                    },
                    'name': 'security.system_code_1'
                }
            );
        });
    });
});
