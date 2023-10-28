// test file
const bundle1Resource = require('./fixtures/Bundle/bundle1.json');

// expected
const expectedBundleValidation = require('./fixtures/expected/expected_bundle_validation.json');

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
        test('bundle validates with long id for resource 4', async () => {
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
            expect(resp).toHaveResponse(expectedBundleValidation);
        });
        test('bundle saves with long id for resource 4', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Bundle')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Bundle/1/$merge')
                .send(bundle1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
        });
    });
});
