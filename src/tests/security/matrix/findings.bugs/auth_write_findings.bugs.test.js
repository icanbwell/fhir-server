// =============================================================================
// AUTH AND WRITE FINDINGS — three more behaviours the matrix turned up. Each
// test states the secure outcome and fails until fixed. Quarantined; run with:
//   npx jest src/tests/security/matrix/findings.bugs
//
// 1. AN ID TOKEN WORKS AS AN ACCESS TOKEN
//    A token whose `token_use` claim is `id` rather than `access` is accepted and
//    serves data. ID tokens are handed to clients for a different purpose and
//    often live longer or travel further than access tokens, so accepting one
//    widens what counts as a valid credential.
//
// 2. A MALFORMED SEARCH PARAMETER RETURNS 500
//    At least one bad parameter value crashes the request instead of returning a
//    4xx. A 500 is a robustness problem on its own, and it's the response most
//    likely to carry a stack trace, so it's also the most likely place to leak
//    internals. The suite checks the body separately and that part passes today.
//
// 3. A CROSS-TENANT WRITE MAKES THE VICTIM'S RECORD UNREADABLE BY SOURCE ID
//    Ids carry the owning tenant, so tenant A writing to tenant B's source id
//    creates a second record sharing that source id rather than overwriting B's.
//    B's data is intact -- but a read by that source id now returns 400 for both
//    tenants, because it resolves to two records -- and an `_id` search on that
//    source id stops returning it too. So any tenant that can write can make
//    another tenant's record unfindable by source id at will, without ever
//    reading or changing it. The record itself survives and still shows up in an
//    unfiltered listing, so no data is lost, but any client integrating by source
//    id breaks.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload, createTestRequest } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('../matrixFixtures');

const A = () => ({ ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' });
const A_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenanta.*'), prefer: 'global_id=false' });
const B_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenantb.*'), prefer: 'global_id=false' });

function pat (id, owner, accessCodes) {
    return { resourceType: 'Patient', id, meta: { source: owner, security: F.sec(owner, accessCodes) },
        gender: 'female', birthDate: '1985-06-15' };
}

async function seed () {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(F.ALL).set(getHeaders());
    expect(resp.body.length).toBe(F.ALL.length);
    resp.body.forEach((r) => expect(r).toEqual(expect.objectContaining({ created: true })));
    return request;
}

describe('FINDING — an id token is accepted as an access token', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: a token with token_use=access works', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/mtxOwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*', token_use: 'access' }));
        expect(resp.status).toBe(200);
    });

    test('SECURE: a token with token_use=id is refused', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/mtxOwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*', token_use: 'id' }));
        expect([401, 403]).toContain(resp.status);
    });

    test('SECURE: a token with no token_use claim at all is refused', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/mtxOwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*' }));
        expect([401, 403]).toContain(resp.status);
    });

    test('SECURE: a refresh token is refused', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/mtxOwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*', token_use: 'refresh' }));
        expect([401, 403]).toContain(resp.status);
    });
});

describe('FINDING — a malformed search parameter returns 500', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    const BAD = [
        '/4_0_0/Patient?birthdate=not-a-date',
        '/4_0_0/Patient?_count=notanumber',
        '/4_0_0/Patient?_sort=$$$',
        '/4_0_0/Patient?_security=missing-separator',
        '/4_0_0/Observation?subject:Patient._id[$ne]=x',
        '/4_0_0/Patient?_lastUpdated=garbage',
        '/4_0_0/Patient?_total=nonsense'
    ];

    for (const q of BAD) {
        test(`SECURE: ${q} returns a client error, not 500`, async () => {
            const request = await seed();
            const resp = await request.get(q).set(A());
            expect(resp.status).toBeLessThan(500);
        });
    }
});

describe('FINDING — a cross-tenant write breaks reads by source id', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: tenantB can read its own record by source id', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('mtxOwnB');
    });

    test('SECURE: after tenantA writes to that source id, tenantB can still read its own record', async () => {
        const request = await seed();
        const before = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
        expect(before.status).toBe(200);

        await request.put('/4_0_0/Patient/mtxOwnB').send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());

        const after = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
        expect(after.status).toBe(200);
        expect(after.body.id).toBe('mtxOwnB');
    });

    test('SECURE: and the same holds through $merge', async () => {
        const request = await seed();
        await request.post('/4_0_0/Patient/$merge').send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());
        const after = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
        expect(after.status).toBe(200);
    });

    test('SECURE: an _id search still returns B\'s record after the collision', async () => {
        const request = await seed();
        await request.put('/4_0_0/Patient/mtxOwnB').send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());
        const search = await request.get('/4_0_0/Patient?_id=mtxOwnB').set(B_RW());
        const mine = (Array.isArray(search.body) ? search.body : []).filter((r) => r && r.id === 'mtxOwnB');
        expect(mine.length).toBe(1);
    });

    test('B\'s record does survive — an unfiltered listing still shows it, owned by B', async () => {
        const request = await seed();
        await request.put('/4_0_0/Patient/mtxOwnB').send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());
        const all = await request.get('/4_0_0/Patient?_count=100').set(B_RW());
        const mine = (Array.isArray(all.body) ? all.body : []).filter((r) => r && r.id === 'mtxOwnB');
        expect(mine.length).toBe(1);
        const owner = (mine[0].meta.security || []).find((s) => s.system === F.OWNER);
        expect(owner.code).toBe(F.T_B);
    });
});
