// ============================================================================
// Verification case coverage (see the security specification)
//   A1        read-only account reads its own tenant's resource
//   A3        read-only cannot read another tenant (both directions) + search isolation
//   SAE-4     foreign-vs-nonexistent id are indistinguishable (read path)
//   W2 / SAE-2 read/write account cannot create a resource tagged for another tenant
//   A11       access/*.* wildcard bypass is by design (admin/*.* proper: still TODO)
//   (scope)   read-only token cannot write; read/write can write within its tenant
// All checks here are MOCKED-LOGIC (locally-minted scopes). LIVE validation of every case
// is blocked pending lower-environment service accounts (denied) — see test plan Section 5.2.
// ============================================================================
// =============================================================================
// SERVICE ACCOUNT SCOPE ISOLATION — fully mocked, no real Okta/Cognito token needed.
//
// Demonstrates that the entire service-account authorization surface can be tested with
// LOCALLY-MINTED tokens: getHeaders(scope) mints a JWT with any scope string, the JWKS
// endpoint is mocked, and the request runs through the REAL server auth code. This means
// real service-account provisioning (CIE-8373) is NOT a prerequisite for testing the
// isolation LOGIC — it's only needed to validate against real production DATA.
//
// Scopes modeled:
//   access/tenantA.* user/*.read              -> read-only SA for tenant A
//   access/tenantA.* user/*.read user/*.write -> read/write SA for tenant A
//   access/tenantB.* user/*.read              -> read-only SA for tenant B
//   access/*.* user/*.read user/*.write       -> wildcard (documents the by-design bypass)
//
// POLARITY: every assertion is the SECURE outcome. Pass = correct isolation; fail = a real
// hole; fixed = green again.
// =============================================================================

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

function patient(id, owner, accessCodes) {
    return {
        resourceType: 'Patient',
        id,
        meta: {
            source: 'test',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: owner },
                ...accessCodes.map(code => ({ system: 'https://www.icanbwell.com/access', code }))
            ]
        }
    };
}

const saA_ro = 'user/*.read access/tenantA.*';
const saA_rw = 'user/*.read user/*.write access/tenantA.*';
const saB_ro = 'user/*.read access/tenantB.*';
const wildcard = 'user/*.read user/*.write access/*.*';

async function seed() {
    const request = await createTestRequest();
    const resp = await request
        .post('/4_0_0/Patient/$merge')
        .send([patient('patA', 'tenantA', ['tenantA']), patient('patB', 'tenantB', ['tenantB'])])
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
    return request;
}

describe('Service Account scope isolation (mocked scopes, real auth code)', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    // ---- Read isolation ----
    test('read-only SA(tenantA) CAN read its own tenant resource', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/patA').set(getHeaders(saA_ro));
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('patA');
    });

    test('read-only SA(tenantA) CANNOT read tenant B resource, and gets no existence oracle', async () => {
        const request = await seed();
        const foreign = await request.get('/4_0_0/Patient/patB').set(getHeaders(saA_ro));
        const missing = await request.get('/4_0_0/Patient/doesNotExist999').set(getHeaders(saA_ro));
        expect([403, 404]).toContain(foreign.status);
        expect(foreign.status).toBe(missing.status); // exists-but-forbidden indistinguishable from not-found
    });

    test('read-only SA(tenantB) CANNOT read tenant A resource (reverse direction)', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/patA').set(getHeaders(saB_ro));
        expect([403, 404]).toContain(resp.status);
    });

    test('search never returns another tenant\'s resource', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient?_bundle=1').set(getHeaders(saA_ro));
        expect(resp.status).toBe(200);
        const ids = ((resp.body && resp.body.entry) || []).map(e => e.resource && e.resource.id);
        expect(ids).not.toContain('patB');
    });

    // ---- Read-only vs read/write enforcement ----
    test('read-only SA(tenantA) CANNOT write (no user/*.write scope)', async () => {
        const request = await seed();
        const resp = await request.put('/4_0_0/Patient/patNew')
            .send(patient('patNew', 'tenantA', ['tenantA']))
            .set(getHeaders(saA_ro));
        expect([403, 401]).toContain(resp.status);
    });

    test('read/write SA(tenantA) CAN write within its own tenant', async () => {
        const request = await seed();
        const resp = await request.put('/4_0_0/Patient/patNew')
            .send(patient('patNew', 'tenantA', ['tenantA']))
            .set(getHeaders(saA_rw));
        expect([200, 201]).toContain(resp.status);
    });

    // ---- Cross-tenant write / tag forgery (SAE-2) ----
    test('read/write SA(tenantA) CANNOT create a resource tagged for another tenant (SAE-2 forgery)', async () => {
        const request = await seed();
        const resp = await request.put('/4_0_0/Patient/patForge')
            .send(patient('patForge', 'tenantA', ['tenantA', 'tenantB']))
            .set(getHeaders(saA_rw));
        expect(resp.status).toBe(403);
    });

    // ---- Documented wildcard bypass (A11/A12) ----
    test('wildcard access/*.* token CAN read across tenants (documents the intended bypass)', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/patB').set(getHeaders(wildcard));
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('patB');
    });
});
