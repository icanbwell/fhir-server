const importBody = require('./fixtures/import_body.json');

const expectedResponses = {
    expected_denied_read_only: require('./fixtures/expected/expected_denied_read_only.json'),
    expected_denied_wrong_type: require('./fixtures/expected/expected_denied_wrong_type.json'),
    expected_denied_no_access_scope: require('./fixtures/expected/expected_denied_no_access_scope.json'),
    expected_denied_c_without_u: require('./fixtures/expected/expected_denied_c_without_u.json'),
    expected_denied_access_gate_read_only: require('./fixtures/expected/expected_denied_access_gate_read_only.json')
};

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('$import v2 CRUDS scope granularity Tests', () => {
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
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket';
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        await commonAfterEach();
    });

    test('u on Task at both gates is accepted', async () => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/$import')
            .send(importBody)
            .set(getHeaders('user/Task.u access/client.u'));
        expect(resp.status).toBe(202);
        expect(resp.body.resourceType).toBe('Task');
        expect(resp.body.id).toBe('import-job-001');
        const accessCodes = resp.body.meta.security
            .filter((s) => s.system === 'https://www.icanbwell.com/access')
            .map((s) => s.code);
        expect(accessCodes).toEqual(['client']);
    });

    test.each([
        ['read-only grant', 'user/*.rs access/client.rs', 'expected_denied_read_only'],
        ['u granted on a different resource type', 'user/Patient.u access/client.u', 'expected_denied_wrong_type'],
        ['no access/ scope', 'user/Task.u', 'expected_denied_no_access_scope'],
        ['read-only access/ scope', 'user/Task.u access/client.rs', 'expected_denied_access_gate_read_only'],
        ['c without u', 'user/Task.c access/client.c', 'expected_denied_c_without_u']
    ])('%s is denied', async (name, scope, expectedName) => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/$import')
            .send(importBody)
            .set(getHeaders(scope));
        expect(resp.status).toBe(403);
        expect(resp).toHaveResponse(expectedResponses[expectedName]);
    });
});
