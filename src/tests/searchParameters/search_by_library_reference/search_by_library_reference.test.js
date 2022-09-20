// test file
const measure1Resource = require('./fixtures/Measure/measure1.json');
const measure2Resource = require('./fixtures/Measure/measure2.json');

const expectedMeasure1Resource = require('./fixtures/expected/expected_measure.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Measure Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Reference search_by_library Tests', () => {
        test('search_by_library works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Measure/$merge')
                .send(measure1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Measure/$merge')
                .send(measure2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Measure/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request
                .get('/4_0_0/Measure?depends-on=https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMeasure1Resource);
        });
    });
});
