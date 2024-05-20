const expectedResponse = require('./fixtures/expected/expected_response.json');

const explanationOfBenefitsResource = require('./fixtures/explanation_of_benefits/explanation_of_benefits.json');
const graphDefinitionResource = require('./fixtures/graph_definition/graph_definition.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('No invalid collections made through Graph endpoint Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('No invalid collections should be made through $graph endpoint', () => {
        test('Test on explanation of benefit resource', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo fhirDb connection
             * @type {import('mongodb').Db}
             */
            const db = await mongoDatabaseManager.getClientDbAsync();
            let collections = await db.listCollections().toArray();
            // Check that initially there are no collections in db.
            expect(collections.length).toEqual(0);

            let resp = await request
                .post('/4_0_0/ExplanationOfBenefit/$merge')
                .send(explanationOfBenefitsResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/$graph?id=WPS-Claim-230916613369&contained=true')
                .send(graphDefinitionResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // Check that after the above requests, only person & person history collection is made in db.
            collections = await db.listCollections().toArray();
            const collectionNames = collections.map(collection => collection.name);
            expect(collectionNames).toEqual(expect.arrayContaining([
                'Person_4_0_0', 'ExplanationOfBenefit_4_0_0'
            ]));
        });
    });
});
