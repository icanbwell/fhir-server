#set($ResourceNameLower = $ResourceName.toLowerCase())
#set($dollar = "$")

// test file
const ${ResourceNameLower}1Resource = require('./fixtures/${ResourceName}/${ResourceNameLower}1.json');

// expected
const expected${ResourceName}Resources = require('./fixtures/expected/expected_${ResourceName}.json');

const {assertStatusOk, assertResponse, assertMerge} = require('../../fhirAsserts');
const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');

describe('${ResourceName} Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('${ResourceName} ${NAME} Tests', () => {
        test('${NAME} works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            await request
                .post('/4_0_0/${ResourceName}/1/${dollar}merge?validate=true')
                .send(${ResourceNameLower}1Resource)
                .set(getHeaders())
                .expect(assertMerge({ created: true}));

            // ACT & ASSERT
            // search by token system and code and make sure we get the right ${ResourceName} back
            await request
                .get('/4_0_0/${ResourceName}/?_bundle=1&[write_query_here]')
                .set(getHeaders())
                .expect(assertStatusOk())
                .expect(assertResponse({ expected: expected${ResourceName}Resources }));
        });
    });
});
