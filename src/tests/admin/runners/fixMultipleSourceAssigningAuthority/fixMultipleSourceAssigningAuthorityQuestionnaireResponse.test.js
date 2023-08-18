// test file
const questionnaireResponse1Resource = require('./fixtures/QuestionnaireResponse/questionnaireResponse1.json');

// expected
const expectedquestionnaireResponse1InDatabaseBeforeRun = require('./fixtures/expected/expectedQuestionnaireResponse1BeforeRun.json');

const expectedquestionnaireResponse1DatabaseAfterRun = require('./fixtures/expected/expectedQuestionnaireResponse1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {ConfigManager} = require('../../../../utils/configManager');
const {FixMultipleSourceAssigningAuthorityRunner} = require('../../../../admin/runners/fixMultipleSourceAssigningAuthorityRunner');

class MockConfigManagerWithoutGlobalId extends ConfigManager {
    get enableGlobalIdSupport() {
        return false;
    }

    get enableReturnBundle() {
        return true;
    }
}

async function setupDatabaseAsync(mongoDatabaseManager, incomingResource, expectedResourceInDatabase) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(`${incomingResource.resourceType}_4_0_0`);
    await collection.insertOne(incomingResource);

    // ACT & ASSERT
    // check that two entries were stored in the database
    /**
     * @type {import('mongodb').WithId<import('mongodb').Document> | null}
     */
    const resource = await collection.findOne({id: incomingResource.id});

    delete resource._id;

    incomingResource.meta.lastUpdated = resource.meta.lastUpdated;

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

    describe('QuestionnaireResponse fixMultipleSourceAssigningAuthority Tests', () => {
        test('fixMultipleSourceAssigningAuthority works for QuestionnaireResponse', async () => {
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
            let questionnaireResponseCollection = await setupDatabaseAsync(
                mongoDatabaseManager, questionnaireResponse1Resource, expectedquestionnaireResponse1InDatabaseBeforeRun
            );

            // run admin runner

            let collections = ['QuestionnaireResponse_4_0_0'];
            const batchSize = 10000;

            container.register('fixMultipleSourceAssigningAuthorityRunner', (c) => new FixMultipleSourceAssigningAuthorityRunner(
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
             * @type {FixMultipleSourceAssigningAuthorityRunner}
             */
            const fixMultipleSourceAssigningAuthorityRunner = container.fixMultipleSourceAssigningAuthorityRunner;
            expect(fixMultipleSourceAssigningAuthorityRunner).toBeInstanceOf(FixMultipleSourceAssigningAuthorityRunner);
            await fixMultipleSourceAssigningAuthorityRunner.processAsync();

            // Check questionnaireResponse 1
            const questionnaireResponse1 = await questionnaireResponseCollection.findOne({id: questionnaireResponse1Resource.id});
            expect(questionnaireResponse1).toBeDefined();
            delete questionnaireResponse1._id;
            expect(questionnaireResponse1).toStrictEqual(expectedquestionnaireResponse1DatabaseAfterRun);
        });
    });
});
