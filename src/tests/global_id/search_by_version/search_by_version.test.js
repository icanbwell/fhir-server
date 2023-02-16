// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservations1 = require('./fixtures/expected/expected_observations_1.json');
const expectedObservations2 = require('./fixtures/expected/expected_observations_2.json');
const expectedObservation1 = require('./fixtures/expected/expected_observation_1.json');
const expectedObservationHistoryInDatabase1 = require('./fixtures/expected/expected_observation_history_database_1.json');
const expectedObservation2 = require('./fixtures/expected/expected_observation_2.json');
const expectedObservationHistoryInDatabase2 = require('./fixtures/expected/expected_observation_history_database_2.json');

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
        test('history_by_version works when id is uuid', async () => {
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
            expectedObservationHistoryInDatabase1._id = observationHistoryItem._id;
            expectedObservationHistoryInDatabase1.request.id = getRequestId(resp);
            expectedObservationHistoryInDatabase1.id = observationHistoryItem.id;
            expectedObservationHistoryInDatabase1.resource.meta.lastUpdated = observationHistoryItem.resource.meta.lastUpdated;
            expect(observationHistoryItem).toStrictEqual(expectedObservationHistoryInDatabase1);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Observation/0028735c-80ac-4d14-9e35-a097d01b0b28/_history')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservations1);

            resp = await request
                .get('/4_0_0/Observation/_history?id=0028735c-80ac-4d14-9e35-a097d01b0b28')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservations1);

            resp = await request
                .get('/4_0_0/Observation/0028735c-80ac-4d14-9e35-a097d01b0b28/_history/1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservation1);
        });
        test('history_by_version works when id is not uuid', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
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
            expectedObservationHistoryInDatabase2._id = observationHistoryItem._id;
            expectedObservationHistoryInDatabase2.request.id = getRequestId(resp);
            expectedObservationHistoryInDatabase2.id = observationHistoryItem.id;
            expectedObservationHistoryInDatabase2.resource.meta.lastUpdated = observationHistoryItem.resource.meta.lastUpdated;
            expect(observationHistoryItem).toStrictEqual(expectedObservationHistoryInDatabase2);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Observation/123/_history')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservations2);

            resp = await request
                .get('/4_0_0/Observation/_history?id=123')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservations2);

            resp = await request
                .get('/4_0_0/Observation/d3adcaf2-1161-5f9c-8fbd-3148b9eb2122/_history')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservations2);

            resp = await request
                .get('/4_0_0/Observation/_history?id=d3adcaf2-1161-5f9c-8fbd-3148b9eb2122')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservations2);

            resp = await request
                .get('/4_0_0/Observation/123/_history/1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservation2);

            resp = await request
                .get('/4_0_0/Observation/d3adcaf2-1161-5f9c-8fbd-3148b9eb2122/_history/1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservation2);
        });
    });
});
