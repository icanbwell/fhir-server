// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');
const practitioner2Resource = require('./fixtures/Practitioner/practitioner2.json');

// expected
const expectedPractitionerIdentifierMissingFalse = require('./fixtures/expected/expected_practitioner_identifier_missing_false.json');
const expectedPractitionerIdentifierMissingTrue = require('./fixtures/expected/expected_practitioner_identifier_missing_true.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach } = require('@jest/globals');
const { assertCompareBundles, assertMergeIsSuccessful } = require('../../fhirAsserts');

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner search_by_identifier_missing Tests', () => {
        test('search_by_identifier_missing works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Practitioner/2/$merge?validate=true')
                .send(practitioner2Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&identifier:missing=false')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles({
                body: resp.body,
                expected: expectedPractitionerIdentifierMissingFalse,
            });

            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&identifier:missing=true')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles({
                body: resp.body,
                expected: expectedPractitionerIdentifierMissingTrue,
            });
        });
    });
});
