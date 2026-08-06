// ============================================================================
// SEC-1580 CASE COVERAGE — END-USER cross-user isolation (the "like-users" case)
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

// Patient-scoped end-user token anchored to a bwell master Person id.
function endUser(masterPersonId) {
  return getHeadersWithCustomPayload({
    scope: 'patient/*.*',
    username: 'end-user@example.com',
    clientFhirPersonId: masterPersonId,
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: masterPersonId,
    bwellFhirPatientId: 'bwellFhirPatient',
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

  test('user A must NOT reach user B\'s graph by substituting user B\'s person id', async () => {
    const request = await seed();
    const resp = await request.get('/4_0_0/Observation?patient=Patient/person.euMasterB').set(endUser('euMasterA'));
    expect([200, 401, 403, 404]).toContain(resp.status); // blocked, or empty — never B's data
    expect(ids(resp)).not.toContain('euUserBObs001');
  });

  test('user A reading user B\'s Patient by id is indistinguishable from not-found', async () => {
    const request = await seed();
    const foreign = await request.get('/4_0_0/Patient/euUserBPatient001').set(endUser('euMasterA'));
    const missing = await request.get('/4_0_0/Patient/euNoSuchPatient999').set(endUser('euMasterA'));
    expect([401, 403, 404]).toContain(foreign.status);
    expect(foreign.status).toBe(missing.status);
  });
});
