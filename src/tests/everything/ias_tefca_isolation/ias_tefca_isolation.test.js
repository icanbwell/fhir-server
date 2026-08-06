// ============================================================================
// SEC-1580 CASE COVERAGE (IAS / TEFCA):
//   A1              tenant sees its own non-IAS data (positive control)
//   D-IDG5 / IDG-5  IAS (connectionType=ias) record reachable only via Person.link, no tag/
//                   consent, is not returned
//   A3 / SAE-4      IAS record by id is indistinguishable from not-found
// MOCKED-LOGIC. LIVE validation blocked (staging service accounts denied) — plan Section 5.2.
// ============================================================================
// =============================================================================
// IAS / TEFCA isolation parity (connectionType=ias).
//
// Context (Confluence: "TEFCA IAS on FHIR pilot with Epic", "EPIC IAS Integration",
// "Task Lifecycle"; fhir-server release notes DCON-4598): IAS is b.well's TEFCA
// Individual-Access path. IAS-sourced records are stored with connectionType=ias and
// owned by the upstream source (e.g. tc_epic, cms_bluebutton), reached via Person.link.
// Per DCON-4598 the INC-331 fix explicitly scopes "PROA/IAS patients across all
// $everything chunks" — IAS rides the SAME consent-gated expansion path as PROA.
//
// This asserts the config-independent isolation floor: an IAS-connectionType upstream
// record reachable ONLY via Person.link, carrying neither the caller's access tag nor a
// consent, must never be returned. (Whether IAS is *also* consent-unlockable depends on
// CONSENT_CONNECTION_TYPES_LIST including 'ias' — a separate, config-dependent test.)
//
// POLARITY: secure = pass.
// =============================================================================
const tenantAPerson = require('./fixtures/person/tenant_a_person.json');
const tenantAOwnPatient = require('./fixtures/patient/tenant_a_own_patient.json');
const iasUpstreamPatient = require('./fixtures/patient/ias_upstream_patient.json');
const iasUpstreamObservation = require('./fixtures/observation/ias_upstream_observation.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const all = [tenantAPerson, tenantAOwnPatient, iasUpstreamPatient, iasUpstreamObservation];
const tenantAHeaders = { ...getHeaders('user/*.read access/tenantA.*'), prefer: 'global_id=false' };
const tenantBHeaders = { ...getHeaders('user/*.read access/tenantB.*'), prefer: 'global_id=false' };

async function seed() {
  const request = await createTestRequest();
  const resp = await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
  expect(resp).toHaveMergeResponse({ created: true });
  return request;
}
function ids(resp) {
  return ((resp.body && resp.body.entry) || []).map(e => e.resource && e.resource.id).filter(Boolean);
}

describe('IAS/TEFCA connectionType=ias isolation', () => {
  beforeEach(async () => { await commonBeforeEach(); });
  afterEach(async () => { await commonAfterEach(); });

  test('positive control: tenantA sees its own (non-IAS) data', async () => {
    const request = await seed();
    const resp = await request.get(`/4_0_0/Person/${tenantAPerson.id}/$everything`).set(tenantAHeaders);
    expect(resp.status).toBe(200);
    expect(ids(resp)).toEqual(expect.arrayContaining([tenantAOwnPatient.id]));
  });

  test('tenantA must NOT receive the IAS upstream patient/observation (no tag, no consent)', async () => {
    const request = await seed();
    const resp = await request.get(`/4_0_0/Person/${tenantAPerson.id}/$everything`).set(tenantAHeaders);
    const got = ids(resp);
    expect(got).not.toContain(iasUpstreamPatient.id);
    expect(got).not.toContain(iasUpstreamObservation.id);
  });

  test('tenantB (unrelated) must NOT read the IAS upstream patient by id, and gets no existence oracle', async () => {
    const request = await seed();
    const foreign = await request.get(`/4_0_0/Patient/${iasUpstreamPatient.id}`).set(tenantBHeaders);
    const missing = await request.get('/4_0_0/Patient/iasDoesNotExist000').set(tenantBHeaders);
    expect([403, 404]).toContain(foreign.status);
    expect(foreign.status).toBe(missing.status);
  });
});
