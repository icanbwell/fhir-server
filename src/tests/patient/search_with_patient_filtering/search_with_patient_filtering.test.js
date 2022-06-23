const supertest = require('supertest');

const {app} = require('../../../app');
const fs = require('fs');
const path = require('path');
const async = require('async');

// test file
const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const allergyResource = require('./fixtures/patient/allergy_intolerance.json');
const allergy2Resource = require('./fixtures/patient/allergy_intolerance2.json');
const otherPatientResource = require('./fixtures/patient/other_patient.json');


const request = supertest(app);
const {commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload,
  getCustomGraphQLHeaders, getToken, getHeadersFormUrlEncoded
} = require('../../common');
const expectedAllergyIntoleranceBundleResource = require('../../graphql/allergyIntolerance/fixtures/expected_allergy_intolerances.json');

const allergyIntoleranceQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/patient/allergy.graphql'), 'utf8');


describe('patient Tests', () => {
  beforeEach(async () => {
    await commonBeforeEach();
  });

  afterEach(async () => {
    await commonAfterEach();
  });

  describe('patient search_with_patient_filtering Tests', () => {
    // test('search_with_patient_filtering works', async () => {
    //
    //   let payload =
    //     {
    //       'custom:bwell_fhir_id': 'patient-123-a',
    //       'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
    //       'scope': 'patient/*.read user/*.* access/*.*',
    //       'username': 'fake@example.com',
    //     };
    //   let payload2 =
    //     {
    //       'custom:bwell_fhir_id': 'patient-123-b',
    //       'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
    //       'scope': 'patient/*.read user/*.* access/*.*',
    //       'username': 'fake@example.com',
    //     };
    //
    //   let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
    //   expect(resp.body.length).toBe(0);
    //   console.log('------- response 0 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 0 ------------');
    //
    //   // ARRANGE
    //   // add the resources to FHIR server
    //   resp = await request
    //     .post('/4_0_0/patient/patient-123-a/$merge?validate=true')
    //     .send(patient1Resource)
    //     .set(getHeaders())
    //     .expect(200);
    //
    //   console.log('------- response 1 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 1 ------------');
    //
    //   resp = await request
    //     .post('/4_0_0/patient/patient-123-b/$merge?validate=true')
    //     .send(patient2Resource)
    //     .set(getHeaders())
    //     .expect(200);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   resp = await request
    //     .put('/4_0_0/AllergyIntolerance/patient-123-b-allergy-intolerance')
    //     .send(allergyResource)
    //     .set(getHeaders())
    //     .expect(201);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   resp = await request
    //     .put('/4_0_0/AllergyIntolerance/other-patient-allergy')
    //     .send(allergy2Resource)
    //     .set(getHeaders())
    //     .expect(201);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   resp = await request
    //     .post('/4_0_0/patient/other-patient/$merge?validate=true')
    //     .send(otherPatientResource)
    //     .set(getHeaders())
    //     .expect(200);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //   // ACT & ASSERT
    //   // search by token system and code and make sure we get the right patient back
    //   // console.log(getHeadersWithCustomPayload(payload));
    //   resp = await request
    //     .get('/4_0_0/patient/?_bundle=1')
    //     .set(getHeadersWithCustomPayload(payload))
    //     .expect(200);
    //
    //   console.log('------- response from adding observation2Resource ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response  ------------');
    //
    //   expect(resp.body.entry.length).toBe(2);
    //   expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
    //   expect(resp.body.entry[1].resource.id).toBe('patient-123-b');
    //
    //   // let header = getHeadersWithCustomPayload(payload2)
    //   // console.log(header)
    //   resp = await request
    //     .get('/4_0_0/AllergyIntolerance/?_bundle=1')
    //     .set(getHeadersWithCustomPayload(payload))
    //     .expect(200);
    //
    //   console.log('------- response from adding observation2Resource ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response  ------------');
    //
    //   expect(resp.body.entry.length).toBe(1);
    //   expect(resp.body.entry[0].resource.id).toBe('patient-123-b-allergy-intolerance');
    //
    // });
    test('search_with_patient_filtering works', async () => {

      let payload =
        {
          'custom:bwell_fhir_id': 'patient-123-a',
          'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
          'scope': 'patient/*.read user/*.* access/*.*',
          'username': 'fake@example.com',
        };
      let payload2 =
        {
          'custom:bwell_fhir_id': 'patient-123-b',
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

      resp = await request
        .put('/4_0_0/AllergyIntolerance/patient-123-b-allergy-intolerance')
        .send(allergyResource)
        .set(getHeaders())
        .expect(201);

      console.log('------- response 2 ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response 2 ------------');

      resp = await request
        .put('/4_0_0/AllergyIntolerance/other-patient-allergy')
        .send(allergy2Resource)
        .set(getHeaders())
        .expect(201);
      // ACT & ASSERT
      // search by token system and code and make sure we get the right patient back
      // console.log(getHeadersWithCustomPayload(payload));
      // resp = await request
      //   .get('/4_0_0/patient/?_bundle=1')
      //   .set(getHeadersWithCustomPayload(payload))
      //   .expect(200);
      //
      // console.log('------- response from adding observation2Resource ------------');
      // console.log(JSON.stringify(resp.body, null, 2));
      // console.log('------- end response  ------------');
      //
      // expect(resp.body.entry.length).toBe(2);
      // expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
      // expect(resp.body.entry[1].resource.id).toBe('patient-123-b');

      // let header = getHeadersWithCustomPayload(payload2)
      // console.log(header)
      resp = await request
        .get('/4_0_0/AllergyIntolerance/?_bundle=1')
        .set(getHeadersWithCustomPayload(payload))
        .expect(200);

      console.log('------- response from adding observation2Resource ------------');
      console.log(JSON.stringify(resp.body, null, 2));
      console.log('------- end response  ------------');

      expect(resp.body.entry.length).toBe(1);
      expect(resp.body.entry[0].resource.id).toBe('patient-123-b-allergy-intolerance');

    })

    // test('GraphQL AllergyIntolerance properly', async () => {
    //   // noinspection JSUnusedLocalSymbols
    //   let payload =
    //     {
    //       'custom:bwell_fhir_id': 'patient-123-a',
    //       'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
    //       'scope': 'patient/*.read user/*.* access/*.*',
    //       'username': 'fake@example.com',
    //     };
    //
    //   let headers = getCustomGraphQLHeaders(payload)
    //   console.log(headers)
    //
    //   const graphqlQueryText = allergyIntoleranceQuery.replace(/\\n/g, '');
    //
    //   let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
    //   expect(resp.body.length).toBe(0);
    //   console.log('------- response 0 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 0 ------------');
    //
    //   // ARRANGE
    //   // add the resources to FHIR server
    //   resp = await request
    //     .post('/4_0_0/patient/patient-123-a/$merge?validate=true')
    //     .send(patient1Resource)
    //     .set(getHeaders())
    //     .expect(200);
    //
    //   console.log('------- response 1 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 1 ------------');
    //
    //   resp = await request
    //     .post('/4_0_0/patient/patient-123-b/$merge?validate=true')
    //     .send(patient2Resource)
    //     .set(getHeaders())
    //     .expect(200);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   resp = await request
    //     .put('/4_0_0/AllergyIntolerance/patient-123-b-allergy-intolerance')
    //     .send(allergyResource)
    //     .set(getHeaders())
    //     .expect(201);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   resp = await request
    //     .put('/4_0_0/AllergyIntolerance/other-patient-allergy')
    //     .send(allergy2Resource)
    //     .set(getHeaders())
    //     .expect(201);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   resp = await request
    //     .post('/4_0_0/patient/other-patient/$merge?validate=true')
    //     .send(otherPatientResource)
    //     .set(getHeaders())
    //     .expect(200);
    //
    //   console.log('------- response 2 ------------');
    //   console.log(JSON.stringify(resp.body, null, 2));
    //   console.log('------- end response 2 ------------');
    //
    //   await async.waterfall([
    //     // (cb) => // first confirm there are no records
    //     //   request
    //     //     .get('/4_0_0/AllergyIntolerance')
    //     //     .set(getHeaders())
    //     //     .expect(200, (err, resp) => {
    //     //       expect(resp.body.length).toBe(0);
    //     //       console.log('------- response 1 ------------');
    //     //       console.log(JSON.stringify(resp.body, null, 2));
    //     //       console.log('------- end response 1 ------------');
    //     //       return cb(err, resp);
    //     //     }),
    //     // (results, cb) =>
    //     //   request
    //     //     .post('/4_0_0/Patient/1/$merge')
    //     //     .send(patientBundleResource)
    //     //     .set(getHeaders())
    //     //     .expect(200, (err, resp) => {
    //     //       console.log('------- response 2 ------------');
    //     //       console.log(JSON.stringify(resp.body, null, 2));
    //     //       console.log('------- end response 2  ------------');
    //     //       return cb(err, resp);
    //     //     }),
    //     // (results, cb) =>
    //     //   request
    //     //     .post('/4_0_0/AllergyIntolerance/1/$merge')
    //     //     .send(allergyIntoleranceBundleResource)
    //     //     .set(getHeaders())
    //     //     .expect(200, (err, resp) => {
    //     //       console.log('------- response 2 ------------');
    //     //       console.log(JSON.stringify(resp.body, null, 2));
    //     //       console.log('------- end response 2  ------------');
    //     //       return cb(err, resp);
    //     //     }),
    //     // (results, cb) =>
    //     //   request
    //     //     .get('/4_0_0/Patient/')
    //     //     .set(getHeaders())
    //     //     .expect(200, (err, resp) => {
    //     //       console.log('------- response patient ------------');
    //     //       console.log(JSON.stringify(resp.body, null, 2));
    //     //       console.log('------- end response patient  ------------');
    //     //       return cb(err, resp);
    //     //     }),
    //     // (results, cb) =>
    //     //   request
    //     //     .get('/4_0_0/AllergyIntolerance/')
    //     //     .set(getHeaders())
    //     //     .expect(200, (err, resp) => {
    //     //       console.log('------- response 2 ------------');
    //     //       console.log(JSON.stringify(resp.body, null, 2));
    //     //       console.log('------- end response 2  ------------');
    //     //       return cb(err, resp);
    //     //     }),
    //
    //     (cb) => request
    //       // .get('/graphql/?query=' + graphqlQueryText)
    //       // .set(getHeaders())
    //       .post('/graphqlv2')
    //       .send({
    //         'operationName': null,
    //         'variables': {},
    //         'query': graphqlQueryText
    //       })
    //       .set(headers)
    //       .expect(200, cb)
    //       .expect((resp) => {
    //         // clear out the lastUpdated column since that changes
    //         let body = resp.body;
    //         console.log('------- response graphql ------------');
    //         console.log(JSON.stringify(resp.body, null, 2));
    //         console.log('------- end response graphql  ------------');
    //         expect(body.data.allergyIntolerance.length).toBe(1);
    //         let expected = expectedAllergyIntoleranceBundleResource;
    //         expected.forEach(element => {
    //           if ('meta' in element) {
    //             delete element['meta']['lastUpdated'];
    //           }
    //           // element['meta'] = {'versionId': '1'};
    //           if ('$schema' in element) {
    //             delete element['$schema'];
    //           }
    //         });
    //         expect(body.data.allergyIntolerance).toStrictEqual(expected);
    //       }, cb),
    //   ]);
    // });
  });
});
