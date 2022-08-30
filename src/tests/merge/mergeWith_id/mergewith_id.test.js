// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');

const { assertStatusOk, assertResponse, assertMerge } = require('../../fhirAsserts');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach } = require('@jest/globals');

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
            await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(assertMerge({ created: true }));

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders())
                .expect(assertStatusOk())
                .expect(assertResponse({ expected: expectedPersonResources }));
        });
    });
});
