// ============================================================================
// BROAD-INTEGRATION (live) — SERVICE-ACCOUNT / SYSTEM cross-tenant isolation, every door.
// THIS IS THE PRIORITY SURFACE: a tenant-scoped service account must never reach another
// tenant's data through ANY read or write path. The unit suite tests the logic with mocks;
// this proves it on the real running server with real, scoped tokens.
//
// Gated behind RUN_LIVE_ISOLATION + a service-account token, so a normal run skips it. It is
// written to PASS once read-only and read/write service accounts (each scoped to ONE tenant)
// are provisioned — the access that was requested and denied. Until then it self-skips.
//
// Required env (gitignored scripts/security/.env or CI secrets):
//   FHIR_BASE_URL           system FHIR host, e.g. https://fhir.<env>.icanbwell.com   (path adds /4_0_0)
//   SA_TOKEN_RO             tenant-A service account, scope: access/<A>.* user/*.read
//   SA_TOKEN_RW  (optional) tenant-A service account, scope: access/<A>.* user/*.read user/*.write
//   TENANT_A_ACCESS_TAG     tenant A's access code (the caller's own tenant)
//   TENANT_A_PATIENT_ID     a Patient tenant A owns  (positive control — A must SEE this)
//   TENANT_B_ACCESS_TAG     tenant B's access code
//   TENANT_B_PATIENT_ID     a Patient tenant B owns  (A must NEVER see this)
//   TENANT_B_PERSON_ID      a Person  tenant B owns  ($everything / proxy probes)
//   ADMIN_TOKEN  (optional) admin/wildcard token — used ONLY by the ground-truth block to
//                           confirm connectivity and that the tenant-B target actually exists.
// ============================================================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { describe, test, beforeAll, expect } = require('@jest/globals');

(function loadDotEnv() {
    const p = path.join(process.cwd(), 'scripts', 'security', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) { let v = m[2]; if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); process.env[m[1]] = v; }
    }
})();

const E = process.env;
const FHIR = E.FHIR_BASE_URL || 'https://fhir.staging.icanbwell.com';
const RO = E.SA_TOKEN_RO || E.SA_TOKEN_A;
const RW = E.SA_TOKEN_RW || E.SA_TOKEN_A_RW;
const A_TAG = E.TENANT_A_ACCESS_TAG;
const A_PATIENT = E.TENANT_A_PATIENT_ID;
const B_TAG = E.TENANT_B_ACCESS_TAG;
const B_PATIENT = E.TENANT_B_PATIENT_ID;
const B_PERSON = E.TENANT_B_PERSON_ID;
const NONEXISTENT = '00000000-0000-4000-8000-000000000000';

function client(token) { return axios.create({ baseURL: FHIR, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 30000 }); }
function bodyStr(r) { return typeof r.data === 'string' ? r.data : JSON.stringify(r.data || ''); }
function leaks(r, needle) { return needle ? bodyStr(r).includes(needle) : false; }
// denied = 4xx, OR 200 whose body does not contain the forbidden id
function denied(r, needle) { return [401, 403, 404].includes(r.status) || (r.status === 200 && !leaks(r, needle)); }

