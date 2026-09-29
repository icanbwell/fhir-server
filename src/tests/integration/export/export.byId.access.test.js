const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockK8sClient } = require('./mocks/k8sClient');

describe('Export byId access tests', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    test('a caller who did not start the export cannot poll its status (SEC-1580 F7)', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({
                configManager: c.configManager
            }));
            return c;
        });

        const createResp = await request
            .post('/4_0_0/$export?_type=Patient')
            .set(getHeaders())
            .expect(202);

        expect(createResp.headers['content-location']).toBeDefined();
        const exportStatusId = createResp.headers['content-location'].split('/').pop();

        // the same user who started the export can poll it
        await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeaders())
            .expect(202);

        // a different authenticated user, with equally broad scopes, must not be able to
        // poll (or thereby confirm the existence of) someone else's export job
        const otherUserResp = await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeadersWithCustomPayload({
                username: 'attacker',
                scope: 'user/*.read user/*.write access/*.*',
                token_use: 'access'
            }));

        expect(otherUserResp.status).toStrictEqual(404);
    });

    test('polling a export id that does not exist at all returns the same 404', async () => {
        const request = await createTestRequest();

        const resp = await request
            .get('/4_0_0/$export/11111111-2222-5333-8444-555555555555')
            .set(getHeadersWithCustomPayload({
                username: 'attacker',
                scope: 'user/*.read user/*.write access/*.*',
                token_use: 'access'
            }));

        expect(resp.status).toStrictEqual(404);
    });
});
