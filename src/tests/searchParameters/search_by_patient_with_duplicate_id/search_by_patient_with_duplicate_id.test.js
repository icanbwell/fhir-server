// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationByOwnerResources = require('./fixtures/expected/expected_observation_by_owner.json');
const expectedObservationByAccessResources = require('./fixtures/expected/expected_observation_by_access.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }
}

describe('Observation Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation search_by_patient_with_duplicate_id Tests', () => {
        test('search_by_patient_with_duplicate_id adds two resources with same id', async () => {
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
            expect(resp).toHaveMergeResponse({ created: true });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .get('/4_0_0/Observation/?_debug=1&patient=Patient/2354|C')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByOwnerResources);

            // search by id but with token limited to one access security tag should return 1
            resp = await request
                .get('/4_0_0/Observation/1/?_debug=1&patient=Patient/2354|C')
                .set(getHeaders('user/*.read user/*.write access/C.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByAccessResources);
        });
    });
});
