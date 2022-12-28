// test file
const codesystem1Resource = require('./fixtures/CodeSystem/codesystem.json');

// expected
const expectedCodeSystemResources = require('./fixtures/expected/expected_codesystem.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('CodeSystem Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('CodeSystem concurrency_issue Tests', () => {
        test('concurrency_issue works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge?validate=true')
                .send(codesystem1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right CodeSystem back
            resp = await request
                .get('/4_0_0/CodeSystem/?_bundle=1&[write_query_here]')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCodeSystemResources);
        });
    });
});
