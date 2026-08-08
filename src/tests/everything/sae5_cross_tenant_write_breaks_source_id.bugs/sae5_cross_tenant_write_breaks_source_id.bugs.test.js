// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 SAE-5 (mongo-only; no ClickHouse).
// Gap: ids carry the owning tenant, so tenant A writing to tenant B's source
// id creates a SECOND record sharing that source id rather than overwriting
// B's. B's data is intact, but a read by that source id now returns 400 for
// both tenants (it resolves to two records), and an _id search on that
// source id stops returning it too. Any tenant that can write can make
// another tenant's record unfindable by source id, without ever reading or
// modifying it. The record survives and still shows up in an unfiltered
// listing, so no data is lost -- but any client integrating by source id
// breaks.
//
// Asserts the SECURE outcome; if the collision still breaks tenant B's reads,
// this FAILS. *.bugs, excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

function pat (id, owner, accessCodes) {
    return {
        resourceType: 'Patient', id,
        meta: {
            source: owner,
            security: [
                { system: 'https://www.icanbwell.com/owner', code: owner },
                ...accessCodes.map((a) => ({ system: 'https://www.icanbwell.com/access', code: a }))
            ]
        },
        gender: 'female', birthDate: '1985-06-15'
    };
}

const ownB = pat('sae5OwnB', 'tenantb', ['tenantb']);

const A_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenanta.*'), prefer: 'global_id=false' });
const B_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenantb.*'), prefer: 'global_id=false' });

async function seed () {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send([ownB]).set(getHeaders());
    return request;
}

describe('D-SAE5 (fail-by-design) — a cross-tenant write breaks reads by source id', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: tenantB can read its own record by source id', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/sae5OwnB').set(B_RW());
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('sae5OwnB');
    });

    test('SECURE (fails until SAE-5 enforced): after tenantA writes to that source id, tenantB can still read its own record', async () => {
        const request = await seed();
        const before = await request.get('/4_0_0/Patient/sae5OwnB').set(B_RW());
        expect(before.status).toBe(200);

        await request.put('/4_0_0/Patient/sae5OwnB').send(pat('sae5OwnB', 'tenanta', ['tenanta'])).set(A_RW());

        const after = await request.get('/4_0_0/Patient/sae5OwnB').set(B_RW());
        expect(after.status).toBe(200);
        expect(after.body.id).toBe('sae5OwnB');
    });

    test('SECURE (fails until SAE-5 enforced): and the same holds through $merge', async () => {
        const request = await seed();
        await request.post('/4_0_0/Patient/$merge').send(pat('sae5OwnB', 'tenanta', ['tenanta'])).set(A_RW());
        const after = await request.get('/4_0_0/Patient/sae5OwnB').set(B_RW());
        expect(after.status).toBe(200);
    });

    test('SECURE (fails until SAE-5 enforced): an _id search still returns B\'s record after the collision', async () => {
        const request = await seed();
        await request.put('/4_0_0/Patient/sae5OwnB').send(pat('sae5OwnB', 'tenanta', ['tenanta'])).set(A_RW());
        const search = await request.get('/4_0_0/Patient?_id=sae5OwnB').set(B_RW());
        const mine = (Array.isArray(search.body) ? search.body : []).filter((r) => r && r.id === 'sae5OwnB');
        expect(mine.length).toBe(1);
    });

    test('control: B\'s record does survive — an unfiltered listing still shows it, owned by B', async () => {
        const request = await seed();
        await request.put('/4_0_0/Patient/sae5OwnB').send(pat('sae5OwnB', 'tenanta', ['tenanta'])).set(A_RW());
        const all = await request.get('/4_0_0/Patient?_count=100').set(B_RW());
        const mine = (Array.isArray(all.body) ? all.body : []).filter((r) => r && r.id === 'sae5OwnB');
        expect(mine.length).toBe(1);
        const owner = (mine[0].meta.security || []).find((s) => s.system === 'https://www.icanbwell.com/owner');
        expect(owner.code).toBe('tenantb');
    });
});
