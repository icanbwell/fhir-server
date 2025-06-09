// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedPersonResources1 = require('./fixtures/expected/expectedPerson1.json');
const expectedPersonResources2 = require('./fixtures/expected/expectedPerson2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search using uuid as default sort id Tests', () => {
        test('Search person using uuid as default sort id ', async () => {
            const DEFAULT_SORT_ID = process.env.DEFAULT_SORT_ID;
            process.env.DEFAULT_SORT_ID = '_uuid';

            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Fetch two resources at a time.
            const response = await request
                .get('/4_0_0/Person/?_count=2&_total=accurate&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(response).toHaveResponse(expectedPersonResources1);

            // Get the next set of resources based on id:above logic.
            resp = await request
                .get('/4_0_0/Person/?_count=2&_total=accurate&_bundle=1&id%3Aabove=9b3326ba-2421-4b9a-9d57-1eba0481cbd4&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources2);

            process.env.DEFAULT_SORT_ID = DEFAULT_SORT_ID;
        });
    });
});
