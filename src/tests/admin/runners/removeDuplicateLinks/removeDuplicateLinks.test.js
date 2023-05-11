// test file
const person1Resource = require('./fixtures/person1.json');
const person2Resource = require('./fixtures/person2.json');

const expected1Person = require('./fixtures/expected/expectedPerson1.json');
const expected2Person = require('./fixtures/expected/expectedPerson2.json');
const { RemoveDuplicatePersonLinkRunner } = require('../../../../admin/runners/removeDuplicatePersonLinkRunner');

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
                mongoDatabaseManager, person1Resource, 'Person_4_0_0',
            );

            await setupDatabaseAsync(
                mongoDatabaseManager, person2Resource, 'Person_4_0_0',
            );
            // run admin runner

            const batchSize = 10000;

            container.register(
                'removeDuplicatePersonLinkRunner',
                (c) => new RemoveDuplicatePersonLinkRunner(
                    {
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        personUuids: undefined,
                        minLinks: 3,
                        batchSize: batchSize,
                        ownerCode: undefined,
                        uuidGreaterThan: undefined
                    },
                ),
            );

            /**
             * @type {RemoveDuplicatePersonLinkRunner}
             */
            const removeDuplicatePersonLinkRunner = container.removeDuplicatePersonLinkRunner;
            assertTypeEquals(removeDuplicatePersonLinkRunner, RemoveDuplicatePersonLinkRunner);
            await removeDuplicatePersonLinkRunner.processAsync();

            // Check person 1
            const person1 = await collection.findOne({ id: person1Resource.id });
            expect(person1).toBeDefined();
            expected1Person._uuid = person1._uuid;
            expected1Person.meta.lastUpdated = person1.meta.lastUpdated;
            expect(person1).toStrictEqual(expected1Person);

            // Check person 1
            const person2 = await collection.findOne({ id: person2Resource.id });
            expect(person2).toBeDefined();
            expected2Person._uuid = person2._uuid;
            expected2Person.meta.lastUpdated = person2.meta.lastUpdated;
            expect(person2).toStrictEqual(expected2Person);
        });
    });
});
