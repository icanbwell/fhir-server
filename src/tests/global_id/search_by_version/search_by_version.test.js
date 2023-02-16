// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservation1 = require('./fixtures/expected/expected_observation_1.json');
const expectedObservationHistoryInDatabase = require('./fixtures/expected/expected_observation_history_database.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getRequestId
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }
}

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation history_by_version Tests', () => {
        test('history_by_version works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
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
            const observationHistoryItem = await observationHistoryCollection.findOne({});
            expectedObservationHistoryInDatabase._id = observationHistoryItem._id;
            expectedObservationHistoryInDatabase.request.id = getRequestId(resp);
            expectedObservationHistoryInDatabase.id = observationHistoryItem.id;
            expectedObservationHistoryInDatabase.resource.meta.lastUpdated = observationHistoryItem.resource.meta.lastUpdated;
            expect(observationHistoryItem).toStrictEqual(expectedObservationHistoryInDatabase);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Observation/0028735c-80ac-4d14-9e35-a097d01b0b28/_history')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            resp = await request
                .get('/4_0_0/Observation/0028735c-80ac-4d14-9e35-a097d01b0b28/_history/15')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservation1);
        });
    });
});
