// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');

// expected
const expectedPractitionerResources = require('./fixtures/expected/expected_Practitioner.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {assertCompareBundles} = require('../../fhirAsserts');

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner update Tests', () => {
        test('update works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(201);

            practitioner1Resource['active'] = false;

            await request
                .put('/4_0_0/Practitioner/1679033641')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(200);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            let resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles(resp.body, expectedPractitionerResources);
        });
    });
});