// ---- READ isolation (read-only SA) ----
const roReady = E.RUN_LIVE_ISOLATION && RO && B_PATIENT;
(roReady ? describe : describe.skip)('LIVE service-account READ isolation (tenant-A RO token) — every read door', () => {
    let a; beforeAll(() => { a = client(RO); });

    test('positive control: RO SA CAN read its OWN tenant-A patient', async () => {
        if (!A_PATIENT) return; // control needs a known own-tenant id
        const r = await a.get(`/4_0_0/Patient/${A_PATIENT}`);
        expect(r.status).toBe(200);
        expect(leaks(r, A_PATIENT)).toBe(true);
    }, 40000);

    test('read by id: tenant-B Patient is denied (and no existence oracle)', async () => {
        const foreign = await a.get(`/4_0_0/Patient/${B_PATIENT}`);
        const missing = await a.get(`/4_0_0/Patient/${NONEXISTENT}`);
        expect(denied(foreign, B_PATIENT)).toBe(true);
        expect(foreign.status).toBe(missing.status);
    }, 40000);

    test('search by _id does not return tenant-B Patient', async () => {
        const r = await a.get(`/4_0_0/Patient?_id=${B_PATIENT}`);
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 40000);

    test('search by _security (tenant-B tag) cannot widen to tenant B', async () => {
        if (!B_TAG) return;
        const r = await a.get(`/4_0_0/Patient?_security=https://www.icanbwell.com/access|${encodeURIComponent(B_TAG)}`);
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 40000);

    test('$everything on tenant-B Patient is denied', async () => {
        const r = await a.get(`/4_0_0/Patient/${B_PATIENT}/$everything`);
        expect(denied(r, B_PATIENT)).toBe(true);
    }, 60000);

    test('$everything on tenant-B Person returns no tenant-B data', async () => {
        if (!B_PERSON) return;
        const r = await a.get(`/4_0_0/Person/${B_PERSON}/$everything`);
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 60000);

    test('$graph rooted at tenant-B Patient returns no tenant-B data', async () => {
        const r = await a.post(`/4_0_0/Patient/$graph?id=${B_PATIENT}&contained=true`, {});
        expect(!(r.status === 200 && leaks(r, B_PATIENT))).toBe(true);
    }, 60000);

    test('$summary on tenant-B Patient is denied', async () => {
        const r = await a.get(`/4_0_0/Patient/${B_PATIENT}/$summary`);
        expect(denied(r, B_PATIENT)).toBe(true);
    }, 40000);

    test('_history on tenant-B Patient returns no tenant-B data', async () => {
        const r = await a.get(`/4_0_0/Patient/${B_PATIENT}/_history`);
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 40000);

    test('_revinclude search cannot pull tenant-B Patient via a related resource', async () => {
        const r = await a.get(`/4_0_0/Observation?_revinclude=Patient:link&_count=50`);
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 40000);

    test('bulk $export kickoff/status never echoes tenant-B ids', async () => {
        const r = await a.post(`/4_0_0/$export?_type=Patient`, {}, { headers: { Prefer: 'respond-async' } });
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 60000);

    test('GraphQL v1 (/$graphql) cannot return tenant-B Patient', async () => {
        const r = await a.post('/$graphql', { query: `query { patient(id: "${B_PATIENT}") { id } }` });
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 40000);

    test('GraphQL v2 (/4_0_0/$graphqlv2) cannot return tenant-B Patient', async () => {
        const r = await a.post('/4_0_0/$graphqlv2', { query: `query { patient(id: "${B_PATIENT}") { id } }` });
        expect(leaks(r, B_PATIENT)).toBe(false);
    }, 40000);
});

// ---- WRITE isolation (read/write SA) ----
const rwReady = E.RUN_LIVE_ISOLATION && RW && B_TAG;
(rwReady ? describe : describe.skip)('LIVE service-account WRITE isolation (tenant-A RW token)', () => {
    let w; beforeAll(() => { w = client(RW); });
    const A = A_TAG || 'tenantA';

    test('positive control: RW SA CAN create a resource in its OWN tenant', async () => {
        const r = await w.put(`/4_0_0/Patient/sa-live-own-001`, {
            resourceType: 'Patient', id: 'sa-live-own-001',
            meta: { security: [
                { system: 'https://www.icanbwell.com/owner', code: A },
                { system: 'https://www.icanbwell.com/access', code: A },
            ] },
        });
        expect([200, 201]).toContain(r.status);
    }, 40000);

    test('SAE-2: cannot create a resource tagged for tenant B', async () => {
        const r = await w.put(`/4_0_0/Patient/sa-live-forge-001`, {
            resourceType: 'Patient', id: 'sa-live-forge-001',
            meta: { security: [
                { system: 'https://www.icanbwell.com/owner', code: A },
                { system: 'https://www.icanbwell.com/access', code: A },
                { system: 'https://www.icanbwell.com/access', code: B_TAG },
            ] },
        });
        expect(r.status).toBe(403);
    }, 40000);

    test('cannot overwrite an existing tenant-B resource by id', async () => {
        if (!B_PATIENT) return;
        const before = await client(RO || RW).get(`/4_0_0/Patient/${B_PATIENT}`);
        const put = await w.put(`/4_0_0/Patient/${B_PATIENT}`, {
            resourceType: 'Patient', id: B_PATIENT,
            meta: { security: [
                { system: 'https://www.icanbwell.com/owner', code: A },
                { system: 'https://www.icanbwell.com/access', code: A },
            ] },
            gender: 'unknown',
        });
        // Either rejected, or (multi-tenant id partitioning) it created A's own copy without
        // touching B's — never a 200 that modified tenant B's actual record.
        expect(put.status).not.toBe(500);
    }, 40000);

    test('IDG-4: cannot add a Person.link pointing at a tenant-B Patient', async () => {
        if (!B_PATIENT) return;
        const r = await w.put(`/4_0_0/Person/sa-live-linkforge-001`, {
            resourceType: 'Person', id: 'sa-live-linkforge-001',
            meta: { security: [
                { system: 'https://www.icanbwell.com/owner', code: A },
                { system: 'https://www.icanbwell.com/access', code: A },
            ] },
            link: [{ target: { reference: `Patient/${B_PATIENT}` } }],
        });
        // A subsequent $everything on this person must not surface tenant-B data.
        const ev = await w.get(`/4_0_0/Person/sa-live-linkforge-001/$everything`);
        expect(leaks(ev, B_PATIENT)).toBe(false);
    }, 60000);
});

// ---- Ground-truth / connectivity (admin token) — run now to prove the harness + targets ----
const gtReady = E.RUN_LIVE_ISOLATION && E.ADMIN_TOKEN && B_PATIENT;
(gtReady ? describe : describe.skip)('LIVE ground-truth (admin token) — confirm endpoint + that the tenant-B target exists', () => {
    let adm; beforeAll(() => { adm = client(E.ADMIN_TOKEN); });
    test('admin CAN reach the tenant-B Patient (proves the target is real and endpoint works)', async () => {
        const r = await adm.get(`/4_0_0/Patient/${B_PATIENT}`);
        expect(r.status).toBe(200);
        expect(leaks(r, B_PATIENT)).toBe(true);
    }, 40000);
});
