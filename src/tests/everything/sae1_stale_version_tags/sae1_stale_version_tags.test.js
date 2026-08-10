// ============================================================================
// SEC-1580 SAE-1 (mongo-only; no ClickHouse).
// Gap: narrowing a resource's access tags shuts a tenant out of the CURRENT
// version, but a historical version keeps the access tags it had at write
// time -- so a tenant-scoped access code can still match a stale,
// no-longer-current tag on an old version. Reading /_history/1 or listing
// /_history would otherwise still succeed for a tenant whose access was
// just revoked.
//
// Fix: history reads (a specific version via _history/{vid}, and the
// _history list) require a non-tenant-specific access scope (access/*.read
// or access/*.*), enforced in history.js/searchByVersionId.js, regardless
// of what a stale historical document's own tags say.
//
// Setup: a Patient owned by tenant B, initially shared with tenant A and B
// both. Tenant A reads it (succeeds, expected). The record is then PUT with
// narrowed tags (access: [tenantb] only). Tenant A -- scoped only to
// access/tenanta.* -- is now blocked from the current version, /_history/1,
// and /_history alike. A caller scoped to access/*.* (not tied to any one
// tenant) can still reach history.
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

describe('D-SAE1 — narrowing tags must revoke history, not just the current version', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: tenantA can read the shared record before its tags are narrowed', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        const resp = await request.get('/4_0_0/Patient/sae1SharedAB').set(headersA);
        expect(resp.status).toBe(200);
    });

    test('after narrowing the tags, a tenant-scoped caller can no longer reach the earlier version', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        const put = await request.put('/4_0_0/Patient/sae1SharedAB').send(narrowed).set(headersRW);
        expect([200, 201]).toContain(put.status);

        // current version is correctly closed off
        const current = await request.get('/4_0_0/Patient/sae1SharedAB').set(headersA);
        expect([403, 404]).toContain(current.status);

        // the earlier version must be too, even though its own stored tags still list tenantA
        const v1 = await request.get('/4_0_0/Patient/sae1SharedAB/_history/1').set(headersA);
        expect(v1.status).toBe(403);
    });

    test('after narrowing the tags, a tenant-scoped caller cannot reach the earlier version through _history either', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        await request.put('/4_0_0/Patient/sae1SharedAB').send(narrowed).set(headersRW);
        const hist = await request.get('/4_0_0/Patient/sae1SharedAB/_history').set(headersA);
        expect(hist.status).toBe(403);
    });

    test('a caller with a non-tenant-specific access scope (access/*.*) can still read history after narrowing', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send([sharedAB]).set(getHeaders());
        await request.put('/4_0_0/Patient/sae1SharedAB').send(narrowed).set(headersRW);

        // getHeaders() with no scope defaults to a full-access token carrying access/*.*
        const v1 = await request.get('/4_0_0/Patient/sae1SharedAB/_history/1').set(getHeaders());
        expect(v1.status).toBe(200);

        const hist = await request.get('/4_0_0/Patient/sae1SharedAB/_history').set(getHeaders());
        expect(hist.status).toBe(200);
        expect(ids(hist)).toEqual(expect.arrayContaining(['sae1SharedAB']));
    });
});
