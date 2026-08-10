// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 SAE-1 (mongo-only; no ClickHouse).
// Gap: narrowing a resource's access tags shuts a tenant out of the CURRENT
// version but not of any EARLIER version. Reading version 1 (or listing
// _history) still succeeds for a tenant whose access was just revoked, so
// narrowing tags doesn't actually revoke history.
//
// Setup: a Patient owned by tenant B, initially shared with tenant A and B
// both. Tenant A reads it (succeeds, expected). The record is then PUT with
// narrowed tags (access: [tenantb] only). Tenant A's read of the CURRENT
// version is correctly blocked -- but /_history/1 and /_history must also be
// blocked, and today they are not.
//
// Asserts the SECURE outcome; if the earlier version keeps leaking, this
// FAILS. *.bugs, excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const OWNER = 'https://www.icanbwell.com/owner';
const ACCESS = 'https://www.icanbwell.com/access';

const sharedAB = {
    resourceType: 'Patient', id: 'sae1SharedAB',
    meta: {
        source: 'tenantb',
        security: [
            { system: OWNER, code: 'tenantb' },
            { system: ACCESS, code: 'tenanta' },
            { system: ACCESS, code: 'tenantb' }
        ]
    },
    gender: 'female', birthDate: '1985-06-15'
};

const narrowed = {
    ...sharedAB,
    meta: { source: 'tenantb', security: [{ system: OWNER, code: 'tenantb' }, { system: ACCESS, code: 'tenantb' }] }
};

const headersA = { ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' };
const headersRW = { ...getHeaders('user/*.read user/*.write access/tenanta.* access/tenantb.*'), prefer: 'global_id=false' };
const ids = (resp) => {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
};

describe('D-SAE1 (fail-by-design) — narrowing tags must revoke history, not just the current version', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: tenantA can read the shared record before its tags are narrowed', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        const resp = await request.get('/4_0_0/Patient/sae1SharedAB').set(headersA);
        expect(resp.status).toBe(200);
    });

    test('SECURE (fails until SAE-1 enforced): after narrowing the tags, the earlier version is no longer readable', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        const put = await request.put('/4_0_0/Patient/sae1SharedAB').send(narrowed).set(headersRW);
        expect([200, 201]).toContain(put.status);

        // current version is correctly closed off
        const current = await request.get('/4_0_0/Patient/sae1SharedAB').set(headersA);
        expect([403, 404]).toContain(current.status);

        // the earlier version must be too
        const v1 = await request.get('/4_0_0/Patient/sae1SharedAB/_history/1').set(headersA);
        expect([403, 404]).toContain(v1.status);
    });

    test('SECURE (fails until SAE-1 enforced): the earlier version is not reachable through _history either', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        await request.put('/4_0_0/Patient/sae1SharedAB').send(narrowed).set(headersRW);
        const hist = await request.get('/4_0_0/Patient/sae1SharedAB/_history').set(headersA);
        expect([200, 403, 404]).toContain(hist.status);
        expect(ids(hist)).toEqual([]);
    });
});
