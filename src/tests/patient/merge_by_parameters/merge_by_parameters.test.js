// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {assertStatusCode, assertResourceCount, assertMerge, assertResponse} = require('../../fhirAsserts');

describe('Merge By Parameters Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Merge By Parameters Tests', () => {
        test('merge by parameters works', async () => {
            const request = await createTestRequest();
            await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(assertStatusCode(200))
                .expect(assertResourceCount(0));

            await request
                .post('/4_0_0/Patient/1679033641/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(200))
                .expect(assertMerge([{created: true}]));

            await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(assertStatusCode(200))
                .expect(assertResourceCount(1));

            await request
                .get('/4_0_0/Patient/00100000000')
                .set(getHeaders())
                .expect(200)
                .expect(assertResponse(expectedSinglePatientResource));
        });
    });
});
