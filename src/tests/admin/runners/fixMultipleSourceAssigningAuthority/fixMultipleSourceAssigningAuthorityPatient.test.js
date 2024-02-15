// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient1HistoryResource = require('./fixtures/Patient/patient1_history.json');


// expected
const expectedPatient1InDatabaseBeforeRun = require('./fixtures/expected/expected_patient_1_in_database_before_run.json');
const expectedPatient1HistoryInDatabaseBeforeRun = require('./fixtures/expected/expected_patient1_history_in_database_before_run.json');

const expectedPatient1DatabaseAfterRun = require('./fixtures/expected/expected_patient1.json');
const expectedPatient1HistoryDatabaseAfterRun = require('./fixtures/expected/expected_patient1_history.json');

const { FixMultipleSourceAssigningAuthorityHistoryRunner } = require('../../../../admin/runners/fixMultipleSourceAssigningAuthorityHistoryRunner');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {FixMultipleSourceAssigningAuthorityRunner} = require('../../../../admin/runners/fixMultipleSourceAssigningAuthorityRunner');
const {assertTypeEquals} = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: incomingResource.id});

    delete resource._id;

    incomingResource.meta.lastUpdated = resource.meta.lastUpdated;

    expect(resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

async function setupHistoryDatabaseAsync(mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resource.resourceType}_4_0_0_History`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: incomingResource.id});

    delete resource._id;

    expect(resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

describe('Fix Multiple Source Assigning Authority Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('fixMultipleSourceAssigningAuthority Tests', () => {
        test('fixMultipleSourceAssigningAuthority works for patients', async () => {
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
            const patientCollection = await setupDatabaseAsync(
                mongoDatabaseManager, patient1Resource, expectedPatient1InDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['Patient_4_0_0'];
            const batchSize = 10000;

            delete container['fixMultipleSourceAssigningAuthorityRunner'];
            container.register('fixMultipleSourceAssigningAuthorityRunner', (c) => new FixMultipleSourceAssigningAuthorityRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        filterRecords: true
                    }
                )
            );

            /**
             * @type {FixMultipleSourceAssigningAuthorityRunner}
             */
            const fixMultipleSourceAssigningAuthorityRunner = container.fixMultipleSourceAssigningAuthorityRunner;
            assertTypeEquals(fixMultipleSourceAssigningAuthorityRunner, FixMultipleSourceAssigningAuthorityRunner);
            await fixMultipleSourceAssigningAuthorityRunner.processAsync();

            // Check patient 1
            const patient1 = await patientCollection.findOne({id: patient1Resource.id});
            expect(patient1).toBeDefined();
            delete patient1._id;
            expectedPatient1DatabaseAfterRun.meta.lastUpdated = patient1.meta.lastUpdated;
            expect(patient1).toStrictEqual(expectedPatient1DatabaseAfterRun);
        });
        test('fixMultipleSourceAssigningAuthorityHistory works for patient', async () => {
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
            const patientHistoryCollection = await setupHistoryDatabaseAsync(
                mongoDatabaseManager,
                patient1HistoryResource,
                expectedPatient1HistoryInDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['Patient_4_0_0_History'];
            const batchSize = 10000;
            delete container.fixMultipleSourceAssigningAuthorityRunner;
            container.register('fixMultipleSourceAssigningAuthorityHistoryRunner', (c) => new FixMultipleSourceAssigningAuthorityHistoryRunner(
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
            const fixMultipleSourceAssigningAuthorityHistoryRunner = container.fixMultipleSourceAssigningAuthorityHistoryRunner;
            assertTypeEquals(fixMultipleSourceAssigningAuthorityHistoryRunner, FixMultipleSourceAssigningAuthorityHistoryRunner);
            await fixMultipleSourceAssigningAuthorityHistoryRunner.processAsync();

            // Check patient 1 history
            const patient1History = await patientHistoryCollection.findOne({id: patient1HistoryResource.id});
            expect(patient1History).toBeDefined();
            delete patient1History._id;
            expect(patient1History).toStrictEqual(expectedPatient1HistoryDatabaseAfterRun);
        });
    });
});
