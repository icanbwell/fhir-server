const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getHeadersWithAdminToken,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test } = require('@jest/globals');

describe('Show Indexes UI Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Show Indexes Tests', () => {
        test('admin search fails without scope', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/admin/showIndexes?id=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
        });
        test('admin search passes with scope', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/admin/showIndexes?id=1').set(getHeadersWithAdminToken());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
        });
    });
});
