// ============================================================================
// SEC-1580 CASE COVERAGE:
//   A2         tenant reads a resource explicitly access-tagged for it (different owner)
//   A3 / SAE-1 tenant cannot read a resource tagged only for another tenant; never sees its data
//   D-IDG5 / IDG-5  an untagged PROA patient reachable ONLY via Person.link is not returned
//   A3 / SAE-4 foreign patient by id is indistinguishable from not-found
// MOCKED-LOGIC. LIVE validation blocked (staging service accounts denied) — plan Section 5.2.
// ============================================================================
// =============================================================================
// SEC-1580 — Cross-tenant isolation on $everything / Person.link traversal.
//
// Scope covered here (see FHIR Server Security & Data Model Specification):
//   SAE-1  A resource is visible to a caller holding at least one matching access tag.
//   IDG-3  A cross-owner Person.link hop is a legitimate traversal step, BUT
//   IDG-5  every resource reached via traversal must independently pass the caller's
//          access check — reachability via a link is NOT authorization.
//   SAE-4  A by-identifier read of a resource the caller isn't entitled to must be
//          indistinguishable from "not found" (no existence oracle).
//
// Real-world origin: on staging, two upstream PROA Patient records were found reachable
// via Person.link from five unrelated client tenants' Persons, carrying none of those
// tenants' access tags and with no Consent naming them. This models that exact shape
// with synthetic tenants (tenantA / tenantB / upstream_proa_source) so it can run in CI
// against the server's real authorization code.
//
// POLARITY: every assertion states the SECURE, correct outcome. These tests PASS on a
// correctly-isolated server and FAIL only when isolation is actually broken; a fix makes
// them pass again. There are no "expected to fail" tests here.
// =============================================================================

const tenantAPersonResource = require('./fixtures/person/tenant_a_person.json');
const tenantBPersonResource = require('./fixtures/person/tenant_b_person.json');
const tenantAOwnPatientResource = require('./fixtures/patient/tenant_a_own_patient.json');
const tenantBOwnPatientResource = require('./fixtures/patient/tenant_b_own_patient.json');
const accessTagSharedPatientResource = require('./fixtures/patient/access_tag_shared_patient.json');
const sharedProaPatientNoConsentResource = require('./fixtures/patient/shared_proa_patient_no_consent.json');
const observationTenantAOwnResource = require('./fixtures/observation/observation_tenant_a_own.json');
const observationTenantBOwnResource = require('./fixtures/observation/observation_tenant_b_own.json');
const observationAccessTagSharedResource = require('./fixtures/observation/observation_access_tag_shared.json');
const observationSharedNoConsentResource = require('./fixtures/observation/observation_shared_no_consent.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const allResources = [
    tenantAPersonResource, tenantBPersonResource,
    tenantAOwnPatientResource, tenantBOwnPatientResource,
    accessTagSharedPatientResource, sharedProaPatientNoConsentResource,
    observationTenantAOwnResource, observationTenantBOwnResource,
    observationAccessTagSharedResource, observationSharedNoConsentResource
];

// prefer global_id=false so the response echoes the source ids in our fixtures rather
// than the server's derived uuids, keeping assertions readable (same pattern the repo's
// own person_or_patient.test.js uses).
const tenantAHeaders = { ...getHeaders('user/*.read access/tenantA.*'), prefer: 'global_id=false' };
const tenantBHeaders = { ...getHeaders('user/*.read access/tenantB.*'), prefer: 'global_id=false' };

function idsInEverything (resp) {
    return ((resp.body && resp.body.entry) || [])
        .map((e) => e.resource && e.resource.id)
        .filter(Boolean);
}

async function seed () {
    const request = await createTestRequest();
    const resp = await request
        .post('/4_0_0/Person/1/$merge')
        .send(allResources)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
    return request;
}

