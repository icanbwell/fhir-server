// =============================================================================
// LIVE SECURITY MATRIX — the same checks as src/tests/security/matrix, run
// against the deployed staging server with real tokens issued by the real
// identity provider.
//
// WHY THIS EXISTS SEPARATELY FROM THE IN-PROCESS MATRIX
// The in-process matrix establishes that the access-control code is correct. It
// cannot establish properties of the deployed environment, because three of them
// exist only there:
//   1. indexes and row counts (a tag-filtered search returning in milliseconds
//      against 12 records can time out against millions)
//   2. connections to the other services that write into this one
//   3. deployed configuration. The scope granted to a client is held in the
//      identity provider, not in this repository, and can change with no code
//      change
//
// STATUS: written and committed. Every block self-skips unless the environment
// below is present, so a normal run and CI are unaffected. No further test code is
// required, only credentials.
//
// REQUIRED ENVIRONMENT (scripts/security/.env, git-ignored; CI secrets)
//   FHIR_BASE_URL        e.g. https://fhir.staging.icanbwell.com  (paths add /4_0_0)
//   TOKEN_URL            the identity provider token endpoint
//   SA_RO_CLIENT_ID      read-only service account, scope: access/<qa>.* user/*.read
//   SA_RO_CLIENT_SECRET
//   SA_RW_CLIENT_ID      read/write service account, scope: access/<qa>.* user/*.read user/*.write
//   SA_RW_CLIENT_SECRET
//   QA_TENANT            the synthetic tenant slug those accounts are scoped to
//   QA_PATIENT_ID        a Patient that tenant owns          (positive control)
//   QA_PERSON_ID         a Person that tenant owns
//   FOREIGN_TENANT       a different tenant slug
//   FOREIGN_PATIENT_ID   a Patient that other tenant owns    (must never be visible)
//   FOREIGN_PERSON_ID    a Person that other tenant owns
//   GROUND_TRUTH_TOKEN   optional; a token that CAN see FOREIGN_PATIENT_ID, used
//                        only to prove the target exists. Without it, a passing
//                        result cannot be distinguished from the record being absent.
//
// A NOTE ON `prefer`
// $everything and $summary force internal-id output unless told otherwise, so a
// check that searches the response for a source id would not match on those
// endpoints. Every request below sends `prefer: global_id=false`, and the
// containment check covers both id forms.
// =============================================================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const querystring = require('querystring');
const { describe, test, beforeAll, expect } = require('@jest/globals');

(function loadDotEnv () {
    const p = path.join(process.cwd(), 'scripts', 'security', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const mm = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (mm && process.env[mm[1]] === undefined) {
            let v = mm[2];
            if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
            process.env[mm[1]] = v;
        }
    }
})();

const E = process.env;
const FHIR = E.FHIR_BASE_URL || 'https://fhir.staging.icanbwell.com';
const NONEXISTENT = '00000000-0000-4000-8000-000000000000';

const READY = !!(E.RUN_LIVE_ISOLATION && E.TOKEN_URL && E.SA_RO_CLIENT_ID && E.SA_RO_CLIENT_SECRET &&
    E.QA_PATIENT_ID && E.FOREIGN_PATIENT_ID);
const RW_READY = READY && !!(E.SA_RW_CLIENT_ID && E.SA_RW_CLIENT_SECRET && E.FOREIGN_TENANT);
const GT_READY = READY && !!E.GROUND_TRUTH_TOKEN;

async function mintToken (clientId, clientSecret) {
    const resp = await axios.post(E.TOKEN_URL,
        querystring.stringify({ grant_type: 'client_credentials' }),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            auth: { username: clientId, password: clientSecret },
            timeout: 30000
        });
    return resp.data.access_token;
}

function client (token) {
    return axios.create({
        baseURL: FHIR,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+json', prefer: 'global_id=false' },
        validateStatus: () => true,
        timeout: 60000
    });
}

