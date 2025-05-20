// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedReplacedPersonResources = require('./fixtures/expected/expected_Replaced_Phone.json');

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
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Step 2: Replace with a new version (simulate PUT)
        const updatedResource = deepcopy(person1Resource);
        // Update the phone number for each person in the array
        updatedResource.forEach((person) => {
            if (Array.isArray(person.telecom)) {
                const phoneEntry = person.telecom.find((t) => t.system === 'phone');
                if (phoneEntry) {
                    phoneEntry.value = '+15555550123'; // new phone number
                }
            }
        });

        resp = await request
            .post('/4_0_0/Person/1/$merge?smartMerge=false')
            .send(updatedResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        // // Step 3: Assert the resource is fully replaced (not merged)
        resp = await request.get('/4_0_0/Person/?_bundle=1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedReplacedPersonResources);
    });
});
