const expectedResponses = {
    expected_denied_write_only: require('./fixtures/expected/expected_denied_write_only.json'),
    expected_denied_without_task_c: require('./fixtures/expected/expected_denied_without_task_c.json'),
    expected_denied_access_gate_r_only: require('./fixtures/expected/expected_denied_access_gate_r_only.json')
};

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockK8sClient } = require('../mocks/k8sClient');

describe('$export v2 CRUDS scope granularity Tests', () => {
    let originalFlag;

    beforeAll(() => {
        originalFlag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
    });

    afterAll(() => {
        if (originalFlag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalFlag;
        }
    });

    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    const createRequestWithMockK8s = () => createTestRequest((c) => {
        c.register('k8sClient', (c) => new MockK8sClient({
            configManager: c.configManager
        }));
        return c;
    });

    test('a search grant plus c on Task can start an export and poll its status', async () => {
        const request = await createRequestWithMockK8s();
        const scope = 'user/*.rs user/Task.c access/client.s';

        const createResp = await request
            .post('/4_0_0/$export?_type=Patient')
            .set(getHeaders(scope));
        expect(createResp.status).toBe(202);
        const exportStatusId = createResp.headers['content-location'].split('/').pop();

        const pollResp = await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeaders(scope));
        expect(pollResp.status).toBe(202);
    });

    test.each([
        ['a read-only grant without c on Task', 'user/*.rs access/client.s', 'expected_denied_without_task_c'],
        ['a write-only grant', 'user/*.cud access/client.cud', 'expected_denied_write_only'],
        ['an access/ scope granting r but not s', 'user/*.rs user/Task.c access/client.r', 'expected_denied_access_gate_r_only']
    ])('%s cannot start an export', async (name, scope, expectedName) => {
        const request = await createRequestWithMockK8s();

        const resp = await request
            .post('/4_0_0/$export?_type=Patient')
            .set(getHeaders(scope));
        expect(resp.status).toBe(403);
        expect(resp).toHaveResponse(expectedResponses[expectedName]);
    });
});
