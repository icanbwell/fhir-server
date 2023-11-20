// provider file
const task1Resource = require('./fixtures/task/task1.json');

// expected
const expectedTaskResource = require('./fixtures/expected/expected_task.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Task Period Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Task Search By period Tests', () => {
        test('search by period works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Task/1/$merge')
                .send(task1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right observation back
            resp = await request
                .get(
                    '/4_0_0/Task?period=2023-05-10&_bundle=1&_debug=1'
                )
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedTaskResource);
        });
    });
});
