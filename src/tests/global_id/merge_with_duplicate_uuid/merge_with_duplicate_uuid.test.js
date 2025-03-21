// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservationAllResources = require('./fixtures/expected/expected_observation_all.json');

const expectedObservationsInDatabase = require('./fixtures/expected/expected_observation_in_database.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Observation Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation merge_with_duplicate_uuid Tests', () => {
        test('merge_with_duplicate_uuid adds only one resource with same uuid', async () => {
            const request = await createTestRequest();

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ updated: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // check that two entries were stored in the database
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const collection = fhirDb.collection('Observation_4_0_0');
            /**
             * @type {Object[]}
             */
            const results = await collection.find({}).sort({ id: 1 }).toArray();
            // const resultsJson = JSON.stringify(results);

            expect(results.length).toStrictEqual(1);
            for (const resource of results) {
                delete resource._id;
                delete resource.meta.lastUpdated;
            }
            for (const resource of expectedObservationsInDatabase) {
                delete resource._id;
                delete resource.meta.lastUpdated;
            }
            expectedObservationsInDatabase[0].issued = new Date(expectedObservationsInDatabase[0].issued);
            expect(results).toStrictEqual(expectedObservationsInDatabase);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationAllResources);

            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&id=daf63d7b-4e99-4133-bd3f-83e24bf7987a&_security=https://www.icanbwell.com/owner|A')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
    });
});
