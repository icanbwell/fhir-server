// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');

// expected
const expectedPractitionerResources = require('./fixtures/expected/expected_Practitioner.json');
const expectedPractitionerContainsResources = require('./fixtures/expected/expected_Practitioner_contains.json');
const expectedPractitionerByGenderResources = require('./fixtures/expected/expected_Practitioner_gender.json');
const expectedPractitionerBySystemResources = require('./fixtures/expected/expected_Practitioner_by_system.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner search_by_identifier Tests', () => {
        test('search_by_identifier works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&identifier=http://clienthealth.org|4657&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResources);
        });
        test('search with contains works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&gender:contains=nk&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerByGenderResources);
        });
        test('search_by_identifier with contains works on just value', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&identifier:contains=465&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerContainsResources);
        });
        test('search_by_identifier with contains works on system and value', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // now search by both value and system
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1&identifier:contains=clienthealth|465&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerBySystemResources);
        });
    });
});
