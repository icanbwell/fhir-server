// test file
const mainPerson1Resource = require('./fixtures/Person/mainPerson1.json');
const linkedePerson1Resource = require('./fixtures/Person/linkedPerson1.json');
const linkedePerson2Resource = require('./fixtures/Person/linkedPerson2.json');
const linkedePerson3Resource = require('./fixtures/Person/linkedPerson3.json');

const linkedPatient1Resource = require('./fixtures/Patient/linkedPatient1.json');

const expectedPerson1DatabaseAfterRun = require('./fixtures/expected/expected_person1.json');
const { FixPersonLinksRunner } = require('../../../../admin/runners/fixPersonLinksRunner');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { ConfigManager } = require('../../../../utils/configManager');
const { assertTypeEquals } = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, personResource,
                                  collectionName) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(collectionName);
    await collection.insertOne(personResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({ id: personResource.id });
    // const resultsJson = JSON.stringify(results);

    delete resource._id;

    personResource.meta.lastUpdated = resource.meta.lastUpdated;

    return collection;
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person fixPersonLinks Tests', () => {
        test('fixPersonLinks works for main person 1', async () => {
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
                mongoDatabaseManager, mainPerson1Resource, 'Person_4_0_0',
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, linkedePerson1Resource, 'Person_4_0_0',
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, linkedePerson2Resource, 'Person_4_0_0',
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, linkedePerson3Resource, 'Person_4_0_0',
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, linkedPatient1Resource, 'Patient_4_0_0',
            );

            // run admin runner

            const batchSize = 10000;

            container.register(
                'fixPersonLinksRunner',
                (c) => new FixPersonLinksRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        preloadCollections: [
                            'Person_4_0_0',
                        ],
                        resourceMerger: c.resourceMerger,
                        minLinks: 1
                    },
                ),
            );

            /**
             * @type {fixPersonLinksRunner}
             */
            const fixPersonLinksRunner = container.fixPersonLinksRunner;
            assertTypeEquals(fixPersonLinksRunner, FixPersonLinksRunner);
            await fixPersonLinksRunner.processAsync();

            // Check patient 1
            const person1 = await collection.findOne({ id: mainPerson1Resource.id });
            expect(person1).toBeDefined();
            expectedPerson1DatabaseAfterRun._uuid = person1._uuid;
            expectedPerson1DatabaseAfterRun.meta.lastUpdated = person1.meta.lastUpdated;
            expect(person1).toStrictEqual(expectedPerson1DatabaseAfterRun);
        });
    });
});
