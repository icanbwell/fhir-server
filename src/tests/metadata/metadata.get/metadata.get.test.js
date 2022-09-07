// expected
const expectedMetaResources = require('./fixtures/expected/expected_Meta.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Meta Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Meta metadata.get Tests', () => {
        test('metadata.get works', async () => {
            const request = await createTestRequest();
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Meta back
            let resp = await request
                .get('/4_0_0/metadata')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMetaResources);
        });
    });
});
