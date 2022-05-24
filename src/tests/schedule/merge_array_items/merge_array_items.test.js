const supertest = require('supertest');

const {app} = require('../../../app');
// test file
const schedule1Resource = require('./fixtures/Schedule/schedule1.json');
const schedule2Resource = require('./fixtures/Schedule/schedule2.json');

// expected
const expectedScheduleResources = require('./fixtures/expected/expected_Schedule.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders} = require('../../common');
const {assertCompareBundles, assertMergeIsSuccessful} = require('../../fhirAsserts');

describe('Schedule Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Schedule merge_array_items Tests', () => {
        test('merge_array_items works', async () => {
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Schedule/1/$merge?validate=true')
                .send(schedule1Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body);

            resp = await request
                .post('/4_0_0/Schedule/1/$merge?validate=true')
                .send(schedule2Resource)
                .set(getHeaders())
                .expect(200);
            assertMergeIsSuccessful(resp.body, false);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Schedule back
            resp = await request
                .get('/4_0_0/Schedule/?_bundle=1')
                .set(getHeaders())
                .expect(200);
            assertCompareBundles(resp.body, expectedScheduleResources);
        });
    });
});
