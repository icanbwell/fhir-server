// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

// expected
const expectedPatientsInDatabaseAfterRun = require('./fixtures/expected/expected_patients_in_database_after_run.json');
const expectedPatientsInDatabaseBeforeRun = require('./fixtures/expected/expected_patients_in_database_before_run.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {CreateAccessIndexRunner} = require('../../../../admin/runners/createAccessIndexFieldRunner');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
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

            // ACT & ASSERT
            // check that two entries were stored in the database
            /**
             * @type {Object[]}
             */
            let results = await collection.find({}).sort({id: 1}).toArray();
            // const resultsJson = JSON.stringify(results);

            expect(results.length).toStrictEqual(2);
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

            container.register('createAccessIndexRunner', (c) => new CreateAccessIndexRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager
                    }
                )
            );

            /**
             * @type {CreateAccessIndexRunner}
             */
            const createAccessIndexRunner = container.createAccessIndexRunner;
            await createAccessIndexRunner.processAsync();

            results = await collection.find({}).sort({id: 1}).toArray();
            expect(results.length).toStrictEqual(2);
            for (const resource of results) {
                delete resource._id;
                delete resource.meta.lastUpdated;
                resource._uuid = '11111111-1111-1111-1111-111111111111';
                if (resource.identifier) {
                    resource.identifier
                        .filter(i => i.system === IdentifierSystem.uuid)
                        .forEach(i => {
                                i.value = '11111111-1111-1111-1111-111111111111';
                                return i;
                            }
                        );
                }
            }
            for (const resource of expectedPatientsInDatabaseAfterRun) {
                delete resource._id;
                delete resource.meta.lastUpdated;
                resource._uuid = '11111111-1111-1111-1111-111111111111';
                if (resource.identifier) {
                    resource.identifier
                        .filter(i => i.system === IdentifierSystem.uuid)
                        .forEach(i => {
                                i.value = '11111111-1111-1111-1111-111111111111';
                                return i;
                            }
                        );
                }
            }
            expect(results).toStrictEqual(expectedPatientsInDatabaseAfterRun);
        });
    });
});
