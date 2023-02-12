// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3_with_uuid_but_no_identifier.json');
const patient4Resource = require('./fixtures/Patient/patient4_with_all_fields_but_sourceAssigningAuthority.json');
const patient5Resource = require('./fixtures/Patient/patient5_with_all_fields.json');
const patient6Resource = require('./fixtures/Patient/patient6_newer_than_threshold.json');

// expected
const expectedPatientsInDatabaseBeforeRun = require('./fixtures/expected/expected_patients_in_database_before_run.json');
const expectedPatient1DatabaseAfterRun = require('./fixtures/expected/expected_patient1.json');
const expectedPatient2DatabaseAfterRun = require('./fixtures/expected/expected_patient2.json');
const expectedPatient3DatabaseAfterRun = require('./fixtures/expected/expected_patient3.json');
const expectedPatient4DatabaseAfterRun = require('./fixtures/expected/expected_patient4.json');
const expectedPatient5DatabaseAfterRun = require('./fixtures/expected/expected_patient5.json');
const expectedPatient6DatabaseAfterRun = require('./fixtures/expected/expected_patient6.json');

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

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection('Patient_4_0_0');
    await collection.insertOne(patient1Resource);
    await collection.insertOne(patient2Resource);
    await collection.insertOne(patient3Resource);
    await collection.insertOne(patient4Resource);
    await collection.insertOne(patient5Resource);
    await collection.insertOne(patient6Resource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {Object[]}
     */
    let results = await collection.find({}).sort({id: 1}).toArray();
    // const resultsJson = JSON.stringify(results);

    expect(results.length).toStrictEqual(6);
    for (const resource of results) {
        delete resource._id;
        delete resource.meta.lastUpdated;
    }
    for (const resource of expectedPatientsInDatabaseBeforeRun) {
        delete resource._id;
        delete resource.meta.lastUpdated;
    }
    expect(results).toStrictEqual(expectedPatientsInDatabaseBeforeRun);
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
        test('runPreSave works', async () => {
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
            const collection = await setupDatabaseAsync(mongoDatabaseManager);

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

            // patient 5 with all field populated so no update should be done
            const patient5 = await collection.findOne({id: patient5Resource.id});
            expect(patient5).toBeDefined();
            delete patient5._id;
            expect(patient5._uuid).toBeDefined();
            expect(patient5.meta).toBeDefined();
            expect(patient5).toStrictEqual(expectedPatient5DatabaseAfterRun);
            // no update should be done
            expect(patient5.meta.lastUpdated).toStrictEqual(expectedPatient5DatabaseAfterRun.meta.lastUpdated);

            // check that patient 6 was skipped since it has a newer lastModified date
            const patient6 = await collection.findOne({id: patient6Resource.id});
            expect(patient6).toBeDefined();
            expect(patient6.meta.lastUpdated).toStrictEqual(patient6Resource.meta.lastUpdated);
            expect(patient6).toStrictEqual(expectedPatient6DatabaseAfterRun);
        });
    });
});
