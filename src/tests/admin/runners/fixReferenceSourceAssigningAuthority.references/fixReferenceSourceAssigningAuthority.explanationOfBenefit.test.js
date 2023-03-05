// test file
const explanationOfBenefit1Resource = require('./fixtures/ExplanationOfBenefit/explanationOfBenefit1.json');

// expected
const expectedExplanationOfBenefit1DatabaseBeforeRun = require('./fixtures/expected/expected_explanationOfBenefit1_in_database_before_run.json');
const expectedExplanationOfBenefit1DatabaseAfterRun = require('./fixtures/expected/expected_explanationOfBenefit1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {IdentifierSystem} = require('../../../../utils/identifierSystem');
const {assertTypeEquals} = require('../../../../utils/assertType');
const {FixReferenceSourceAssigningAuthorityRunner} = require('../../../../admin/runners/fixReferenceSourceAssigningAuthorityRunner');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, explanationOfBenefitResource, expectedExplanationInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection('ExplanationOfBenefit_4_0_0');
    await collection.insertOne(explanationOfBenefitResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: explanationOfBenefitResource.id});
    // const resultsJson = JSON.stringify(results);

    delete resource._id;

    explanationOfBenefitResource.meta.lastUpdated = resource.meta.lastUpdated;

    expect(resource).toStrictEqual(expectedExplanationInDatabase);
    return collection;
}

describe('ExplanationOfBenefit Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ExplanationOfBenefit fixReferenceSourceAssigningAuthority Tests', () => {
        test('fixReferenceSourceAssigningAuthority works for patient 1', async () => {
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
            const collection = await setupDatabaseAsync(
                mongoDatabaseManager, explanationOfBenefit1Resource, expectedExplanationOfBenefit1DatabaseBeforeRun
            );

            // run admin runner

            const collections = ['all'];
            const batchSize = 10000;

            container.register(
                'fixReferenceSourceAssigningAuthorityRunner',
                (c) => new FixReferenceSourceAssigningAuthorityRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections: collections,
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
            const explanationOfBenefit1 = await collection.findOne({id: explanationOfBenefit1Resource.id});
            expect(explanationOfBenefit1).toBeDefined();
            delete explanationOfBenefit1._id;
            expect(explanationOfBenefit1._uuid).toBeDefined();
            expectedExplanationOfBenefit1DatabaseAfterRun._uuid = explanationOfBenefit1._uuid;
            expect(explanationOfBenefit1.meta).toBeDefined();
            expect(explanationOfBenefit1.meta.lastUpdated).toBeDefined();
            expect(explanationOfBenefit1.meta.lastUpdated).not.toStrictEqual(expectedExplanationOfBenefit1DatabaseAfterRun.meta.lastUpdated);
            expectedExplanationOfBenefit1DatabaseAfterRun.meta.lastUpdated = explanationOfBenefit1.meta.lastUpdated;
            expectedExplanationOfBenefit1DatabaseAfterRun.identifier
                .filter(i => i.system === IdentifierSystem.uuid)[0]
                .value = explanationOfBenefit1._uuid;
            expect(explanationOfBenefit1).toStrictEqual(expectedExplanationOfBenefit1DatabaseAfterRun);
        });
    });
});
