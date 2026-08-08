// ============================================================================
// Verification case coverage: end-user isolation (the "like-users" case)
//   C8 / SAE-3  a patient-scoped end-user token reaches ONLY its own linked graph,
//               never another end user's data — even when the two users have IDENTICAL
//               demographics and live under the same client tenant.
//   SAE-4       reading the other user's resource by id is indistinguishable from not-found.
//
// Models the Bob Kent scenario faithfully: each user is a bwell master Person -> client
// Person -> Patient (+Observation); both users share name/DOB/gender and tenant. The token
// is anchored (clientFhirPersonId/bwellFhirPersonId) to user A's master Person; the only
// thing that may separate the users is the patient-scope link graph.
// MOCKED-INTEGRATION. LIVE validation on the real staging Bob Kent identities is blocked
// (service accounts denied) — plan Section 5.2.
// ============================================================================
const masterA = require('./fixtures/person/master_a.json');
const clientA = require('./fixtures/person/client_a.json');
const patientA = require('./fixtures/patient/patient_a.json');
const obsA = require('./fixtures/observation/obs_a.json');
const masterB = require('./fixtures/person/master_b.json');
const clientB = require('./fixtures/person/client_b.json');
const patientB = require('./fixtures/patient/patient_b.json');
const obsB = require('./fixtures/observation/obs_b.json');

const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

// End-user token shape. These claims and this scope string are COPIED FROM A REAL
// staging end-user access token (issued by the end-user Cognito pool), not invented:
//   scope = 'access/*.* user/*.* patient/*.*'
//   claims: clientFhirPersonId, clientFhirPatientId, bwellFhirPersonId,
//           bwellFhirPatientId, managingOrganization, client_key, username
// The wildcard `access/*.*` matters: it means NO tenant access-tag filter applies to an
// end-user request, so the ONLY thing separating two users is the patient-scope link
// graph. Testing with a narrower `patient/*.*` would exercise a stricter configuration
// than production actually issues. Verified empirically: both scope strings produce
// identical isolation results here, but the real one is what we ship, so assert on it.
const REAL_END_USER_SCOPE = 'access/*.* user/*.* patient/*.*';

function endUser(masterPersonId, clientPersonId) {
  return getHeadersWithCustomPayload({
    scope: REAL_END_USER_SCOPE,
    username: 'end-user@example.com',
    // real tokens carry DISTINCT client vs bwell (master) person ids
    clientFhirPersonId: clientPersonId || masterPersonId,
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: masterPersonId,
    bwellFhirPatientId: 'bwellFhirPatient',
    managingOrganization: 'bwell_demo',
    token_use: 'access'
  });
}
const all = [masterA, clientA, patientA, obsA, masterB, clientB, patientB, obsB];
async function seed() {
  const request = await createTestRequest();
  const resp = await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
  expect(resp).toHaveMergeResponse({ created: true });
  return request;
}
const ids = r => (Array.isArray(r.body) ? r.body : []).map(x => x && x.id).filter(Boolean);

describe('End-user cross-user isolation (identical demographics, patient-scoped)', () => {
  beforeEach(async () => { await commonBeforeEach(); });
  afterEach(async () => { await commonAfterEach(); });

  test('positive control: user A sees its OWN observation via its own graph', async () => {
    const request = await seed();
    const resp = await request.get('/4_0_0/Observation?patient=Patient/person.euMasterA').set(endUser('euMasterA'));
    expect(resp.status).toBe(200);
    expect(ids(resp)).toContain('euUserAObs001');
  });

  test('user A must NOT receive user B\'s observation from its own graph query', async () => {
    const request = await seed();
    const resp = await request.get('/4_0_0/Observation?patient=Patient/person.euMasterA').set(endUser('euMasterA'));
    expect(ids(resp)).not.toContain('euUserBObs001');
  });

  // REACHABILITY CONTROL for every "A cannot see B" assertion below. Without this, an
  // empty result caused by a broken fixture, a dangling Person.link, or a malformed query
  // is indistinguishable from correct isolation, and the tests would pass with all access
  // control removed. This proves B's data IS reachable -- by B.
  test('reachability control: user B CAN see its own observation and patient', async () => {
    const request = await seed();
    const graph = await request.get('/4_0_0/Observation?patient=Patient/person.euMasterB').set(endUser('euMasterB', 'euClientB'));
    expect(graph.status).toBe(200);
    expect(ids(graph)).toContain('euUserBObs001');
    const byId = await request.get('/4_0_0/Patient/euUserBPatient001').set(endUser('euMasterB', 'euClientB'));
    expect(byId.status).toBe(200);
  });

  test('user A must NOT reach user B\'s graph by substituting user B\'s person id', async () => {
    const request = await seed();
    const resp = await request.get('/4_0_0/Observation?patient=Patient/person.euMasterB').set(endUser('euMasterA', 'euClientA'));
    // Deliberately NOT `expect([200,401,403,404]).toContain(status)` -- that admits every
    // possible status and asserts nothing. Either the request is refused, or it succeeds
    // and returns nothing of B's; a 5xx is a bug either way.
    expect([200, 403, 404]).toContain(resp.status);
    expect(ids(resp)).not.toContain('euUserBObs001');
    expect(ids(resp)).not.toContain('euUserBPatient001');
  });

  test('user A reading user B\'s Patient by id is indistinguishable from not-found', async () => {
    const request = await seed();
    const foreign = await request.get('/4_0_0/Patient/euUserBPatient001').set(endUser('euMasterA', 'euClientA'));
    const missing = await request.get('/4_0_0/Patient/euNoSuchPatient999').set(endUser('euMasterA', 'euClientA'));
    expect([401, 403, 404]).toContain(foreign.status);
    expect(foreign.status).toBe(missing.status);
    // status parity alone is a weak oracle check -- the body must not differ either
    expect(JSON.stringify(foreign.body).replace(/euUserBPatient001/g, 'X'))
      .toBe(JSON.stringify(missing.body).replace(/euNoSuchPatient999/g, 'X'));
  });

  test('user A\'s open Patient search must not return user B\'s patient', async () => {
    const request = await seed();
    const resp = await request.get('/4_0_0/Patient?_count=20').set(endUser('euMasterA', 'euClientA'));
    expect(resp.status).toBe(200);
    expect(ids(resp)).toContain('euUserAPatient001');   // positive half: search works
    expect(ids(resp)).not.toContain('euUserBPatient001');
  });
});
