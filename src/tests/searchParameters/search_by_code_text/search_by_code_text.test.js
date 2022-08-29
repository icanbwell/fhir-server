// test file
const medication1Resource = require('./fixtures/Medication/medication1.json');
const medication2Resource = require('./fixtures/Medication/medication2.json');
const medication3Resource = require('./fixtures/Medication/medication3.json');

// expected
const expectedMedicationResources = require('./fixtures/expected/expected_Medication.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {assertCompareBundles, assertMergeIsSuccessful} = require('../../fhirAsserts');

describe('Medication Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Medication search_by_code_text Tests', () => {
        test('search_by_code_text works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication1Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication2Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication3Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Medication/?_bundle=1&code:text=prednisoLONE&_debug=1')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles({
                body: resp.body, expected: expectedMedicationResources
            });
        });
    });
});
