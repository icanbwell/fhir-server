const supertest = require('supertest');

const {app} = require('../../../app');
// test file
const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const otherPatientResource = require('./fixtures/patient/other_patient.json');


const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload} = require('../../common');


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

      let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
      expect(resp.body.length).toBe(0);
      console.log('------- response 0 ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response 0 ------------');

      // ARRANGE
      // add the resources to FHIR server
      resp = await request
        .post('/4_0_0/patient/patient-123-a/$merge?validate=true')
        .send(patient1Resource)
        .set(getHeaders())
        .expect(200);

      console.log('------- response 1 ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response 1 ------------');

      resp = await request
        .post('/4_0_0/patient/patient-123-b/$merge?validate=true')
        .send(patient2Resource)
        .set(getHeaders())
        .expect(200);

      console.log('------- response 2 ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response 2 ------------');

      resp = await request
        .post('/4_0_0/patient/other-patient/$merge?validate=true')
        .send(otherPatientResource)
        .set(getHeaders())
        .expect(200);

      console.log('------- response 2 ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response 2 ------------');
      // ACT & ASSERT
      // search by token system and code and make sure we get the right patient back
      resp = await request
        .get('/4_0_0/patient/?_bundle=1')
        .set(getHeadersWithCustomPayload(payload))
        .expect(200);

      console.log('------- response from adding observation2Resource ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response  ------------');

      expect(resp.body.entry.length).toBe(2);
      expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
      expect(resp.body.entry[1].resource.id).toBe('patient-123-b');
    });
  });
});
