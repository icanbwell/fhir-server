// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation historyById Tests', () => {
        test('historyById works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Observation_4_0_0_History';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const observationHistoryCollection = fhirDb.collection(collectionName);
            await observationHistoryCollection.insertOne(observation1Resource);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            let resp = await request
                .get('/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
    });
});