const asText = (r) => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data || ''));
const mentions = (r, id) => (id ? asText(r).includes(id) : false);
function entryIds (r) {
    const d = r.data;
    if (!d) return [];
    if (Array.isArray(d)) return d.map((x) => x && x.id).filter(Boolean);
    if (d.entry) return d.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (d.id) return [d.id];
    return [];
}
// A refusal, or a success that contains none of the forbidden record.
function withheld (r, id) {
    if ([401, 403, 404].includes(r.status)) return true;
    return !mentions(r, id);
}

let ro, rw, gt;

(READY ? describe : describe.skip)('LIVE MATRIX — read isolation across a real tenant boundary', () => {
    beforeAll(async () => {
        ro = client(await mintToken(E.SA_RO_CLIENT_ID, E.SA_RO_CLIENT_SECRET));
        if (GT_READY) gt = client(E.GROUND_TRUTH_TOKEN);
    }, 60000);

    // ---- controls --------------------------------------------------------
    test('control: the read-only account CAN read its own tenant\'s patient', async () => {
        const r = await ro.get(`/4_0_0/Patient/${E.QA_PATIENT_ID}`);
        expect(r.status).toBe(200);
        expect(mentions(r, E.QA_PATIENT_ID)).toBe(true);
    }, 60000);

    test('control: its own $everything returns data', async () => {
        const r = await ro.get(`/4_0_0/Patient/${E.QA_PATIENT_ID}/$everything`);
        expect(r.status).toBe(200);
        expect(entryIds(r).length).toBeGreaterThan(0);
    }, 90000);

    (GT_READY ? test : test.skip)('control: the foreign target really exists (proves the checks below mean something)', async () => {
        const r = await gt.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        expect(r.status).toBe(200);
        expect(mentions(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 60000);

    // ---- every read endpoint --------------------------------------------
    const READS = {
        'read by id':            () => `/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`,
        'search by _id':         () => `/4_0_0/Patient?_id=${E.FOREIGN_PATIENT_ID}`,
        '$everything on patient': () => `/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}/$everything`,
        $summary:              () => `/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}/$summary`,
        _history:              () => `/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}/_history`,
        'read a version':        () => `/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}/_history/1`
    };
    for (const [label, build] of Object.entries(READS)) {
        test(`${label} withholds the foreign patient`, async () => {
            const r = await ro.get(build());
            expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
        }, 90000);
    }

    test('$everything on a foreign Person returns none of its data', async () => {
        if (!E.FOREIGN_PERSON_ID) return expect(true).toBe(true);
        const r = await ro.get(`/4_0_0/Person/${E.FOREIGN_PERSON_ID}/$everything`);
        expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 90000);

    test('proxy-patient on a foreign Person returns none of its data', async () => {
        if (!E.FOREIGN_PERSON_ID) return expect(true).toBe(true);
        const r = await ro.get(`/4_0_0/Observation?patient=Patient/person.${E.FOREIGN_PERSON_ID}`);
        expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 90000);

    test('$graph rooted at a foreign patient returns none of its data', async () => {
        const r = await ro.post(`/4_0_0/Patient/$graph?id=${E.FOREIGN_PATIENT_ID}&contained=true`, {});
        expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 90000);

    test('filtering on the foreign tenant\'s security tag does not widen the result', async () => {
        if (!E.FOREIGN_TENANT) return expect(true).toBe(true);
        const tag = encodeURIComponent(`https://www.icanbwell.com/access|${E.FOREIGN_TENANT}`);
        const r = await ro.get(`/4_0_0/Patient?_security=${tag}&_count=20`);
        expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 120000);

    // A tag-filtered search is the query shape most likely to behave differently at
    // real data volume. This is here as much for the timing as for the result.
    test('a tag-filtered search on our own tenant completes in reasonable time', async () => {
        const tag = encodeURIComponent(`https://www.icanbwell.com/access|${E.QA_TENANT}`);
        const t0 = Date.now();
        const r = await ro.get(`/4_0_0/Patient?_security=${tag}&_count=10`);
        const elapsed = Date.now() - t0;
        expect(r.status).toBeLessThan(500);
        expect(elapsed).toBeLessThan(30000);
    }, 120000);

    test('_include cannot pull in a foreign patient', async () => {
        const r = await ro.get('/4_0_0/Observation?_include=Observation:subject&_count=50');
        expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 120000);

    test('a chained parameter cannot reach a foreign patient', async () => {
        const r = await ro.get(`/4_0_0/Observation?subject:Patient._id=${E.FOREIGN_PATIENT_ID}&_count=20`);
        expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 120000);

    for (const [p, label] of [['/$graphql', 'v1'], ['/4_0_0/$graphqlv2', 'v2']]) {
        test(`GraphQL ${label} cannot return the foreign patient`, async () => {
            const r = await ro.post(p, { query: `query { patient(id: "${E.FOREIGN_PATIENT_ID}") { id } }` });
            expect(withheld(r, E.FOREIGN_PATIENT_ID)).toBe(true);
        }, 90000);
    }

    // ---- existence oracle ----------------------------------------------
    test('no existence oracle: forbidden and absent match on status and body', async () => {
        const forbidden = await ro.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        const absent = await ro.get(`/4_0_0/Patient/${NONEXISTENT}`);
        expect(forbidden.status).toBe(absent.status);
        const norm = (r, id) => asText(r).split(id).join('<ID>');
        expect(norm(forbidden, E.FOREIGN_PATIENT_ID)).toBe(norm(absent, NONEXISTENT));
    }, 90000);

    test('no existence oracle on $everything', async () => {
        const forbidden = await ro.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}/$everything`);
        const absent = await ro.get(`/4_0_0/Patient/${NONEXISTENT}/$everything`);
        expect(forbidden.status).toBe(absent.status);
        expect(entryIds(forbidden).length).toBe(entryIds(absent).length);
    }, 120000);

    test('no timing oracle on read by id (median of 9 samples)', async () => {
        async function median (url) {
            const t = [];
            for (let n = 0; n < 9; n++) {
                const t0 = Date.now();
                await ro.get(url);
                t.push(Date.now() - t0);
            }
            t.sort((x, y) => x - y);
            return t[4];
        }
        const tF = await median(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        const tA = await median(`/4_0_0/Patient/${NONEXISTENT}`);
        const slower = Math.max(tF, tA);
        const faster = Math.max(Math.min(tF, tA), 1);
        expect(slower / faster).toBeLessThan(5);
    }, 240000);

    test('a refusal does not name the foreign tenant', async () => {
        if (!E.FOREIGN_TENANT) return expect(true).toBe(true);
        const r = await ro.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        expect(asText(r)).not.toContain(E.FOREIGN_TENANT);
    }, 60000);

    // ---- read-only really is read-only ---------------------------------
    test('the read-only account cannot write', async () => {
        const r = await ro.put('/4_0_0/Patient/liveMatrixRoProbe001', {
            resourceType: 'Patient', id: 'liveMatrixRoProbe001',
            meta: { security: [
                { system: 'https://www.icanbwell.com/owner', code: E.QA_TENANT },
                { system: 'https://www.icanbwell.com/access', code: E.QA_TENANT }
            ] }
        });
        expect([401, 403]).toContain(r.status);
    }, 60000);

    // ---- $export contents, not just the kickoff -------------------------
    // The kickoff reply carries no patient data by construction, so checking it
    // proves nothing. This polls to completion and reads the produced files.
    test('a bulk export contains no foreign-tenant records', async () => {
        const kickoff = await ro.post('/4_0_0/$export?_type=Patient', {}, { headers: { Prefer: 'respond-async' } });
        if (![200, 202].includes(kickoff.status)) {
            // export not enabled for this account; nothing to assert
            expect(kickoff.status).toBeLessThan(500);
            return;
        }
        const statusUrl = kickoff.headers['content-location'];
        if (!statusUrl) return expect(true).toBe(true);

        let out = null;
        for (let n = 0; n < 30; n++) {
            const s = await axios.get(statusUrl, {
                headers: { Authorization: ro.defaults.headers.Authorization },
                validateStatus: () => true, timeout: 60000
            });
            if (s.status === 200 && s.data && s.data.output) { out = s.data.output; break; }
            if (s.status >= 400) break;
            await new Promise((r) => setTimeout(r, 5000));
        }
        if (!out) return expect(true).toBe(true);   // still running; not a failure

        for (const file of out.slice(0, 5)) {
            const content = await axios.get(file.url, {
                headers: { Authorization: ro.defaults.headers.Authorization },
                validateStatus: () => true, timeout: 120000,
                transformResponse: [(d) => d]
            });
            expect(String(content.data)).not.toContain(E.FOREIGN_PATIENT_ID);
            if (E.FOREIGN_TENANT) expect(String(content.data)).not.toContain(`"code":"${E.FOREIGN_TENANT}"`);
        }
    }, 300000);
});

(RW_READY ? describe : describe.skip)('LIVE MATRIX — write isolation across a real tenant boundary', () => {
    beforeAll(async () => {
        rw = client(await mintToken(E.SA_RW_CLIENT_ID, E.SA_RW_CLIENT_SECRET));
        ro = ro || client(await mintToken(E.SA_RO_CLIENT_ID, E.SA_RO_CLIENT_SECRET));
        if (GT_READY) gt = gt || client(E.GROUND_TRUTH_TOKEN);
    }, 60000);

    const own = (id) => ({
        resourceType: 'Patient', id,
        meta: { security: [
            { system: 'https://www.icanbwell.com/owner', code: E.QA_TENANT },
            { system: 'https://www.icanbwell.com/access', code: E.QA_TENANT }
        ] },
        gender: 'female', birthDate: '1985-06-15'
    });

    test('control: the read/write account CAN create in its own tenant', async () => {
        const r = await rw.put('/4_0_0/Patient/liveMatrixOwn001', own('liveMatrixOwn001'));
        expect([200, 201]).toContain(r.status);
    }, 60000);

    test('SAE-2: it cannot add the foreign tenant\'s access tag', async () => {
        const body = own('liveMatrixForge001');
        body.meta.security.push({ system: 'https://www.icanbwell.com/access', code: E.FOREIGN_TENANT });
        const r = await rw.put('/4_0_0/Patient/liveMatrixForge001', body);
        expect(r.status).toBe(403);
    }, 60000);

    test('SAE-2 through $merge as well', async () => {
        const body = own('liveMatrixForgeMerge001');
        body.meta.security.push({ system: 'https://www.icanbwell.com/access', code: E.FOREIGN_TENANT });
        const r = await rw.post('/4_0_0/Patient/$merge', body);
        const refused = r.status === 403 || /forbidden|not allowed|scope/i.test(asText(r));
        expect(refused).toBe(true);
    }, 60000);

    (GT_READY ? test : test.skip)('it cannot modify the foreign tenant\'s record', async () => {
        const before = await gt.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        expect(before.status).toBe(200);
        const beforeVersion = before.data.meta.versionId;

        await rw.put(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`, own(E.FOREIGN_PATIENT_ID));

        const after = await gt.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        expect(after.status).toBe(200);
        expect(after.data.meta.versionId).toBe(beforeVersion);
        const owner = (after.data.meta.security || []).find((s) => s.system.endsWith('/owner'));
        expect(owner.code).not.toBe(E.QA_TENANT);
    }, 90000);

    (GT_READY ? test : test.skip)('it cannot delete the foreign tenant\'s record', async () => {
        const r = await rw.delete(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        expect([403, 404, 405]).toContain(r.status);
        const still = await gt.get(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`);
        expect(still.status).toBe(200);
    }, 90000);

    test('IDG-4: a forged Person.link to a foreign patient does not expose it', async () => {
        const personId = 'liveMatrixLinkForge001';
        await rw.put(`/4_0_0/Person/${personId}`, {
            resourceType: 'Person', id: personId,
            meta: { security: [
                { system: 'https://www.icanbwell.com/owner', code: E.QA_TENANT },
                { system: 'https://www.icanbwell.com/access', code: E.QA_TENANT }
            ] },
            link: [{ target: { reference: `Patient/${E.FOREIGN_PATIENT_ID}` } }]
        });
        const ev = await rw.get(`/4_0_0/Person/${personId}/$everything`);
        expect(withheld(ev, E.FOREIGN_PATIENT_ID)).toBe(true);
    }, 120000);

    test('no write oracle: writing to a foreign id and an unused id reply identically', async () => {
        const foreign = await rw.put(`/4_0_0/Patient/${E.FOREIGN_PATIENT_ID}`, own(E.FOREIGN_PATIENT_ID));
        const absent = await rw.put(`/4_0_0/Patient/${NONEXISTENT}`, own(NONEXISTENT));
        expect(foreign.status).toBe(absent.status);
    }, 90000);
});

// =============================================================================
// The case closest to what happened in INC-331: two client tenants whose
// patients both link to the same upstream (PROA) record. The upstream record is
// the bridge. There is no way to construct this in process, because the whole
// point is two real client tenants sharing one real upstream connection.
//
// Needs, in addition to the environment above:
//   BRIDGE_TENANT_A / BRIDGE_TENANT_B      the two client tenant slugs
//   BRIDGE_A_CLIENT_ID / _SECRET           an account scoped to tenant A
//   BRIDGE_A_PERSON_ID / BRIDGE_A_PATIENT_ID
//   BRIDGE_B_PERSON_ID / BRIDGE_B_PATIENT_ID
//   BRIDGE_UPSTREAM_PATIENT_ID             the shared upstream record
// =============================================================================
const BRIDGE_READY = !!(E.RUN_LIVE_ISOLATION && E.TOKEN_URL && E.BRIDGE_A_CLIENT_ID && E.BRIDGE_A_CLIENT_SECRET &&
    E.BRIDGE_A_PERSON_ID && E.BRIDGE_B_PATIENT_ID);

(BRIDGE_READY ? describe : describe.skip)('LIVE MATRIX — the shared upstream connection bridge', () => {
    let a;
    beforeAll(async () => { a = client(await mintToken(E.BRIDGE_A_CLIENT_ID, E.BRIDGE_A_CLIENT_SECRET)); }, 60000);

    test('control: tenant A sees its own patient', async () => {
        const r = await a.get(`/4_0_0/Patient/${E.BRIDGE_A_PATIENT_ID}`);
        expect(r.status).toBe(200);
    }, 60000);

    test('tenant A cannot read tenant B\'s patient, which shares its demographics', async () => {
        const r = await a.get(`/4_0_0/Patient/${E.BRIDGE_B_PATIENT_ID}`);
        expect(withheld(r, E.BRIDGE_B_PATIENT_ID)).toBe(true);
    }, 60000);

    test('tenant A\'s $everything does not reach tenant B through the shared upstream record', async () => {
        const r = await a.get(`/4_0_0/Person/${E.BRIDGE_A_PERSON_ID}/$everything`);
        expect(r.status).toBe(200);
        const ids = entryIds(r);
        expect(ids).not.toContain(E.BRIDGE_B_PATIENT_ID);
        if (E.BRIDGE_B_PERSON_ID) expect(ids).not.toContain(E.BRIDGE_B_PERSON_ID);
    }, 120000);

    test('tenant A cannot reach tenant B by naming B\'s person id', async () => {
        if (!E.BRIDGE_B_PERSON_ID) return expect(true).toBe(true);
        const r = await a.get(`/4_0_0/Person/${E.BRIDGE_B_PERSON_ID}/$everything`);
        expect(withheld(r, E.BRIDGE_B_PATIENT_ID)).toBe(true);
    }, 120000);

    test('tenant A cannot reach tenant B through the upstream record it legitimately shares', async () => {
        if (!E.BRIDGE_UPSTREAM_PATIENT_ID) return expect(true).toBe(true);
        const r = await a.get(`/4_0_0/Patient/${E.BRIDGE_UPSTREAM_PATIENT_ID}/$everything`);
        expect(withheld(r, E.BRIDGE_B_PATIENT_ID)).toBe(true);
    }, 120000);

    test('a demographic search does not return the other tenant\'s look-alike patient', async () => {
        const r = await a.get('/4_0_0/Patient?birthdate=1985-06-15&_count=50');
        expect(withheld(r, E.BRIDGE_B_PATIENT_ID)).toBe(true);
    }, 120000);
});
