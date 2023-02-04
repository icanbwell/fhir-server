// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation search_prefer_global_id Tests', () => {
        test('search_prefer_global_id works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            const headers = getHeaders();
            headers['Prefer'] = 'global_id=true';
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
    });
});
