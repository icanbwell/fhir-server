// test file
const patient1Resource = require('./fixtures/Patient/patient1_without_resource.json');
const patient2Resource = require('./fixtures/Patient/patient2_with_resource.json');

// expected
const expectedPatient1InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_1_in_database_before_run.json');
const expectedPatient2InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_2_in_database_before_run.json');

const expectedPatient1DatabaseAfterRun = require('./fixtures/expected/expected_patient1.json');
const expectedPatient2DatabaseAfterRun = require('./fixtures/expected/expected_patient2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {FixHistoryRunner} = require('../../../../admin/runners/fixHistoryRunner');
const {assertTypeEquals} = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, patientResource, expectedPatientInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection('Patient_4_0_0_History');
    await collection.insertOne(patientResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: patientResource.id});
    // const resultsJson = JSON.stringify(results);

    delete resource._id;

    expect(resource).toStrictEqual(expectedPatientInDatabase);
    return collection;
}

describe('Patient History Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient runPreSave Tests', () => {
        test('runPreSave works for patient 1 without resource', async () => {
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

            container.register('fixHistoryRunner', (c) => new FixHistoryRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {FixHistoryRunner}
             */
            const fixHistoryRunner = container.fixHistoryRunner;
            assertTypeEquals(fixHistoryRunner, FixHistoryRunner);
            await fixHistoryRunner.processAsync();

            // Check patient 1
            const patient1 = await collection.findOne({id: patient1Resource.id});
            expect(patient1).toBeDefined();
            delete patient1._id;
            expect(patient1).toStrictEqual(expectedPatient1DatabaseAfterRun);
        });
        test('runPreSave works for patient 2 with resource', async () => {
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

            container.register('fixHistoryRunner', (c) => new FixHistoryRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {FixHistoryRunner}
             */
            const fixHistoryRunner = container.fixHistoryRunner;
            assertTypeEquals(fixHistoryRunner, FixHistoryRunner);
            await fixHistoryRunner.processAsync();

            // Check patient 2
            const patient2 = await collection.findOne({id: patient2Resource.id});
            expect(patient2).toBeDefined();
            delete patient2._id;
            expect(patient2).toStrictEqual(expectedPatient2DatabaseAfterRun);
        });
    });
});
