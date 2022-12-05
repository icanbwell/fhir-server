const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHtmlHeadersWithAdminToken,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test } = require('@jest/globals');

describe('Patient UI Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests', () => {
        test('admin search fails without scope', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/admin?id=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
        });
        test('admin search passes with scope', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/admin?id=1').set(getHtmlHeadersWithAdminToken());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
        });
    });
});
