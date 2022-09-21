// test file
const schedule1Resource = require('./fixtures/Schedule/schedule1.json');
const schedule2Resource = require('./fixtures/Schedule/schedule2.json');

// expected
const expectedScheduleResources = require('./fixtures/expected/expected_Schedule.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Schedule Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Schedule merge_array_items Tests', () => {
        test('merge_array_items works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Schedule/1/$merge?validate=true')
                .send(schedule1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Schedule/1/$merge?validate=true')
                .send(schedule2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({updated: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Schedule back
            resp = await request.get('/4_0_0/Schedule/?_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedScheduleResources);
        });
    });
});