describe('SEC-1580 cross-tenant isolation on $everything', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    // ---- Positive controls: prove the harness CAN see legitimately-authorized data,
    // so a passing security assertion below means "correctly hidden", not "nothing came back".
    test('SAE-1 positive control: tenantA sees its own data', async () => {
        const request = await seed();
        const resp = await request.get(`/4_0_0/Person/${tenantAPersonResource.id}/$everything`).set(tenantAHeaders);
        expect(resp.status).toBe(200);
        const ids = idsInEverything(resp);
        expect(ids).toEqual(expect.arrayContaining([tenantAOwnPatientResource.id, observationTenantAOwnResource.id]));
    });

    // SAE-1 is cleanly observable on a direct read: the access tag governs visibility
    // regardless of resource owner. ($everything scopes by owner + consent and is NOT the
    // right lens for the access-tag rule, so it's asserted here by id.)
    test('SAE-1 positive: tenantA CAN read a resource tagged access=tenantA even though another tenant owns it', async () => {
        const request = await seed();
        const resp = await request.get(`/4_0_0/Patient/${accessTagSharedPatientResource.id}`).set(tenantAHeaders);
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe(accessTagSharedPatientResource.id);
    });

    test('SAE-1 enforcement: tenantB CANNOT read that same tenantA-tagged resource', async () => {
        const request = await seed();
        const resp = await request.get(`/4_0_0/Patient/${accessTagSharedPatientResource.id}`).set(tenantBHeaders);
        expect([403, 404]).toContain(resp.status);
    });

    // ---- REACHABILITY CONTROL -------------------------------------------------
    // This is the load-bearing control for every IDG-5 assertion below. Those assertions
    // say "the PROA patient is NOT returned to a scoped caller". That statement is only
    // meaningful if the patient is returned to SOMEONE -- otherwise the test would also
    // pass against a dangling Person.link, a fixture that failed to persist, or a typo'd
    // sourceAssigningAuthority, and would keep passing with every access check in the
    // server deleted.
    //
    // Note the `|upstream_proa_source` suffix on the link targets in the person fixtures:
    // ReferenceGlobalIdHandler derives a link target's _uuid as uuidv5(id|SAA) and defaults
    // the SAA to the PARENT resource's when the reference omits it. Without the suffix these
    // cross-owner links resolve to a uuid that does not exist and the traversal silently
    // returns nothing. Verified: dropping the suffix makes the two IDG-5 tests below pass
    // for the wrong reason.
    test('reachability control: the PROA patient IS returned via Person.link to a full-access caller', async () => {
        const request = await seed();
        const resp = await request
            .get(`/4_0_0/Person/${tenantAPersonResource.id}/$everything`)
            .set({ ...getHeaders('user/*.read access/*.*'), prefer: 'global_id=false' });
        expect(resp.status).toBe(200);
        const ids = idsInEverything(resp);
        // If either of these fails, the IDG-5 assertions below are vacuous -- fix the
        // fixture link targets before trusting them.
        expect(ids).toContain(sharedProaPatientNoConsentResource.id);
        expect(ids).toContain(observationSharedNoConsentResource.id);
    });

    // ---- Security assertions: correct = hidden.
    test('IDG-5: tenantA must NOT see the untagged PROA patient reachable only via Person.link', async () => {
        const request = await seed();
        const resp = await request.get(`/4_0_0/Person/${tenantAPersonResource.id}/$everything`).set(tenantAHeaders);
        const ids = idsInEverything(resp);
        expect(ids).not.toContain(sharedProaPatientNoConsentResource.id);
        expect(ids).not.toContain(observationSharedNoConsentResource.id);
    });

    test('IDG-5: tenantB must NOT see the untagged PROA patient reachable only via Person.link', async () => {
        const request = await seed();
        const resp = await request.get(`/4_0_0/Person/${tenantBPersonResource.id}/$everything`).set(tenantBHeaders);
        const ids = idsInEverything(resp);
        expect(ids).not.toContain(sharedProaPatientNoConsentResource.id);
        expect(ids).not.toContain(observationSharedNoConsentResource.id);
    });

    test('SAE-1: tenantB must NOT see the resource tagged only for tenantA', async () => {
        const request = await seed();
        const resp = await request.get(`/4_0_0/Person/${tenantBPersonResource.id}/$everything`).set(tenantBHeaders);
        const ids = idsInEverything(resp);
        expect(ids).not.toContain(accessTagSharedPatientResource.id);
        expect(ids).not.toContain(observationAccessTagSharedResource.id);
        expect(ids).not.toContain(tenantAOwnPatientResource.id);
    });

    test('SAE-4: reading a foreign tenant\'s Patient by id is indistinguishable from not-found', async () => {
        const request = await seed();
        const nonexistentId = 'thisPatientDoesNotExist000';
        const foreign = await request.get(`/4_0_0/Patient/${sharedProaPatientNoConsentResource.id}`).set(tenantBHeaders);
        const missing = await request.get(`/4_0_0/Patient/${nonexistentId}`).set(tenantBHeaders);
        // The foreign read must actually be denied (not 200) AND be indistinguishable from a
        // nonexistent id. Pinning the status prevents a vacuous pass if both were ever 200.
        expect([403, 404]).toContain(foreign.status);
        expect(foreign.status).toBe(missing.status);
    });
});
