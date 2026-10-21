const patient1Resource = require('./fixtures/patient1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Read and search v2 CRUDS scope granularity Tests', () => {
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

    test.each([
        ['_id search with r on both gates is allowed', '/4_0_0/Patient?_id=1', 'user/Patient.r access/access.r access/owner.r', 200],
        ['id search with r on both gates is allowed', '/4_0_0/Patient?id=1', 'user/Patient.r access/access.r access/owner.r', 200],
        ['_id search with s on the resource gate is denied', '/4_0_0/Patient?_id=1', 'user/Patient.s access/access.r access/owner.r', 403],
        ['_id search with s on the access gate is denied', '/4_0_0/Patient?_id=1', 'user/Patient.r access/access.s access/owner.s', 403],
        ['search by another parameter with s on both gates is allowed', '/4_0_0/Patient?gender=male', 'user/Patient.s access/access.s access/owner.s', 200],
        ['search by another parameter with r on the access gate is denied', '/4_0_0/Patient?gender=male', 'user/Patient.s access/access.r access/owner.r', 403],
        ['search by another parameter with r on the resource gate is denied', '/4_0_0/Patient?gender=male', 'user/Patient.r access/access.s access/owner.s', 403],
        ['_id combined with another parameter needs s on both gates', '/4_0_0/Patient?_id=1&gender=male', 'user/Patient.rs access/access.s access/owner.s', 200],
        ['_id combined with another parameter with r on the access gate is denied', '/4_0_0/Patient?_id=1&gender=male', 'user/Patient.rs access/access.r access/owner.r', 403],
        ['summary by id with r is allowed', '/4_0_0/Patient/1/$summary', 'user/Patient.r access/access.r access/owner.r', 200],
        ['summary by id with s alone is denied', '/4_0_0/Patient/1/$summary', 'user/Patient.s access/access.r access/owner.r', 403],
        ['validate by id with r on both gates is allowed', '/4_0_0/Patient/1/$validate', 'user/Patient.r access/access.r access/owner.r', 200],
        ['validate by id with s on the resource gate is denied', '/4_0_0/Patient/1/$validate', 'user/Patient.s access/access.r access/owner.r', 403],
        ['validate by id with only access scopes is denied', '/4_0_0/Patient/1/$validate', 'access/access.r access/owner.r', 403],
        ['validate by id with s on the access gate is denied', '/4_0_0/Patient/1/$validate', 'user/Patient.r access/access.s access/owner.s', 403],
        ['type-level history with s on both gates is allowed', '/4_0_0/Patient/_history', 'user/Patient.s access/*.s', 200],
        ['type-level history with r on the access gate is denied', '/4_0_0/Patient/_history', 'user/Patient.s access/*.r', 403],
        ['instance history with r on both gates is allowed', '/4_0_0/Patient/1/_history', 'user/Patient.r access/*.r', 200],
        ['instance history with s on the access gate is denied', '/4_0_0/Patient/1/_history', 'user/Patient.r access/*.s', 403],
        ['vread with r on both gates is allowed', '/4_0_0/Patient/1/_history/1', 'user/Patient.r access/*.r', 200],
        ['vread with s on the access gate is denied', '/4_0_0/Patient/1/_history/1', 'user/Patient.r access/*.s', 403]
    ])('%s', async (name, url, scope, status) => {
        const request = await createTestRequest();
        const merged = await request
            .post('/4_0_0/Patient/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        expect(merged).toHaveMergeResponse({ created: true });
        const updated = await request
            .put('/4_0_0/Patient/1')
            .send({ ...patient1Resource, birthDate: '2000-01-01' })
            .set(getHeaders());
        expect(updated.status).toBe(200);

        const resp = await request.get(url).set(getHeaders(scope));
        expect(resp.status).toBe(status);
        if (status === 200 && url.includes('?')) {
            expect(resp.body.map((r) => r.id)).toEqual(['1']);
        }
    });

    test.each([
        ['an _id search by another tenant returns nothing', '/4_0_0/Patient?_id=1', 'user/Patient.r access/other.r', 200, []],
        ['a search by another tenant returns nothing', '/4_0_0/Patient?gender=male', 'user/Patient.s access/other.s', 200, []],
        ['a streamed search by another tenant returns nothing', '/4_0_0/Patient?gender=male&_streamResponse=1', 'user/Patient.s access/other.s', 200, []],
        ['a streamed _id search with s alone on the access gate is denied', '/4_0_0/Patient?_id=1&_streamResponse=1', 'user/Patient.r access/access.s access/owner.s', 403, null],
        ['a streamed search with r alone on the access gate is denied', '/4_0_0/Patient?gender=male&_streamResponse=1', 'user/Patient.s access/access.r access/owner.r', 403, null],
        ['a streamed search with s on both gates returns the patient', '/4_0_0/Patient?gender=male&_streamResponse=1', 'user/Patient.s access/access.s access/owner.s', 200, ['1']],
        ['a read by id for another tenant is not found', '/4_0_0/Patient/1', 'user/Patient.r access/other.r', 404, null],
        ['a read by id with r on both gates is allowed', '/4_0_0/Patient/1', 'user/Patient.r access/access.r access/owner.r', 200, null],
        ['a read by id with s on the access gate is denied', '/4_0_0/Patient/1', 'user/Patient.r access/access.s access/owner.s', 403, null],
        ['a type-level history for another tenant is denied', '/4_0_0/Patient/_history', 'user/Patient.s access/other.s', 403, null]
    ])('%s', async (name, url, scope, status, ids) => {
        const request = await createTestRequest();
        const merged = await request
            .post('/4_0_0/Patient/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        expect(merged).toHaveMergeResponse({ created: true });

        const resp = await request.get(url).set(getHeaders(scope));
        expect(resp.status).toBe(status);
        if (ids) {
            const body = Array.isArray(resp.body) ? resp.body : resp.body.entry?.map((e) => e.resource) ?? [];
            expect(body.map((r) => r.id)).toEqual(ids);
        }
    });
});
