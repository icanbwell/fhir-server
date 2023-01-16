// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservationAllResources = require('./fixtures/expected/expected_observation_all.json');
const expectedObservationAllByIdResources = require('./fixtures/expected/expected_observation_all_by_id.json');
const expectedObservationsInDatabase = require('./fixtures/expected/expected_observation_in_database.json');

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
}

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation merge_with_id_greater_than_64 Tests', () => {
        test('merge_with_id_greater_than_64 adds two resources with same id', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});

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
            const results = await collection.find({}).sort({id: 1}).toArray();
            // const resultsJson = JSON.stringify(results);

            expect(results.length).toStrictEqual(2);
            for (const resource of results) {
                delete resource._id;
                delete resource.meta.lastUpdated;
                resource._uuid = '11111111-1111-1111-1111-111111111111';
            }
            for (const resource of expectedObservationsInDatabase) {
                delete resource._id;
                delete resource.meta.lastUpdated;
                resource._uuid = '11111111-1111-1111-1111-111111111111';
            }
            expect(results).toStrictEqual(expectedObservationsInDatabase);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationAllResources);

            // search by owner security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&id=12345678901234567890123456789012345678901234567890123456789012345678901234567890&_security=https://www.icanbwell.com/owner|C')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by sourceAssigningAuthority security tag should only return 1
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_debug=1&id=12345678901234567890123456789012345678901234567890123456789012345678901234567890&_security=https://www.icanbwell.com/sourceAssigningAuthority|C')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by id but no security tag should return both
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&id=12345678901234567890123456789012345678901234567890123456789012345678901234567890&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationAllByIdResources);

            // search by id but with token limited to one access security tag should return 1
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&id=12345678901234567890123456789012345678901234567890123456789012345678901234567890')
                .set(getHeaders('user/*.read user/*.write access/C.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

        });
    });
});
