// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation history Tests', () => {
        test('History works even when used without id', async () => {
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
            await observationHistoryCollection.insertOne(observation2Resource);

            // Only 1 observation's history is returned as second one has hidden tag
            const resp = await request
                .get('/4_0_0/Observation/_history?_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
    });
});
