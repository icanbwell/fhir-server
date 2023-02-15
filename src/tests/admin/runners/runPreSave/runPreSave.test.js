// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3_with_uuid_but_no_identifier.json');
const patient4Resource = require('./fixtures/Patient/patient4_with_all_fields_but_sourceAssigningAuthority.json');
const patient5Resource = require('./fixtures/Patient/patient5_with_all_fields.json');
const patient6Resource = require('./fixtures/Patient/patient6_newer_than_threshold.json');
const patient7Resource = require('./fixtures/Patient/patient7_id_is_uuid.json');

// expected
const expectedPatient1InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_1_in_database_before_run.json');
const expectedPatient2InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_2_in_database_before_run.json');
const expectedPatient3InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_3_in_database_before_run.json');
const expectedPatient4InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_4_in_database_before_run.json');
const expectedPatient5InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_5_in_database_before_run.json');
const expectedPatient6InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_6_in_database_before_run.json');
const expectedPatient7InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_7_in_database_before_run.json');

const expectedPatient1DatabaseAfterRun = require('./fixtures/expected/expected_patient1.json');
const expectedPatient2DatabaseAfterRun = require('./fixtures/expected/expected_patient2.json');
const expectedPatient3DatabaseAfterRun = require('./fixtures/expected/expected_patient3.json');
const expectedPatient4DatabaseAfterRun = require('./fixtures/expected/expected_patient4.json');
const expectedPatient5DatabaseAfterRun = require('./fixtures/expected/expected_patient5.json');
const expectedPatient6DatabaseAfterRun = require('./fixtures/expected/expected_patient6.json');
const expectedPatient7DatabaseAfterRun = require('./fixtures/expected/expected_patient7.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {RunPreSaveRunner} = require('../../../../admin/runners/runPreSaveRunner');
const {IdentifierSystem} = require('../../../../utils/identifierSystem');
const {assertTypeEquals} = require('../../../../utils/assertType');
const {generateUUIDv5} = require('../../../../utils/uid.util');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

function sleepAsync(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

async function setupDatabaseAsync(mongoDatabaseManager, patientResource, expectedPatientInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection('Patient_4_0_0');
    await collection.insertOne(patientResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: patientResource.id});
    // const resultsJson = JSON.stringify(results);

    delete resource._id;

    patientResource.meta.lastUpdated = resource.meta.lastUpdated;

    expect(resource).toStrictEqual(expectedPatientInDatabase);
    return collection;
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient runPreSave Tests', () => {
        test('runPreSave works for patient 1', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager, patient1Resource, expectedPatient1InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 1
            const patient1 = await collection.findOne({id: patient1Resource.id});
            expect(patient1).toBeDefined();
            delete patient1._id;
            expect(patient1._uuid).toBeDefined();
            expectedPatient1DatabaseAfterRun._uuid = patient1._uuid;
            expect(patient1.meta).toBeDefined();
            expect(patient1.meta.lastUpdated).toBeDefined();
            expect(patient1.meta.lastUpdated).not.toStrictEqual(expectedPatient1DatabaseAfterRun.meta.lastUpdated);
            expectedPatient1DatabaseAfterRun.meta.lastUpdated = patient1.meta.lastUpdated;
            expectedPatient1DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = patient1._uuid;
            expect(patient1).toStrictEqual(expectedPatient1DatabaseAfterRun);
        });
        test('runPreSave works for patient 2', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                patient2Resource,
                expectedPatient2InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 2
            const patient2 = await collection.findOne({id: patient2Resource.id});
            expect(patient2).toBeDefined();
            delete patient2._id;
            expect(patient2._uuid).toBeDefined();
            expectedPatient2DatabaseAfterRun._uuid = patient2._uuid;
            expect(patient2.meta).toBeDefined();
            expect(patient2.meta.lastUpdated).toBeDefined();
            expect(patient2.meta.lastUpdated).not.toStrictEqual(expectedPatient2DatabaseAfterRun.meta.lastUpdated);
            expectedPatient2DatabaseAfterRun.meta.lastUpdated = patient2.meta.lastUpdated;
            expectedPatient2DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = patient2._uuid;
            expect(patient2).toStrictEqual(expectedPatient2DatabaseAfterRun);
        });
        test('runPreSave works for patient 3 with uuid but no identifier', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                patient3Resource,
                expectedPatient3InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 3 with uuid but no identifier
            const patient3 = await collection.findOne({id: patient3Resource.id});
            expect(patient3).toBeDefined();
            delete patient3._id;
            expect(patient3._uuid).toBeDefined();
            expectedPatient3DatabaseAfterRun._uuid = patient3._uuid;
            expect(patient3.meta).toBeDefined();
            expect(patient3.meta.lastUpdated).toBeDefined();
            expect(patient3.meta.lastUpdated).not.toStrictEqual(expectedPatient3DatabaseAfterRun.meta.lastUpdated);
            expectedPatient3DatabaseAfterRun.meta.lastUpdated = patient3.meta.lastUpdated;
            expect(patient3.identifier).toBeDefined();
            expectedPatient3DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = patient3._uuid;
            expect(patient3).toStrictEqual(expectedPatient3DatabaseAfterRun);
        });
        test('runPreSave works with patient 4 with all fields but sourceAssigningAuthority', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                patient4Resource,
                expectedPatient4InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);

            await sleepAsync(2000);
            await runPreSaveRunner.processAsync();

            // Check patient 4 with all fields populated except sourceAssigningAuthority
            const patient4 = await collection.findOne({id: patient4Resource.id});
            expect(patient4).toBeDefined();
            delete patient4._id;
            expect(patient4._uuid).toBeDefined();
            expect(patient4.meta).toBeDefined();
            expect(patient4.meta.lastUpdated).toBeDefined();
            expect(patient4.meta.lastUpdated).not.toStrictEqual(expectedPatient4DatabaseAfterRun.meta.lastUpdated);
            expectedPatient4DatabaseAfterRun.meta.lastUpdated = patient4.meta.lastUpdated;
            expect(patient4).toStrictEqual(expectedPatient4DatabaseAfterRun);
            const expectedUuid = generateUUIDv5(`${expectedPatient4DatabaseAfterRun.id}|medstar`);
            expect(patient4._uuid).toStrictEqual(expectedUuid);
        });
        test('runPreSave works with patient 5 with all fields', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                patient5Resource,
                expectedPatient5InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // patient 5 with all field populated so no update should be done
            const patient5 = await collection.findOne({id: patient5Resource.id});
            expect(patient5).toBeDefined();
            delete patient5._id;
            expect(patient5._uuid).toBeDefined();
            expect(patient5.meta).toBeDefined();
            expect(patient5).toStrictEqual(expectedPatient5DatabaseAfterRun);
            // no update should be done
            expect(patient5.meta.lastUpdated).toStrictEqual(expectedPatient5DatabaseAfterRun.meta.lastUpdated);
            const expectedUuid = generateUUIDv5(`${expectedPatient5DatabaseAfterRun.id}|medstar`);
            expect(patient5._uuid).toStrictEqual(expectedUuid);
        });
        test('runPreSave is skipped for patient 6 newer than threshold', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                patient6Resource,
                expectedPatient6InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // check that patient 6 was skipped since it has a newer lastModified date
            const patient6 = await collection.findOne({id: patient6Resource.id});
            expect(patient6).toBeDefined();
            delete patient6._id;
            expect(patient6.meta.lastUpdated).toStrictEqual(patient6Resource.meta.lastUpdated);
            expect(patient6).toStrictEqual(expectedPatient6DatabaseAfterRun);
        });
        test('runPreSave works for patient 7 with id as uuid', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
                // eslint-disable-next-line no-unused-vars
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                patient7Resource,
                expectedPatient7InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {RunPreSaveRunner}
             */
            const runPreSaveRunner = container.runPreSaveRunner;
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 3 with uuid but no identifier
            const patient7 = await collection.findOne({id: patient7Resource.id});
            expect(patient7).toBeDefined();
            delete patient7._id;
            expect(patient7._uuid).toBeDefined();
            expectedPatient7DatabaseAfterRun._uuid = patient7._uuid;
            expect(patient7.meta).toBeDefined();
            expect(patient7.meta.lastUpdated).toBeDefined();
            expect(patient7.meta.lastUpdated).not.toStrictEqual(expectedPatient7DatabaseAfterRun.meta.lastUpdated);
            expectedPatient7DatabaseAfterRun.meta.lastUpdated = patient7.meta.lastUpdated;
            expect(patient7).toStrictEqual(expectedPatient7DatabaseAfterRun);
        });
    });
});
