// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');
const practitioner2Resource = require('./fixtures/Practitioner/practitioner2.json');
const practitionerrole1Resource = require('./fixtures/Practitioner/practitionerrole1.json');
const practitionerrole2Resource = require('./fixtures/Practitioner/practitionerrole2.json');
const Practitioner1HistoryResource = require('./fixtures/Practitioner/practitioner1_history.json');

// expected
const expectedPractitioner1InDatabaseBeforeRun = require('./fixtures/expected/expected_practitioner_1_in_database_before_run.json');
const expectedPractitioner2InDatabaseBeforeRun = require('./fixtures/expected/expected_practitioner_2_in_database_before_run.json');
const expectedPractitionerRole1InDatabaseBeforeRun = require('./fixtures/expected/expected_practitionerrole_1_in_database_before_run.json');
const expectedPractitionerRole2InDatabaseBeforeRun = require('./fixtures/expected/expected_practitionerrole_2_in_database_before_run.json');
const expectedPractitioner1HistoryInDatabaseBeforeRun = require('./fixtures/expected/expected_practitioner1_hisory_in_database_before_run.json');

const expectedPractitioner1DatabaseAfterRun = require('./fixtures/expected/expected_practitioner1.json');
const expectedPractitioner2DatabaseAfterRun = require('./fixtures/expected/expected_practitioner2.json');
const expectedPractitionerRole1DatabaseAfterRun = require('./fixtures/expected/expected_practitionerrole1.json');
const expectedPractitionerRole2DatabaseAfterRun = require('./fixtures/expected/expected_practitionerrole2.json');
const expectedPractitioner1HistoryDatabaseAfterRun = require('./fixtures/expected/expected_practitioner1_hisory.json');

const { FixMultipleSourceAssigningAuthorityHistoryRunner } = require('../../../../admin/runners/fixMultipleSourceAssigningAuthorityHistoryRunner');

const { FixReferenceSourceAssigningAuthorityRunner } = require('../../../../admin/runners/fixReferenceSourceAssigningAuthorityRunner');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer
} = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { ConfigManager } = require('../../../../utils/configManager');
const { FixMultipleSourceAssigningAuthorityRunner } = require('../../../../admin/runners/fixMultipleSourceAssigningAuthorityRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport () {
        return false;
    }

    get enableReturnBundle () {
        return true;
    }
}

async function setupDatabaseAsync (mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({ id: incomingResource.id });

    delete resource._id;

    incomingResource.meta.lastUpdated = resource.meta.lastUpdated;

    expect(resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

async function setupHistoryDatabaseAsync (mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resource.resourceType}_4_0_0_History`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({ id: incomingResource.id });

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

    describe('Practitioner fixMultipleSourceAssigningAuthority Tests', () => {
        test('fixMultipleSourceAssigningAuthority works for practitioners', async () => {
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
            const practitionerCollection = await setupDatabaseAsync(
                mongoDatabaseManager, practitioner1Resource, expectedPractitioner1InDatabaseBeforeRun
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, practitioner2Resource, expectedPractitioner2InDatabaseBeforeRun
            );
            const practitionerRoleCollection = await setupDatabaseAsync(
                mongoDatabaseManager, practitionerrole1Resource, expectedPractitionerRole1InDatabaseBeforeRun
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, practitionerrole2Resource, expectedPractitionerRole2InDatabaseBeforeRun
            );

            // run admin runner

            let collections = ['Practitioner_4_0_0'];
            const batchSize = 10000;

            container.register('fixMultipleSourceAssigningAuthorityRunner', (c) => new FixMultipleSourceAssigningAuthorityRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager
                    }
                )
            );

            /**
             * @type {FixMultipleSourceAssigningAuthorityRunner}
             */
            const fixMultipleSourceAssigningAuthorityRunner = container.fixMultipleSourceAssigningAuthorityRunner;
            assertTypeEquals(fixMultipleSourceAssigningAuthorityRunner, FixMultipleSourceAssigningAuthorityRunner);
            await fixMultipleSourceAssigningAuthorityRunner.processAsync();

            // Check practitioner 1
            const practitioner1 = await practitionerCollection.findOne({ id: practitioner1Resource.id });
            expect(practitioner1).toBeDefined();
            delete practitioner1._id;
            expectedPractitioner1DatabaseAfterRun.meta.lastUpdated = practitioner1.meta.lastUpdated;
            expect(practitioner1).toStrictEqual(expectedPractitioner1DatabaseAfterRun);

            // Check practitioner 2
            const practitioner2 = await practitionerCollection.findOne({ id: practitioner2Resource.id });
            expect(practitioner2).toBeDefined();
            delete practitioner2._id;
            expectedPractitioner2DatabaseAfterRun.meta.lastUpdated = practitioner2.meta.lastUpdated;
            expect(practitioner2).toStrictEqual(expectedPractitioner2DatabaseAfterRun);

            // run admin runner

            collections = ['PractitionerRole_4_0_0'];

            container.register(
                'fixReferenceSourceAssigningAuthorityRunner',
                (c) => new FixReferenceSourceAssigningAuthorityRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        preloadCollections: [
                            'Practitioner_4_0_0'
                        ]
                    }
                )
            );

            /**
             * @type {FixReferenceSourceAssigningAuthorityRunner}
             */
            const fixReferenceSourceAssigningAuthorityRunner = container.fixReferenceSourceAssigningAuthorityRunner;
            assertTypeEquals(fixReferenceSourceAssigningAuthorityRunner, FixReferenceSourceAssigningAuthorityRunner);
            await fixReferenceSourceAssigningAuthorityRunner.processAsync();

            // Check practitionerrole 1
            const practitionerrole1 = await practitionerRoleCollection.findOne({ id: practitionerrole1Resource.id });
            expect(practitionerrole1).toBeDefined();
            delete practitionerrole1._id;
            expectedPractitionerRole1DatabaseAfterRun._uuid = practitionerrole1._uuid;
            expectedPractitionerRole1DatabaseAfterRun.meta.lastUpdated = practitionerrole1.meta.lastUpdated;
            expect(practitionerrole1).toStrictEqual(expectedPractitionerRole1DatabaseAfterRun);

            // Check practitionerrole 2
            const practitionerrole2 = await practitionerRoleCollection.findOne({ id: practitionerrole2Resource.id });
            expect(practitionerrole2).toBeDefined();
            delete practitionerrole2._id;
            expectedPractitionerRole2DatabaseAfterRun._uuid = practitionerrole2._uuid;
            expectedPractitionerRole2DatabaseAfterRun.meta.lastUpdated = practitionerrole2.meta.lastUpdated;
            expect(practitionerrole2).toStrictEqual(expectedPractitionerRole2DatabaseAfterRun);
        });
        test('fixMultipleSourceAssigningAuthorityHistory works for practitioner', async () => {
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
            const practitionerHistoryCollection = await setupHistoryDatabaseAsync(
                mongoDatabaseManager,
                Practitioner1HistoryResource,
                expectedPractitioner1HistoryInDatabaseBeforeRun
            );

            // run admin runner

            const collections = ['Practitioner_4_0_0_History'];
            const batchSize = 10000;

            container.register('fixMultipleSourceAssigningAuthorityHistoryRunner', (c) => new FixMultipleSourceAssigningAuthorityHistoryRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections,
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

            // Check practitioner 1 history
            const practitioner1History = await practitionerHistoryCollection.findOne({ id: Practitioner1HistoryResource.id });
            expect(practitioner1History).toBeDefined();
            delete practitioner1History._id;
            expect(practitioner1History).toStrictEqual(expectedPractitioner1HistoryDatabaseAfterRun);
        });
    });
});
