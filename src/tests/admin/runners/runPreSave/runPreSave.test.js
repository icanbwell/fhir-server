// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3_with_uuid_but_no_identifier.json');
const patient4Resource = require('./fixtures/Patient/patient4_with_all_fields.json');

// expected
const expectedPatientsInDatabaseBeforeRun = require('./fixtures/expected/expected_patients_in_database_before_run.json');
const expectedPatient1DatabaseAfterRun = require('./fixtures/expected/expected_patient1.json');
// const expectedPatient2DatabaseAfterRun = require('./fixtures/expected/expected_patient2.json');
// const expectedPatient3DatabaseAfterRun = require('./fixtures/expected/expected_patient3.json');
// const expectedPatient4DatabaseAfterRun = require('./fixtures/expected/expected_patient4.json');

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

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient createAccessIndex Tests', () => {
        test('createAccessIndex works', async () => {
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

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const collection = fhirDb.collection('Patient_4_0_0');
            await collection.insertOne(patient1Resource);
            await collection.insertOne(patient2Resource);
            await collection.insertOne(patient3Resource);
            await collection.insertOne(patient4Resource);

            // ACT & ASSERT
            // check that two entries were stored in the database
            /**
             * @type {Object[]}
             */
            let results = await collection.find({}).sort({id: 1}).toArray();
            // const resultsJson = JSON.stringify(results);

            expect(results.length).toStrictEqual(4);
            for (const resource of results) {
                delete resource._id;
                delete resource.meta.lastUpdated;
            }
            for (const resource of expectedPatientsInDatabaseBeforeRun) {
                delete resource._id;
                delete resource.meta.lastUpdated;
            }
            expect(results).toStrictEqual(expectedPatientsInDatabaseBeforeRun);

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register('runPreSaveRunner', (c) => new RunPreSaveRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
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
            await runPreSaveRunner.processAsync();

            const patient1 = await collection.findOne({id: patient1Resource.id});
            expect(patient1).toBeDefined();
            delete patient1._id;
            expect(patient1._uuid).toBeDefined();
            expectedPatient1DatabaseAfterRun._uuid = patient1._uuid;
            expect(patient1.meta).toBeDefined();
            // expect(patient1.meta.lastUpdated).toBeDefined();
            // patient1.meta.lastUpdated = expectedPatient1DatabaseAfterRun.meta.lastUpdated;
            expectedPatient1DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = patient1._uuid;
            expect(patient1).toStrictEqual(expectedPatient1DatabaseAfterRun);
        });
    });
});
