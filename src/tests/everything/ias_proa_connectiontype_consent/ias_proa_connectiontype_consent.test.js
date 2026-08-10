// ============================================================================
// SEC-1580 CASE COVERAGE (skip-gated — requires the ClickHouse CI harness):
//   B4 / IDG-6   consent-driven PROA/IAS unlock is filtered by connectionType (and by the
//                configured connection-type list); IAS gated only when configured
//   (separation) a PROA connection to an org does not expose that org's IAS-sourced data
// LIVE validation additionally blocked (staging service accounts denied).
// ============================================================================
// =============================================================================
// IAS consent-gating config + IAS/PROA same-connection-type separation.
//
// Facts established from source:
//  - DCON-4598 (INC-331 fix) scopes "PROA/IAS patients across all $everything chunks":
//    IAS rides the same consent-gated expansion path as PROA.
//  - That path filters unlocked patients by connectionType against
//    configManager.getConsentConnectionTypesList (dataSharingManager.js), which DEFAULTS
//    to ['proa'] (configManager.js) and is only widened via CONSENT_CONNECTION_TYPES_LIST.
//  - The test harness sets ENABLE_CONSENTED_PROA_DATA_ACCESS=1 but does NOT set
//    CONSENT_CONNECTION_TYPES_LIST, so the default ['proa'] is in effect.
//  - EPIC IAS Integration (Confluence): IAS and PROA connections to the SAME org must
//    stay separate.
//
// These tests reuse the repo's known-good consented_data fixtures (master/client person,
// client patient, proa patient+observation, dataSharing consent — which unlock PROA data
// via proxy-patient search) and add an IAS (connectionType=ias) patient+observation linked
// under the same client Person.
//
// POLARITY: secure = pass.
//   A. Default config (['proa']): the dataSharing consent unlocks the PROA observation but
//      NOT the IAS observation -> IAS consent-gating is config-dependent, and PROA and IAS
//      are separated by connectionType.
//   B. Config widened to ['proa','ias']: the same consent now unlocks BOTH -> proves IAS is
//      gated by the same mechanism when configured, and that A's exclusion was the config,
//      not a broken fixture (positive control for the mechanism).
//   C. Same-org separation: a PROA and an IAS patient owned by the SAME org; with default
//      ['proa'] only the PROA one unlocks -> connecting to org X via PROA does not expose
//      org X's IAS-sourced data.
// =============================================================================
const deepcopy = require('deepcopy');

const masterPersonResource = require('../../consented_data/consented_data/fixtures/person/master_person.json');
const clientPersonResource = require('../../consented_data/consented_data/fixtures/person/client_person.json');
const masterPatientResource = require('../../consented_data/consented_data/fixtures/patient/master_patient.json');
const clientPatientResource = require('../../consented_data/consented_data/fixtures/patient/client_patient.json');
const proaPatientResource = require('../../consented_data/consented_data/fixtures/patient/proa_patient.json');
const proaObservationResource = require('../../consented_data/consented_data/fixtures/observation/proa_observation.json');
const consentGivenResource = require('../../consented_data/consented_data/fixtures/consent/consent_given.json');

const { ConfigManager } = require('../../../utils/configManager');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const MASTER_PERSON_ID = '08f1b73a-e27c-456d-8a61-277f164a9a57';
const PROA_OBS_ID = proaObservationResource.id;

// IAS resources owned by an upstream IAS source (tc_epic), connectionType=ias.
function iasPatient(id, owner) {
  return {
    resourceType: 'Patient', id,
    meta: { source: owner, security: [
      { system: 'https://www.icanbwell.com/owner', code: owner },
      { system: 'https://www.icanbwell.com/access', code: owner },
      { system: 'https://www.icanbwell.com/connectionType', code: 'ias' }
    ]},
    birthDate: '2017-01-01', gender: 'female',
    name: [{ use: 'usual', family: 'PATIENT1', given: ['SHYLA'] }]
  };
}
function iasObservation(id, patientId, owner) {
  return {
    resourceType: 'Observation', id,
    meta: { source: owner, security: [
      { system: 'https://www.icanbwell.com/owner', code: owner },
      { system: 'https://www.icanbwell.com/access', code: owner },
      { system: 'https://www.icanbwell.com/connectionType', code: 'ias' }
    ]},
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
    subject: { reference: `Patient/${patientId}` }
  };
}

