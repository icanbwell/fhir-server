// test file
const person1Resource = require('./fixtures/Person/person.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

// expected
const expectedPersonDatabaseBeforeRun = require('./fixtures/expected/expected_person_before_run.json');
const expectedPatient1DatabaseBeforeRun = require('./fixtures/expected/expected_patient1_before_run.json');
const expectedPatient2DatabaseBeforeRun = require('./fixtures/expected/expected_patient2_before_run.json');

const expectedPersonDatabaseAfterRun = require('./fixtures/expected/expected_person.json');
const expectedPatient1DatabaseAfterRun = require('./fixtures/expected/expected_patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {FixReferenceIdRunner} = require('../../../../admin/runners/fixReferenceIdRunner');
const {assertTypeEquals} = require('../../../../utils/assertType');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, personResource, expectedPersonInDatabase, collectionName) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(collectionName);
    await collection.insertOne(personResource);

    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: personResource.id});

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

    describe('Person fixReferenceId Tests', () => {
        test('fixReferenceId works for patient', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithoutGlobalId());
                return c;
            });
            const container = getTestContainer();

            // insert directly into database instead of going through merge() so we simulate old records
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const personCollection = await setupDatabaseAsync(
                mongoDatabaseManager, person1Resource, expectedPersonDatabaseBeforeRun,
                'Person_4_0_0'
            );
            const patientCollection = await setupDatabaseAsync(
                mongoDatabaseManager, patient1Resource, expectedPatient1DatabaseBeforeRun,
                'Patient_4_0_0'
            );
            await setupDatabaseAsync(
                mongoDatabaseManager, patient2Resource, expectedPatient2DatabaseBeforeRun,
                'Patient_4_0_0'
            );

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdRunner', (c) => new FixReferenceIdRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        preloadCollections: ['Patient_4_0_0'],
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger
                    }
                )
            );

            /**
             * @type {FixReferenceIdRunner}
             */
            const fixReferenceIdRunner = container.fixReferenceIdRunner;
            assertTypeEquals(fixReferenceIdRunner, FixReferenceIdRunner);
            await fixReferenceIdRunner.processAsync();

            // person references are changed to new id
            const person = await personCollection.findOne({ id: person1Resource.id });

            expect(person).toBeDefined();
            delete person._id;
            expect(person.meta).toBeDefined();
            delete person.meta.lastUpdated;

            expect(person).toEqual(expectedPersonDatabaseAfterRun);

            // patient with old id is not present
            let patient = await patientCollection.findOne({ id: patient1Resource.id });

            expect(patient).toBeNull();

            // patient with new id is present
            patient = await patientCollection.findOne({ id: expectedPatient1DatabaseAfterRun.id });

            expect(patient).toBeDefined();
            delete patient._id;
            expect(patient.meta).toBeDefined();
            delete patient.meta.lastUpdated;

            expect(patient).toEqual(expectedPatient1DatabaseAfterRun);

            // only proa patient with id length 63 is changed others are not
            patient = await patientCollection.findOne({ id: expectedPatient2DatabaseBeforeRun.id });

            expect(patient).toBeDefined();
            delete patient._id;
            expect(patient.meta).toBeDefined();
            delete patient.meta.lastUpdated;

            expect(patient).toEqual(expectedPatient2DatabaseBeforeRun);
        });
    });
});
