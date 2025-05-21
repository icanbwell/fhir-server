// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person1DuplicatePhoneNumber = require('./fixtures/Person/person1_duplicate_phone.json');

// expected
const expectedReplacedPersonResources = require('./fixtures/expected/expected_Replaced_Phone.json');
const expectedMergedPersonResources = require('./fixtures/expected/expected_merged_Phone.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Person Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('bulk replace with smartMerge=false simulates bulk PUT', async () => {
        const request = await createTestRequest();

        person1Resource[0].meta.source = 'bwell';

        // Step 1: Create initial resource
        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Step 2: Merge with a new version, it would add a new phone number
        const resp2 = await request
            .post('/4_0_0/Person/1/$merge')
            .send(person1DuplicatePhoneNumber)
            .set(getHeaders());
        expect(resp2).toHaveMergeResponse({ created: false });

        // Step 3: Verify the resource is updated
        const resp3 = await request.get('/4_0_0/Person/?_bundle=1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp3).toHaveResponse(expectedMergedPersonResources);

        // Step 4: Replace with a new version (simulate PUT)
        const resp4 = await request
            .post('/4_0_0/Person/1/$merge?smartMerge=false')
            .send(person1DuplicatePhoneNumber)
            .set(getHeaders());
        expect(resp4).toHaveMergeResponse({ created: false });

        // Step 5: Assert the resource is fully replaced (not merged)
        const resp5 = await request.get('/4_0_0/Person/?_bundle=1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp5).toHaveResponse(expectedReplacedPersonResources);

    });
});
