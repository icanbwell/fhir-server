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
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {
    FixReferenceSourceAssigningAuthorityRunner
} = require('../../../../admin/runners/fixReferenceSourceAssigningAuthorityRunner');
const {IdentifierSystem} = require('../../../../utils/identifierSystem');
const {assertTypeEquals} = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }
}

/**
 * sets up the datebase with the given personResource and expectedPersonInDatabase.
 * @param {MongoDatabaseManager} mongoDatabaseManager
 * @param {Person} resourceToInsert
 * @param {Person} expectedResourceInDatabase
 * @param {string} collectionName
 * @returns {Promise<import('mongodb').Collection<import('mongodb').Document>>}
 */
async function setupDatabaseAsync(
    {
        mongoDatabaseManager,
        resourceToInsert,
        expectedResourceInDatabase,
        collectionName
    }
) {
    /**
     * @type {import('mongodb').Db}
     */
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    /**
     * @type {import('mongodb').Collection<import('mongodb').Document>}
     */
    const collection = fhirDb.collection(collectionName);
    /**
     * @type {number}
     */
    const countBeforeInsert = await collection.countDocuments({});
    /**
     * @type {import('mongodb').InsertOneResult<import('mongodb').Document>}
     */
    const insertResult = await collection.insertOne(resourceToInsert);

    expect(insertResult.acknowledged).toBeTruthy();
    expect(insertResult.insertedId).toBeDefined();

    /**
     * @type {number}
     */
    const countAfterInsert = await collection.countDocuments({});
    expect(countAfterInsert).toBe(countBeforeInsert + 1);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: resourceToInsert.id});
    // const resultsJson = JSON.stringify(results);

    delete resource._id;

    resourceToInsert.meta.lastUpdated = resource.meta.lastUpdated;
    expect(resource).toStrictEqual(expectedResourceInDatabase);
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

            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */

            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                {
                    mongoDatabaseManager,
                    resourceToInsert: person1Resource,
                    expectedResourceInDatabase: expectedPerson1DatabaseBeforeRun,
                    collectionName: 'Person_4_0_0'
                }
            );
            await setupDatabaseAsync(
                {
                    mongoDatabaseManager,
                    resourceToInsert: person2Resource,
                    expectedResourceInDatabase: expectedPerson2DatabaseBeforeRun,
                    collectionName: 'Person_4_0_0'
                }
            );
            await setupDatabaseAsync(
                {
                    mongoDatabaseManager,
                    resourceToInsert: patient1Resource,
                    expectedResourceInDatabase: expectedPatient1DatabaseBeforeRun,
                    collectionName: 'Patient_4_0_0'
                }
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixReferenceSourceAssigningAuthorityRunner',
                (c) => new FixReferenceSourceAssigningAuthorityRunner(
                    {
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
            const person1 = await collection.findOne({id: person1Resource.id});
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

            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                {
                    mongoDatabaseManager,
                    resourceToInsert: person1Resource,
                    expectedResourceInDatabase: expectedPerson1DatabaseBeforeRun,
                    collectionName: 'Person_4_0_0'
                }
            );
            await setupDatabaseAsync(
                {
                    mongoDatabaseManager,
                    resourceToInsert: person2Resource,
                    expectedResourceInDatabase: expectedPerson2DatabaseBeforeRun,
                    collectionName: 'Person_4_0_0'
                }
            );
            await setupDatabaseAsync(
                {
                    mongoDatabaseManager,
                    resourceToInsert: patient1Resource,
                    expectedResourceInDatabase: expectedPatient1DatabaseBeforeRun,
                    collectionName: 'Patient_4_0_0'
                }
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixReferenceSourceAssigningAuthorityRunner',
                (c) => new FixReferenceSourceAssigningAuthorityRunner(
                    {
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
            const person1 = await collection.findOne({id: person1Resource.id});
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
