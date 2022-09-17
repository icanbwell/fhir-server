const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const globals = require('../../../globals');
const {CLIENT_DB} = require('../../../constants');

describe('Create Index Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

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
            patientCollection.insertOne({id: '1', resourceType: 'Patient'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: fhirDb
            });
            // check that indexes were created properly
            /**
             * @type {Object[]}
             */
            const indexes = await patientCollection.indexes();
            expect(indexes.length).toBe(5);
            expect(indexes[0]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        '_id': 1
                    },
                    'name': '_id_'
                }
            );
            expect(indexes[1]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'id': 1
                    },
                    'name': 'id_1',
                    'unique': true
                }
            );
            expect(indexes[2]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.lastUpdated': 1
                    },
                    'name': 'meta.lastUpdated_1'
                }
            );
            expect(indexes[3]).toStrictEqual(
                {
                    'v': 2,
                    'key': {
                        'meta.source': 1
                    },
                    'name': 'meta.source_1'
                }
            );
            expect(indexes[4]).toStrictEqual(
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
