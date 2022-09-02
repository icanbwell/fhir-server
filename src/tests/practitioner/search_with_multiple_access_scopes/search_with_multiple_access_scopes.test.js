// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');
const practitioner2Resource = require('./fixtures/Practitioner/practitioner2.json');
const practitioner3Resource = require('./fixtures/Practitioner/practitioner3.json');

// expected
const expectedPractitionerWithLimitedAccessScopes = require('./fixtures/expected/expected_practitioner_with_limited_access_scopes.json');
const expectedPractitionerWithUnlimitedAccessScopes = require('./fixtures/expected/expected_practitioner_with_unlimited_access_scopes.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner search_by_multiple_access_scopes Tests', () => {
        test('search_by_multiple_access_scopes works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/2/$merge?validate=true')
                .send(practitioner2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/3/$merge?validate=true')
                .send(practitioner3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1')
                .set(getHeaders('user/Practitioner.read access/medstar.* access/nppes.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerWithLimitedAccessScopes);

            // now search by full access token and make sure we get all three back
            resp = await request
                .get('/4_0_0/Practitioner/?_bundle=1')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerWithUnlimitedAccessScopes);
        });
    });
});