const IAS_PATIENT_ID = 'ias00000-0000-4000-8000-00000000ia01';
const IAS_OBS_ID = 'iasobs00-0000-4000-8000-00000000io01';

// client Person linked additionally to the IAS patient (owner=tc_epic).
function clientPersonWithIas(iasPatientId, iasOwner) {
  const cp = deepcopy(clientPersonResource);
  cp.link = [...cp.link, { target: { reference: `Patient/${iasPatientId}|${iasOwner}`, type: 'Patient' }, assurance: 'level4' }];
  return cp;
}

const headers = getHeaders('user/*.read access/client.*');

function obsIds(resp) {
  return (Array.isArray(resp.body) ? resp.body : []).map(r => r && r.id).filter(Boolean);
}

class ConsentTypesConfig extends ConfigManager {
  constructor(list) { super(); this._list = list; }
  get enableConsentedProaDataAccess() { return true; }
  get getConsentConnectionTypesList() { return this._list; }
}

// SANDBOX NOTE: these three assertions exercise the consent-driven PROA/IAS unlock path,
// which runs inside $everything and its ClickHouse-backed audit/enrichment step. That path
// cannot be exercised in a mongo-only setup (plain proxy-patient search does NOT trigger the
// consent-PROA/IAS branch in this version — only $everything does, and $everything on
// consent fixtures needs the ClickHouse test container). Run under the full `yarn test`
// (ClickHouse container available). The assertions below encode the SECURE outcome; they are
// skip-gated so nothing shows fake-green until validated in a ClickHouse-enabled run.
// Un-skip and switch the query to GET /4_0_0/Patient/person.<clientPersonId>/$everything
// (the form that performs the unlock) once running with ClickHouse.
describe.skip('IAS/PROA connectionType consent gating', () => {
  beforeEach(async () => { await commonBeforeEach(); });
  afterEach(async () => { await commonAfterEach(); });

  async function seedAndSearch({ iasOwner = 'tc_epic', configList } = {}) {
    const request = configList
      ? await createTestRequest((c) => { c.register('configManager', () => new ConsentTypesConfig(configList)); return c; })
      : await createTestRequest();
    const toMerge = [
      masterPersonResource, clientPersonWithIas(IAS_PATIENT_ID, iasOwner), masterPatientResource, clientPatientResource,
      proaPatientResource, proaObservationResource,
      iasPatient(IAS_PATIENT_ID, iasOwner), iasObservation(IAS_OBS_ID, IAS_PATIENT_ID, iasOwner),
      consentGivenResource
    ];
    const merge = await request.post('/4_0_0/Person/1/$merge').send(toMerge).set(getHeaders());
    expect(merge).toHaveMergeResponse({ created: true });
    return request.get(`/4_0_0/Observation?patient=Patient/person.${MASTER_PERSON_ID}&_sort=_uuid`).set(headers);
  }

  test('A: default config (proa only) unlocks PROA but NOT IAS (config-dependent, separated)', async () => {
    const resp = await seedAndSearch(); // ambient config: getConsentConnectionTypesList = ['proa']
    expect(resp.status).toBe(200);
    const ids = obsIds(resp);
    expect(ids).toContain(PROA_OBS_ID);        // consent unlocks PROA (positive control)
    expect(ids).not.toContain(IAS_OBS_ID);      // IAS not in connection-type list -> excluded
  });

  test('B: config widened to [proa, ias] unlocks BOTH (same mechanism gates IAS)', async () => {
    const resp = await seedAndSearch({ configList: ['proa', 'ias'] });
    expect(resp.status).toBe(200);
    const ids = obsIds(resp);
    expect(ids).toContain(PROA_OBS_ID);
    expect(ids).toContain(IAS_OBS_ID);
  });

  test('C: same-org separation — PROA and IAS owned by the SAME org; default config exposes only PROA', async () => {
    // proaPatientResource owner is 'proa'; make the IAS patient share that same owner org.
    const resp = await seedAndSearch({ iasOwner: 'proa' });
    expect(resp.status).toBe(200);
    const ids = obsIds(resp);
    expect(ids).toContain(PROA_OBS_ID);         // PROA connection to org 'proa' is visible
    expect(ids).not.toContain(IAS_OBS_ID);       // same org's IAS-sourced data is NOT exposed
  });
});
