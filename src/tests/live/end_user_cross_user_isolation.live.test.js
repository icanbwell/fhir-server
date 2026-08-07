// ============================================================================
// BROAD-INTEGRATION (live) test — end-user cross-user isolation on a real staging server.
// The live counterpart of src/tests/everything/end_user_cross_user_isolation (narrow).
//
// This talks to LIVE services, so it is gated: it only runs when RUN_LIVE_ISOLATION is set.
// A normal `yarn test` / CI run skips it (describe.skip), so it never breaks the unit build.
//
// Credentials come from the environment (a gitignored scripts/security/.env locally, or
// GitHub Actions secrets in CI) — never from this file. Provide either:
//   - USER_A_EMAIL/PASSWORD + USER_B_EMAIL/PASSWORD + CLIENTKEY  (it logs in), or
//   - TOKEN_A / TOKEN_B  (pre-minted bearer tokens; login skipped).
// Plus USER_A_PERSON_ID/PATIENT_ID, USER_B_PERSON_ID/PATIENT_ID, FHIR_BASE_URL, LOGIN_URL.
//
// Run:  RUN_LIVE_ISOLATION=1 node node_modules/.bin/jest src/tests/live
// ============================================================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { describe, test, beforeAll, expect } = require('@jest/globals');

// Load scripts/security/.env if present (does not override already-exported vars / CI secrets).
(function loadDotEnv() {
    const p = path.join(process.cwd(), 'scripts', 'security', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
})();

const E = process.env;
const FHIR = E.FHIR_BASE_URL || 'https://fhir.staging.icanbwell.com';
const LOGIN = E.LOGIN_URL || 'https://api-gateway.staging.icanbwell.com/identity/account/login';
const A = { person: E.USER_A_PERSON_ID, patient: E.USER_A_PATIENT_ID, email: E.USER_A_EMAIL, password: E.USER_A_PASSWORD };
const B = { person: E.USER_B_PERSON_ID, patient: E.USER_B_PATIENT_ID, email: E.USER_B_EMAIL, password: E.USER_B_PASSWORD };
const NONEXISTENT = '00000000-0000-4000-8000-000000000000';

const live = E.RUN_LIVE_ISOLATION ? describe : describe.skip;

async function login(email, password) {
    const res = await axios.post(LOGIN, { email, password },
        { headers: { clientkey: E.CLIENTKEY, 'Content-Type': 'application/json' }, validateStatus: () => true });
    const d = res.data || {};
    // The identity service returns { accessToken: { jwtToken, payload }, idToken, refreshToken }.
    return (d.accessToken && d.accessToken.jwtToken) || d.access_token || (typeof d.accessToken === 'string' ? d.accessToken : null);
}
function fhir(token) {
    return axios.create({ baseURL: FHIR, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 25000 });
}
function patientIdsIn(bundle) {
    const entries = (bundle && bundle.entry) || [];
    return entries.map((e) => e.resource).filter((r) => r && r.resourceType === 'Patient').map((r) => r.id);
}

live('LIVE end-user cross-user isolation (two bwell_demo users, real staging)', () => {
    let tokenA, tokenB, cA, cB;

    beforeAll(async () => {
        tokenA = E.TOKEN_A || await login(A.email, A.password);
        tokenB = E.TOKEN_B || await login(B.email, B.password);
        if (!tokenA || !tokenB) throw new Error('Could not obtain both tokens — check CLIENTKEY / creds / LOGIN_URL, or set TOKEN_A/TOKEN_B.');
        cA = fhir(tokenA); cB = fhir(tokenB);
    }, 60000);

    test('positive control: user A reads its OWN $everything (contains own patient)', async () => {
        const r = await cA.get(`/4_0_0/Person/${A.person}/$everything`);
        expect(r.status).toBe(200);
        expect(patientIdsIn(r.data)).toContain(A.patient);
    }, 40000);

    test('positive control: user B reads its OWN $everything (contains own patient)', async () => {
        const r = await cB.get(`/4_0_0/Person/${B.person}/$everything`);
        expect(r.status).toBe(200);
        expect(patientIdsIn(r.data)).toContain(B.patient);
    }, 40000);

    test('user A\'s own $everything does NOT contain user B\'s patient', async () => {
        const r = await cA.get(`/4_0_0/Person/${A.person}/$everything`);
        expect(patientIdsIn(r.data)).not.toContain(B.patient);
    }, 40000);

    test('user A cannot reach user B\'s graph by substituting B\'s person id', async () => {
        const r = await cA.get(`/4_0_0/Person/${B.person}/$everything`);
        expect([200, 401, 403, 404]).toContain(r.status);
        expect(patientIdsIn(r.data)).not.toContain(B.patient);
    }, 40000);

    test('user B cannot reach user A\'s graph by substituting A\'s person id', async () => {
        const r = await cB.get(`/4_0_0/Person/${A.person}/$everything`);
        expect([200, 401, 403, 404]).toContain(r.status);
        expect(patientIdsIn(r.data)).not.toContain(A.patient);
    }, 40000);

    test('user A reading user B\'s Patient by id is denied and indistinguishable from not-found', async () => {
        const foreign = await cA.get(`/4_0_0/Patient/${B.patient}`);
        const missing = await cA.get(`/4_0_0/Patient/${NONEXISTENT}`);
        expect([401, 403, 404]).toContain(foreign.status);
        expect(foreign.status).toBe(missing.status);
    }, 40000);
});
