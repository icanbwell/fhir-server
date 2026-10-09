const patient1Resource = require('./fixtures/Patient/patient1.json');

const expectedResponses = {
    expected_denied_by_id: require('./fixtures/expected/expected_denied_by_id.json'),
    expected_denied_search: require('./fixtures/expected/expected_denied_search.json'),
    expected_denied_search_access_gate: require('./fixtures/expected/expected_denied_search_access_gate.json'),
    expected_deleted_one: require('./fixtures/expected/expected_deleted_one.json')
};

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Remove v2 CRUDS scope granularity Tests', () => {
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
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const cases = [
        ['delete by id with d-only grant succeeds', '/4_0_0/Patient/1', 'user/*.d access/access.d access/owner.d', 204, undefined, 404],
        ['delete by id with a non-search query parameter and d-only grant succeeds', '/4_0_0/Patient/1?_format=json&_pretty=true', 'user/*.d access/access.d access/owner.d', 204, undefined, 404],
        ['delete by id with rs grant is denied', '/4_0_0/Patient/1', 'user/*.rs access/access.rs access/owner.rs', 403, 'expected_denied_by_id', 200],
        ['delete by search with d-only grant is denied', '/4_0_0/Patient?gender=male', 'user/*.d access/access.d access/owner.d', 403, 'expected_denied_search', 200],
        ['delete by search with s missing on the access gate is denied', '/4_0_0/Patient?gender=male', 'user/*.ds access/access.d access/owner.d', 403, 'expected_denied_search_access_gate', 200],
        ['delete by search with d and s grant succeeds', '/4_0_0/Patient?gender=male', 'user/*.ds access/access.ds access/owner.ds', 200, 'expected_deleted_one', 404]
    ];

    test.each(cases)('%s', async (name, url, scope, status, expectedName, statusAfter) => {
        const request = await createTestRequest();
        const merged = await request
            .post('/4_0_0/Patient/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        expect(merged).toHaveMergeResponse({ created: true });

        const resp = await request.delete(url).set(getHeaders(scope));
        expect(resp.status).toBe(status);
        if (expectedName) {
            expect(resp).toHaveResponse(expectedResponses[expectedName]);
        }

        const after = await request.get('/4_0_0/Patient/1').set(getHeaders());
        expect(after.status).toBe(statusAfter);
    });
});
