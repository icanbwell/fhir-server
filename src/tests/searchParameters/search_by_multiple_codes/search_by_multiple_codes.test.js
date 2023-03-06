// test file
const task1Resource = require('./fixtures/Task/task1.json');
const task2Resource = require('./fixtures/Task/task2.json');

// expected
const expectedTaskResources = require('./fixtures/expected/expected_Task.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Multiple codes for task Ttests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Task search_by_multiple_codes.js Tests', () => {
        test('Searching task with multiple codes work', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Task/1/$merge?validate=true')
                .send(task2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right task back
            resp = await request
                .get('/4_0_0/Task/?code=health-activity,care-need&_bundle=1')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedTaskResources);
        });
    });
});
