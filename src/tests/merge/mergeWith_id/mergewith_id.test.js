// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');

const {assertStatusOk, expectResponse, expectMergeResponse} = require('../../fhirAsserts');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person mergeWith_id Tests', () => {
        test('mergeWith_id works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders())
                .expect(assertStatusOk());
            expectResponse({resp, expected: expectedPersonResources});
        });
    });
});
