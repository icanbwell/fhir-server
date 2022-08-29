// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');

// expected
const expectedPractitionerResources = require('./fixtures/expected/expected_Practitioner.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {assertStatusOk, assertStatusCode, assertResponse} = require('../../fhirAsserts');

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
            const resp = await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(201));

            // get generated id from response
            const location = resp.headers['content-location'];
            const id = location.split('/').splice(5, 1)[0];

            practitioner1Resource['id'] = id;
            practitioner1Resource['active'] = false;

            await request
                .put(`/4_0_0/Practitioner/${id}`)
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(assertStatusOk());

            expectedPractitionerResources.entry[0].resource.id = id;
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            await request
                .get('/4_0_0/Practitioner/?_bundle=1')
                .set(getHeaders())
                .expect(assertResponse(expectedPractitionerResources));
        });
    });
});
