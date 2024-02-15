// provider file
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('ObservationReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation Search By Quantity Tests', () => {
        test('search by quantity works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by quantity value|system|code and make sure we get the right observation back
            resp = await request
                .get(
                    '/4_0_0/Observation?value-quantity=75|http://unitsofmeasure.org|mm[Hg]&_setIndexHint=1&_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
    });
});
