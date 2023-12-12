// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedPerson1InDatabaseBeforeRun = require('./fixtures/expected/expected_person_1_in_database_before_run.json');
const expectedPerson2InDatabaseBeforeRun = require('./fixtures/expected/expected_person_2_in_database_before_run.json');
const expectedPerson3InDatabaseBeforeRun = require('./fixtures/expected/expected_person_3_in_database_before_run.json');

const expectedPerson1DatabaseAfterRun = require('./fixtures/expected/expected_person1.json');
const expectedPerson3DatabaseAfterRun = require('./fixtures/expected/expected_person3.json');

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
const {assertTypeEquals} = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, personResource, expectedPersonInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection('Person_4_0_0');
    await collection.insertOne(personResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: personResource.id});

    delete resource._id;

    expect(resource).toStrictEqual(expectedPersonInDatabase);
    return collection;
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person runPreSave Tests', () => {
        test('runPreSave works for Person without _uuid field in reference', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager, person1Resource, expectedPerson1InDatabaseBeforeRun
            );

            // run admin runner
            const collections = ['Person_4_0_0'];
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
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 1
            const person1 = await collection.findOne({id: person1Resource.id});
            expect(person1).toBeDefined();
            delete person1._id;
            delete person1.meta.lastUpdated;
            expect(person1).toStrictEqual(expectedPerson1DatabaseAfterRun);
        });

        test('runPreSave doesn\'t works for Person with _uuid field in reference', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager, person2Resource, expectedPerson2InDatabaseBeforeRun
            );

            // run admin runner
            const collections = ['Person_4_0_0'];
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
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 2
            const person2 = await collection.findOne({id: person2Resource.id});
            expect(person2).toBeDefined();
            delete person2._id;
            expect(person2).toStrictEqual(expectedPerson2InDatabaseBeforeRun);
        });

        test('runPreSave works for Person with and without _uuid field in reference', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager, person3Resource, expectedPerson3InDatabaseBeforeRun
            );

            // run admin runner
            const collections = ['Person_4_0_0'];
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
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 3
            const person3 = await collection.findOne({id: person3Resource.id});
            expect(person3).toBeDefined();
            delete person3._id;
            delete person3.meta.lastUpdated;
            expect(person3).toStrictEqual(expectedPerson3DatabaseAfterRun);
        });

        test('runPreSave works with multiple Persons without _uuid field in reference', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager, person1Resource, expectedPerson1InDatabaseBeforeRun
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, person2Resource, expectedPerson2InDatabaseBeforeRun
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, person3Resource, expectedPerson3InDatabaseBeforeRun
            );

            // run admin runner
            const collections = ['Person_4_0_0'];
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
            assertTypeEquals(runPreSaveRunner, RunPreSaveRunner);
            await runPreSaveRunner.processAsync();

            // Check patient 1
            const person1 = await collection.findOne({id: person1Resource.id});
            expect(person1).toBeDefined();
            delete person1._id;
            delete person1.meta.lastUpdated;
            expect(person1).toStrictEqual(expectedPerson1DatabaseAfterRun);

            // Check patient 2
            const person2 = await collection.findOne({id: person2Resource.id});
            expect(person2).toBeDefined();
            delete person2._id;
            expect(person2).toStrictEqual(expectedPerson2InDatabaseBeforeRun);

            // Check patient 3
            const person3 = await collection.findOne({id: person3Resource.id});
            expect(person3).toBeDefined();
            delete person3._id;
            delete person3.meta.lastUpdated;
            expect(person3).toStrictEqual(expectedPerson3DatabaseAfterRun);
        });
    });
});
