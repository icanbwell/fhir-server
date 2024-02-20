// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedPerson1DatabaseBeforeRun = require('./fixtures/expected/expected_person1_in_database_before_run.json');
const expectedPerson2DatabaseBeforeRun = require('./fixtures/expected/expected_person2_in_database_before_run.json');
const expectedPatient1DatabaseBeforeRun = require('./fixtures/expected/expected_patient1_in_database_before_run.json');

const expectedPerson1DatabaseAfterRun = require('./fixtures/expected/expected_person1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer
} = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { ConfigManager } = require('../../../../utils/configManager');
const {
    FixReferenceSourceAssigningAuthorityRunner
} = require('../../../../admin/runners/fixReferenceSourceAssigningAuthorityRunner');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');
const { assertTypeEquals } = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }
}

async function setupDatabaseAsync (mongoDatabaseManager, personResource, expectedPersonInDatabase,
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

    expect(resource).toStrictEqual(expectedPersonInDatabase);
    return collection;
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person fixReferenceSourceAssigningAuthority Tests', () => {
        test('fixReferenceSourceAssigningAuthority works for patient 1', async () => {
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
                mongoDatabaseManager, person1Resource, expectedPerson1DatabaseBeforeRun,
                'Person_4_0_0'
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, person2Resource, expectedPerson2DatabaseBeforeRun,
                'Person_4_0_0'
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, patient1Resource, expectedPatient1DatabaseBeforeRun,
                'Patient_4_0_0'
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixReferenceSourceAssigningAuthorityRunner',
                (c) => new FixReferenceSourceAssigningAuthorityRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        preloadCollections: [
                            'Person_4_0_0',
                            'Patient_4_0_0'
                        ],
                        resourceMerger: c.resourceMerger
                    }
                )
            );

            /**
             * @type {FixReferenceSourceAssigningAuthorityRunner}
             */
            const fixReferenceSourceAssigningAuthorityRunner = container.fixReferenceSourceAssigningAuthorityRunner;
            assertTypeEquals(fixReferenceSourceAssigningAuthorityRunner, FixReferenceSourceAssigningAuthorityRunner);
            await fixReferenceSourceAssigningAuthorityRunner.processAsync();

            // Check patient 1
            const person1 = await collection.findOne({ id: person1Resource.id });
            expect(person1).toBeDefined();
            delete person1._id;
            expect(person1._uuid).toBeDefined();
            expectedPerson1DatabaseAfterRun._uuid = person1._uuid;
            expect(person1.meta).toBeDefined();
            expect(person1.meta.lastUpdated).toBeDefined();
            expect(person1.meta.lastUpdated).not.toStrictEqual(expectedPerson1DatabaseAfterRun.meta.lastUpdated);
            expectedPerson1DatabaseAfterRun.meta.lastUpdated = person1.meta.lastUpdated;
            expectedPerson1DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = person1._uuid;
            expect(person1).toStrictEqual(expectedPerson1DatabaseAfterRun);
        });
        test('fixReferenceSourceAssigningAuthority works for patient 1 with specified properties', async () => {
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
                mongoDatabaseManager, person1Resource, expectedPerson1DatabaseBeforeRun,
                'Person_4_0_0'
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, person2Resource, expectedPerson2DatabaseBeforeRun,
                'Person_4_0_0'
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, patient1Resource, expectedPatient1DatabaseBeforeRun,
                'Patient_4_0_0'
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixReferenceSourceAssigningAuthorityRunner',
                (c) => new FixReferenceSourceAssigningAuthorityRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections,
                        batchSize,
                        beforeLastUpdatedDate: '2023-01-29',
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        preloadCollections: [
                            'Person_4_0_0',
                            'Patient_4_0_0'
                        ],
                        resourceMerger: c.resourceMerger,
                        properties: [
                            'link'
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

            // Check patient 1
            const person1 = await collection.findOne({ id: person1Resource.id });
            expect(person1).toBeDefined();
            delete person1._id;
            expect(person1._uuid).toBeDefined();
            expectedPerson1DatabaseAfterRun._uuid = person1._uuid;
            expect(person1.meta).toBeDefined();
            expect(person1.meta.lastUpdated).toBeDefined();
            // expect(person1.meta.lastUpdated).not.toStrictEqual(expectedPerson1DatabaseAfterRun.meta.lastUpdated);
            expectedPerson1DatabaseAfterRun.meta.lastUpdated = person1.meta.lastUpdated;
            expectedPerson1DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = person1._uuid;
            expect(person1).toStrictEqual(expectedPerson1DatabaseAfterRun);
        });
    });
});
