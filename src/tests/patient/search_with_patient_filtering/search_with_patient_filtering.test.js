const supertest = require('supertest');

const {app} = require('../../../app');
// test file
const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const otherPatientResource = require('./fixtures/patient/other_patient.json');

// expected
const expectedpatientResources = require('./fixtures/expected/expected_patient.json');

const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload} = require('../../common');
const {assertCompareBundles, assertMergeIsSuccessful} = require('../../fhirAsserts');

describe('patient Tests', () => {
  beforeEach(async () => {
    await commonBeforeEach();
  });

  afterEach(async () => {
    await commonAfterEach();
  });

  describe('patient search_with_patient_filtering Tests', () => {
    test('search_with_patient_filtering works', async () => {
      const payload =
        {
          'custom:bwell_fhir_id': 'patient-123-a',
          'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
          'scope': 'patient/*.read user/*.* access/*.*',
          'username': 'fake@example.com',
        };

      const other_payload =
        {
          'custom:bwell_fhir_id': 'other-patient',
          'custom:bwell_fhir_ids': 'other-patient',
          'scope': 'patient/*.read user/*.* access/*.*',
          'username': 'fake@example.com',
        };
      // ARRANGE
      // add the resources to FHIR server
      console.log('XXXXXXXXXXXXXXXXXXXXX');
      console.log('XXXXXXXXXXXXXXXXXXXXX');
      console.log(patient1Resource);
      let resp = await request
        .post('/4_0_0/patient/patient-123-a/$merge?validate=true')
        .send(patient1Resource)
        .set(getHeaders())
        .set(getHeadersWithCustomPayload(payload))
        .expect(200);
      assertMergeIsSuccessful(resp.body);

      resp = await request
        .post('/4_0_0/patient/patient-123-b/$merge?validate=true')
        .send(patient2Resource)
        .set(getHeaders())
        .set(getHeadersWithCustomPayload(payload))
        .expect(200);
      assertMergeIsSuccessful(resp.body);

      resp = await request
        .post('/4_0_0/patient/other-patient/$merge?validate=true')
        .send(otherPatientResource)
        .set(getHeaders())
        .set(getHeadersWithCustomPayload(other_payload))
        .expect(200);
      assertMergeIsSuccessful(resp.body);

      // ACT & ASSERT
      // search by token system and code and make sure we get the right patient back
      resp = await request
        .set(getHeaders())
        .set(getHeadersWithCustomPayload(payload))
        .get('/4_0_0/patient/?_bundle=1')
        .expect(200);
      assertCompareBundles(resp.body, expectedpatientResources);
    });
  });
});
