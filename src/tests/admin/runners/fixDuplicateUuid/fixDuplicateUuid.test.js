// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedPerson1 = require('./fixtures/expected/expectedPerson1.json');
const expectedPerson2 = require('./fixtures/expected/expectedPerson2.json');
const expectedPerson3 = require('./fixtures/expected/expectedPerson3.json');
const expectedPatient1 = require('./fixtures/expected/expectedPatient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { FixDuplicateUuidRunner } = require('../../../../admin/runners/fixDuplicateUuidRunner');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

async function setupDatabaseAsync (
    mongoDatabaseManager,
    incomingResource,
    expectedResourceInDatabase
) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({ _id: incomingResource._id });

    delete resource._id;

    expect(resource).toStrictEqual(expectedResourceInDatabase);
    return collection;
}

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.fixDuplicateUuidRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('duplicate uuid Person Tests', () => {
        test('duplicate uuid with same resource', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9e' },
                expectedPerson1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9f' },
                expectedPerson1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9g' },
                expectedPerson1
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixDuplicateUuidRunner',
                (c) =>
                    new FixDuplicateUuidRunner({
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
                        useTransaction: true
                    })
            );

            /**
             * @type {FixDuplicateUuidRunner}
             */
            const fixDuplicateUuidRunner = container.fixDuplicateUuidRunner;
            assertTypeEquals(fixDuplicateUuidRunner, FixDuplicateUuidRunner);
            await fixDuplicateUuidRunner.processAsync();

            // Check patient 1
            const persons = await collection.find({ _uuid: person1Resource._uuid }).toArray();
            expect(persons.length).toEqual(1);
        });

        test('duplicate uuid with different versionId and conflicts in max version id resource', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9e' },
                expectedPerson1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person2Resource, _id: '64e5aca92964a96e08066a9f' },
                expectedPerson2
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person3Resource, _id: '64e5aca92964a96e08066a9g' },
                expectedPerson3
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixDuplicateUuidRunner',
                (c) =>
                    new FixDuplicateUuidRunner({
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
                        useTransaction: true
                    })
            );

            /**
             * @type {FixDuplicateUuidRunner}
             */
            const fixDuplicateUuidRunner = container.fixDuplicateUuidRunner;
            assertTypeEquals(fixDuplicateUuidRunner, FixDuplicateUuidRunner);
            await fixDuplicateUuidRunner.processAsync();

            // Check patient 1
            const persons = await collection.find({ _uuid: person1Resource._uuid }).toArray();
            expect(persons.length).toEqual(1);
            delete persons[0]._id;
            expect(persons[0]).toEqual(person3Resource);
        });

        test('duplicate uuid with different versionId resource', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9e' },
                expectedPerson1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person3Resource, _id: '64e5aca92964a96e08066a9g' },
                expectedPerson3
            );

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixDuplicateUuidRunner',
                (c) =>
                    new FixDuplicateUuidRunner({
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
                        useTransaction: true
                    })
            );

            /**
             * @type {FixDuplicateUuidRunner}
             */
            const fixDuplicateUuidRunner = container.fixDuplicateUuidRunner;
            assertTypeEquals(fixDuplicateUuidRunner, FixDuplicateUuidRunner);
            await fixDuplicateUuidRunner.processAsync();

            // Check patient 1
            const persons = await collection.find({ _uuid: person1Resource._uuid }).toArray();
            expect(persons.length).toEqual(1);
            delete persons[0]._id;
            expect(persons[0]).toEqual(person3Resource);
        });

        test('duplicate uuid not present in resources', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9e' },
                expectedPerson1
            );

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixDuplicateUuidRunner',
                (c) =>
                    new FixDuplicateUuidRunner({
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
                        useTransaction: true
                    })
            );

            /**
             * @type {FixDuplicateUuidRunner}
             */
            const fixDuplicateUuidRunner = container.fixDuplicateUuidRunner;
            assertTypeEquals(fixDuplicateUuidRunner, FixDuplicateUuidRunner);
            await fixDuplicateUuidRunner.processAsync();

            // Check patient 1
            const persons = await collection.find({ _uuid: person1Resource._uuid }).toArray();
            expect(persons.length).toEqual(1);
            delete persons[0]._id;
            expect(persons[0]).toEqual(person1Resource);
        });

        test('duplicate uuid with same value in multiple collections', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();
            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const personCollection = await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9e' },
                expectedPerson1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9f' },
                expectedPerson1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...person1Resource, _id: '64e5aca92964a96e08066a9g' },
                expectedPerson1
            );

            const patientCollection = await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...patient1Resource, _id: '64e5aca92964a96e08066a9e' },
                expectedPatient1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...patient1Resource, _id: '64e5aca92964a96e08066a9f' },
                expectedPatient1
            );
            await setupDatabaseAsync(
                mongoDatabaseManager,
                { ...patient1Resource, _id: '64e5aca92964a96e08066a9g' },
                expectedPatient1
            );

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixDuplicateUuidRunner',
                (c) =>
                    new FixDuplicateUuidRunner({
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
                        useTransaction: true
                    })
            );

            /**
             * @type {FixDuplicateUuidRunner}
             */
            const fixDuplicateUuidRunner = container.fixDuplicateUuidRunner;
            assertTypeEquals(fixDuplicateUuidRunner, FixDuplicateUuidRunner);
            await fixDuplicateUuidRunner.processAsync();

            // Check patient 1
            const persons = await personCollection.find({ _uuid: person1Resource._uuid }).toArray();
            expect(persons.length).toEqual(1);

            const patients = await patientCollection.find({ _uuid: patient1Resource._uuid }).toArray();
            expect(patients.length).toEqual(1);
        });
    });
});
