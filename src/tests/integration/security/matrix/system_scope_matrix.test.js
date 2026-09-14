// =============================================================================
// SMART on FHIR v2 `system/` SCOPE — cross-cutting negative matrix.
//
// `system/` is unioned with `user/` at the resource-type/action gate behind
// ENABLE_SMART_V2_SYSTEM_SCOPES (see
// docs/superpowers/plans/2026-09-12-smart-v2-system-scope-design.md §1/§2). Every
// group below pins one way that union must NOT widen access beyond what an
// equivalent `user/` caller already gets. Each negative is paired, where
// practical, with a positive control proving the withheld resource is reachable
// to somebody -- so a passing negative is meaningful, not just an empty fixture.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload, getHeadersWithCustomToken, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('./matrixFixtures');

const sysHeaders = (scope) => ({ ...getHeaders(scope), prefer: 'global_id=false' });

async function seed () {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(F.ALL).set(getHeaders());
    expect(resp.body.length).toBe(F.ALL.length);
    resp.body.forEach((r) => expect(r).toEqual(expect.objectContaining({ created: true })));
    return request;
}

function resIds (resp) {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
}

describe('SECURITY MATRIX — SMART v2 system/ scope, cross-cutting negatives', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_SMART_V2_SYSTEM_SCOPES;
    beforeEach(async () => {
        process.env.ENABLE_SMART_V2_SYSTEM_SCOPES = '1';
        await commonBeforeEach();
    });
    afterEach(async () => {
        process.env.ENABLE_SMART_V2_SYSTEM_SCOPES = ORIGINAL_FLAG;
        await commonAfterEach();
    });

    // -----------------------------------------------------------------------
    // A. system/ alone is not a tenant grant -- access/ is still mandatory.
    // -----------------------------------------------------------------------
    describe('A. system/ != access/', () => {
        test('system/*.* with no access/ scope is refused', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient?_count=100').set(sysHeaders('system/*.*'));
            expect(resp.status).toBe(403);
        });

        test('system/Patient.read with no access/ scope is refused', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient?_count=100').set(sysHeaders('system/Patient.read'));
            expect(resp.status).toBe(403);
        });

        // Positive control: the equivalent caller WITH an access/ code succeeds --
        // proving the 403 above is the access/ gate, not a broken system/ matcher.
        test('control: system/*.* WITH access/tenanta.* succeeds', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient?_count=100').set(sysHeaders('system/*.* access/tenanta.*'));
            expect(resp.status).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // B. Tenant boundary -- a system/ caller is confined to its access/ tag,
    // exactly like a user/ caller.
    // -----------------------------------------------------------------------
    describe('B. tenant boundary', () => {
        test('a tenanta system/ caller cannot read tenantb\'s patient by id', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient/mtxOwnB').set(sysHeaders('system/*.* access/tenanta.*'));
            expect([403, 404]).toContain(resp.status);
        });

        test('a tenanta system/ caller\'s search has exactly its own tenant\'s patients', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient?_count=100').set(sysHeaders('system/*.* access/tenanta.*'));
            expect(resp.status).toBe(200);
            const got = resIds(resp);
            expect(got).toEqual(expect.arrayContaining(['mtxOwnA', 'mtxSharedAB']));
            expect(got).not.toContain('mtxOwnB');
            expect(got).not.toContain('mtxProa');
            expect(got).not.toContain('mtxIas');
        });

        test('a tenanta system/ caller cannot PUT a new record carrying tenantb\'s tag', async () => {
            const request = await seed();
            const forged = {
                resourceType: 'Patient', id: 'mtxSysForgeNew001',
                meta: { source: F.T_A, security: F.sec(F.T_A, [F.T_A, F.T_B]) },
                gender: 'female', birthDate: '1985-06-15'
            };
            const resp = await request.put('/4_0_0/Patient/mtxSysForgeNew001').send(forged)
                .set(sysHeaders('system/*.read system/*.write access/tenanta.*'));
            expect(resp.status).toBe(403);
        });

        test('a tenanta system/ caller cannot PATCH in tenantb\'s access tag', async () => {
            const request = await seed();
            const resp = await request.patch('/4_0_0/Patient/mtxOwnA')
                .send([{ op: 'add', path: '/meta/security/-', value: { system: F.ACCESS, code: F.T_B } }])
                .set({ ...sysHeaders('system/*.read system/*.write access/tenanta.*'), 'Content-Type': 'application/json-patch+json' });
            expect([400, 403, 404, 405, 422]).toContain(resp.status);
            const asB = await request.get('/4_0_0/Patient/mtxOwnA').set(sysHeaders('system/*.read access/tenantb.*'));
            expect([403, 404]).toContain(asB.status);
        });
    });

    // -----------------------------------------------------------------------
    // C. patient/ + system/ must behave identically to patient/ + user/: read
    // allowed, write to a non-patient-filterable type refused.
    // -----------------------------------------------------------------------
    describe('C. patient/ + system/ write restriction', () => {
        // patient/ sets isUser, which requires the standard identity claims on the JWT
        // (authService.js's requiredJWTFields check) -- mirrors
        // patientScope/create_with_patient_scope/create_without_patient_scope.test.js.
        const patientAndSystemHeaders = getHeadersWithCustomPayload({
            scope: 'patient/*.read system/*.* access/*.*',
            username: 'matrix-system-user@example.com',
            clientFhirPersonId: 'clientFhirPerson',
            clientFhirPatientId: 'clientFhirPatient',
            bwellFhirPersonId: 'bwellFhirPerson',
            bwellFhirPatientId: 'bwellFhirPatient',
            token_use: 'access'
        });

        test('patient/*.read system/*.* cannot write a non-patient-filterable type', async () => {
            const request = await seed();
            const org = { resourceType: 'Organization', id: 'mtxSysOrg001', meta: { source: F.T_A, security: F.sec(F.T_A, [F.T_A]) }, name: 'Test Org' };
            const resp = await request.put('/4_0_0/Organization/mtxSysOrg001').send(org).set(patientAndSystemHeaders);
            expect(resp.status).toBe(403);
            expect(JSON.stringify(resp.body)).toContain(
                'Write not allowed using user scopes if patient scope is present'
            );
        });

        // Positive control: the identical caller, minus the patient/ scope, can write.
        test('control: system/*.* alone (no patient/) CAN write an Organization', async () => {
            const request = await seed();
            const org = { resourceType: 'Organization', id: 'mtxSysOrg002', meta: { source: F.T_A, security: F.sec(F.T_A, [F.T_A]) }, name: 'Test Org 2' };
            const resp = await request.put('/4_0_0/Organization/mtxSysOrg002').send(org)
                .set(sysHeaders('system/*.read system/*.write access/*.*'));
            expect([200, 201]).toContain(resp.status);
        });
    });

    // -----------------------------------------------------------------------
    // D. Identity binding -- system/ never sets isUser, so a stray person claim
    // on a backend-services token must be inert, and its ABSENCE must not 401.
    // -----------------------------------------------------------------------
    describe('D. identity binding is inert for system/ callers', () => {
        test('a clientFhirPersonId claim on a system/ token does not grant that person\'s data', async () => {
            const request = await seed();
            // No patient/ scope, so isUser stays false and this claim is never consulted --
            // it must not act as a back door into personB's record.
            const resp = await request.get('/4_0_0/Patient/mtxOwnB').set(getHeadersWithCustomPayload({
                scope: 'system/*.* access/tenanta.*',
                username: 'matrix-system-service',
                clientFhirPersonId: 'mtxPersonB',
                bwellFhirPersonId: 'mtxPersonB',
                token_use: 'access'
            }));
            expect([403, 404]).toContain(resp.status);
        });

        test('a system/ token with no person claims at all still reaches its own tenant\'s data', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient/mtxOwnA').set(sysHeaders('system/*.* access/tenanta.*'));
            expect(resp.status).toBe(200);
            expect(resp.body.id).toBe('mtxOwnA');
        });
    });

    // -----------------------------------------------------------------------
    // E. History requires a non-tenant-specific access scope, same as user/.
    // -----------------------------------------------------------------------
    describe('E. history gate', () => {
        test('a tenant-scoped system/ caller cannot read history, even its own', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient/mtxOwnA/_history').set(sysHeaders('system/*.* access/tenanta.*'));
            expect(resp.status).toBe(403);
        });

        test('control: a wildcard-scoped system/ caller can read history', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient/mtxOwnA/_history').set(sysHeaders('system/*.* access/*.*'));
            expect([200, 404]).toContain(resp.status);
        });
    });

    // -----------------------------------------------------------------------
    // G. admin.js unification (§4.1): the real scope gate now runs for
    // deletePatientDataGraph, so a system/ token needs admin/ + access/ (like
    // any other), and a patient-scoped token is refused regardless of admin/.
    // -----------------------------------------------------------------------
    describe('G. admin unification', () => {
        // getHeadersWithCustomToken's underlying token always injects `groups: ['access/*.*']`
        // (see src/tests/integration/common.js's getTokenWithCustomClaims), which would grant
        // an access/ code the test is trying to withhold. Use getHeadersWithCustomPayload
        // (no implicit groups) so the scope string is exactly what each test declares.
        test('admin/*.write system/Patient.write is refused without an access/ code', async () => {
            const request = await seed();
            const resp = await request.delete('/admin/deletePatientDataGraph?id=mtxOwnB&sync=1')
                .set(getHeadersWithCustomPayload({ scope: 'admin/*.write system/Patient.write', token_use: 'access' }));
            expect(resp.status).toBe(403);
            const still = await request.get('/4_0_0/Patient/mtxOwnB').set(sysHeaders('user/*.* access/*.*'));
            expect(still.status).toBe(200);
        });

        // A patient-scoped token authorizing a destructive admin operation is exactly
        // what the resource-type gate's write restriction forbids on every other FHIR
        // path. Unifying admin.js onto the real scopesValidator (§4.1) closes this.
        test('admin/*.write patient/*.* is refused -- a patient-scoped token cannot run a destructive admin op', async () => {
            const request = await seed();
            const resp = await request.delete('/admin/deletePatientDataGraph?id=mtxOwnB&sync=1').set(getHeadersWithCustomPayload({
                scope: 'admin/*.write patient/*.* access/*.*',
                username: 'matrix-system-user2@example.com',
                clientFhirPersonId: 'clientFhirPerson2',
                clientFhirPatientId: 'clientFhirPatient2',
                bwellFhirPersonId: 'bwellFhirPerson2',
                bwellFhirPatientId: 'bwellFhirPatient2',
                token_use: 'access'
            }));
            expect(resp.status).toBe(403);
            const still = await request.get('/4_0_0/Patient/mtxOwnB').set(sysHeaders('user/*.* access/*.*'));
            expect(still.status).toBe(200);
        });

        // deletePatientDataGraphAsync internally re-runs $everything, which needs read
        // access to Patient in addition to the write access.write's own gate checks, so
        // the success case needs system/Patient.* (read+write), not .write alone.
        test('control: admin/*.write system/Patient.* WITH access/*.* succeeds', async () => {
            const request = await seed();
            const resp = await request.delete('/admin/deletePatientDataGraph?id=mtxOwnB&sync=1')
                .set(getHeadersWithCustomToken('admin/*.write system/Patient.* access/*.*'));
            expect([200, 202]).toContain(resp.status);
        });
    });

    // -----------------------------------------------------------------------
    // J. Malformed / near-miss scope strings must never be treated as system/.
    // -----------------------------------------------------------------------
    describe('J. malformed scope strings', () => {
        const MALFORMED = ['System/Patient.read', 'SYSTEM/*.*', 'system/', 'system/*', 'system', 'systemfoo/*.*', 'system/*.'];
        for (const bad of MALFORMED) {
            test(`'${bad} access/tenantb.*' never resolves to tenantb's patient`, async () => {
                const request = await seed();
                const resp = await request.get('/4_0_0/Patient/mtxOwnB')
                    .set(sysHeaders(`${bad} access/tenantb.*`));
                expect(resp.status).not.toBe(200);
            });
        }
    });
});
