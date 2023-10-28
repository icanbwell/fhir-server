// test file
const bundle1Resource = require('./fixtures/Bundle/bundle1.json');

// expected
const expectedBundleResources = require('./fixtures/expected/expected_bundle.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Bundle Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Bundle bundle Tests', () => {
        test('bundle works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Bundle')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Bundle/$validate')
                .send(bundle1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedBundleResources);
        });
    });
});
