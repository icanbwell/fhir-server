const supertest = require('supertest');

const {app} = require('../../../app');
const fs = require('fs');
const path = require('path');
const async = require('async');

// test file
const patient1Resource = require('./fixtures/patient/patient1.json');
const person1Resource = require('./fixtures/patient/person.123a.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const person2Resource = require('./fixtures/patient/person.123b.json');
const patientWithMemberId = require('./fixtures/patient/patient-with-member-id.json');
const allergyResource = require('./fixtures/patient/allergy_intolerance.json');
const allergy2Resource = require('./fixtures/patient/allergy_intolerance2.json');
const conditionResource = require('./fixtures/patient/condition.json');
const condition2Resource = require('./fixtures/patient/condition2.json');
const otherPatientResource = require('./fixtures/patient/other_patient.json');
const rootPersonResource = require('./fixtures/patient/person.root.json');
const expectedAllergyIntoleranceBundleResource = require('./fixtures/expected/expected_allergy_intolerances.json');

const allergyIntoleranceQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/patient/allergy.graphql'), 'utf8');


const request = supertest(app);
const {
  commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload,
  getCustomGraphQLHeaders
} = require('../../common');


describe('patient Tests', () => {
  beforeAll(async () => {
    await commonBeforeEach();

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

    resp = await request
      .post('/4_0_0/patient/member-id-patient/$merge?validate=true')
      .send(patientWithMemberId)
      .set(getHeaders())
      .expect(200);

    console.log('------- response 2 ------------');
    console.log(JSON.stringify(resp.body, null, 2));
    console.log('------- end response 2 ------------');

    resp = await request
      .post('/4_0_0/person/person-123-a/$merge?validate=true')
      .send(person1Resource)
      .set(getHeaders())
      .expect(200);

    console.log('------- response 2 ------------');
    console.log(JSON.stringify(resp.body, null, 2));
    console.log('------- end response 2 ------------');

    resp = await request
      .post('/4_0_0/person/person-123-b/$merge?validate=true')
      .send(person2Resource)
      .set(getHeaders())
      .expect(200);

    console.log('------- response 2 ------------');
    console.log(JSON.stringify(resp.body, null, 2));
    console.log('------- end response 2 ------------');

    resp = await request
      .post('/4_0_0/person/root-person/$merge?validate=true')
      .send(rootPersonResource)
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

    resp = await request
      .put('/4_0_0/Condition/patient-123-b-condition')
      .send(conditionResource)
      .set(getHeaders())
      .expect(201);

    console.log('------- response 2 ------------');
    console.log(JSON.stringify(resp.body, null, 2));
    console.log('------- end response 2 ------------');

    resp = await request
      .put('/4_0_0/Condition/other-patient-condition')
      .send(condition2Resource)
      .set(getHeaders())
      .expect(201);

    console.log('------- response 2 ------------');
    console.log(JSON.stringify(resp.body, null, 2));
    console.log('------- end response 2 ------------');
  });

  afterAll(async () => {
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
    //
    let patient_123_payload =
      {
        'cognito:username': 'patient-123@example.com',
        'custom:bwell_fhir_id': 'patient-123-a',
        'custom:bwell_fhir_person_id': 'root-person',
        'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
        'scope': 'patient/*.read user/*.* access/*.*',
        'username': 'patient-123@example.com',
      };
    let other_patient_payload =
      {
        'cognito:username': 'other-patient@example.com',
        'custom:bwell_fhir_id': 'other-patient',
        'custom:bwell_fhir_ids': 'other-patient',
        'scope': 'patient/*.read user/*.* access/*.*',
        'username': 'other-patient@example.com',
      };
    // Legacy payload represents a user that registered before FHIR person support was added
    let patient_123_legacy_payload =
      {
        'cognito:username': 'patient-123@example.com',
        'custom:bwell_fhir_id': 'patient-123-a',
        'scope': 'patient/*.read user/*.* access/*.*',
        'username': 'patient-123@example.com',
      };
    let app_client_payload =
      {
        'scope': 'patient/*.read user/*.* access/*.*',
        'username': 'Some App',
      };


    describe('User security filtering', () => {

      test('Legacy users can only access a single patient', async () => {
        let resp = await request
          .get('/4_0_0/patient/?_bundle=1')
          .set(getHeadersWithCustomPayload(patient_123_legacy_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(1);
        expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
      })

      test('Only related patients are returned', async () => {
        // ACT & ASSERT
        // search by token system and code and make sure we get the right patient back
        // console.log(getHeadersWithCustomPayload(payload));
        let resp = await request
          .get('/4_0_0/patient/?_bundle=1')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(2);
        expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
        expect(resp.body.entry[1].resource.id).toBe('patient-123-b');
      });

      test('A user can access their patient by id', async () => {
        // Patient-123 should be able to access himself
        let resp = await request
          .get('/4_0_0/patient/patient-123-a')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.id).toBe('patient-123-a');


        resp = await request
          .get('/4_0_0/patient/other-patient?_bundle=1')
          .set(getHeadersWithCustomPayload(other_patient_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.id).toBe('other-patient');
      });


      test('A user cannot access another patient by id', async () => {
        // Make sure patient-123 access other-patient
        let resp = await request
          .get('/4_0_0/Patient/other-patient')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(404);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.issue[0].code).toBe('not-found');
      });

      test('Resources are filtered by patient', async () => {
        let resp = await request
          .get('/4_0_0/AllergyIntolerance/?_bundle=1')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(200);

        console.log('------- response from adding observation2Resource ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(1);
        expect(resp.body.entry[0].resource.id).toBe('patient-123-b-allergy-intolerance');

        resp = await request
          .get('/4_0_0/Condition/?_bundle=1')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(200);

        console.log('------- response from adding observation2Resource ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(1);
        expect(resp.body.entry[0].resource.id).toBe('patient-123-b-condition');
      });

      test('A user can access their patient-filtered resources by id', async () => {
        // Make sure patient 123 can access a certain allergy
        let resp = await request
          .get('/4_0_0/AllergyIntolerance/patient-123-b-allergy-intolerance')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(200);

        console.log('------- response from adding observation2Resource ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.id).toBe('patient-123-b-allergy-intolerance');
      });


      test('A user cannot access another patient\'s patient-filtered resources by id', async () => {
        let resp = await request
          .get('/4_0_0/AllergyIntolerance/other-patient-allergy')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(404);

        console.log('------- response from adding observation2Resource ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.issue[0].code).toBe('not-found');
      });
      //Make sure patient 123 can only access his Conditions


      test('A user can access their subject-filtered resources by id', async () => {
        let resp = await request
          .get('/4_0_0/Condition/other-patient-condition')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(404);

        console.log('------- response from adding observation2Resource ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.issue[0].code).toBe('not-found');
      });

      test('A user cannot access another patients\'s subject-filtered resources by id', async () => {
        let resp = await request
          .get('/4_0_0/AllergyIntolerance/other-patient-allergy')
          .set(getHeadersWithCustomPayload(patient_123_payload))
          .expect(404);

        console.log('------- response from adding observation2Resource ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.issue[0].code).toBe('not-found');
      });
    });


    describe('App clients security filtering', () => {
      //Make sure app clients can access all patients
      test('App clients can access all id-filtered resources', async () => {
        let resp = await request
          .get('/4_0_0/Patient/?_bundle=1')
          .set(getHeadersWithCustomPayload(app_client_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(3);
      });

      test('App clients can access all patient-filtered resources', async () => {
        //Make sure app clients can access all patient filtered resources
        let resp = await request
          .get('/4_0_0/AllergyIntolerance/?_bundle=1')
          .set(getHeadersWithCustomPayload(app_client_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(2);
      });

      test('App clients can access all subject-filtered resources', async () => {
        let resp = await request
          .get('/4_0_0/Condition/?_bundle=1')
          .set(getHeadersWithCustomPayload(app_client_payload))
          .expect(200);

        console.log('------- response from getting patients ------------');
        console.log(JSON.stringify(resp.body, null, 2));
        console.log('------- end response  ------------');

        expect(resp.body.entry.length).toBe(2);
      });
    });

    test('GraphQL AllergyIntolerance properly', async () => {
      // noinspection JSUnusedLocalSymbols
      let payload =
        {
          'cognito:username': 'fake@example.com',
          // 'custom:bwell_fhir_id': 'patient-123-a',
          'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
          'scope': 'patient/*.read user/*.* access/*.*',
          'username': 'fake@example.com',
        };

      const graphqlQueryText = allergyIntoleranceQuery.replace(/\\n/g, '');

      await async.waterfall([
        (cb) => request
          // .get('/graphql/?query=' + graphqlQueryText)
          // .set(getHeaders())
          .post('/graphqlv2')
          .send({
            'operationName': null,
            'variables': {},
            'query': graphqlQueryText
          })
          .set(getCustomGraphQLHeaders(payload))
          .expect(200, cb)
          .expect((resp) => {
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            console.log('------- response graphql ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response graphql  ------------');
            expect(body.data.allergyIntolerance.entry.length).toBe(1);
            let expected = expectedAllergyIntoleranceBundleResource;
            expected.forEach(element => {
              if ('meta' in element) {
                delete element['meta']['lastUpdated'];
              }
              // element['meta'] = {'versionId': '1'};
              if ('$schema' in element) {
                delete element['$schema'];
              }
            });
            expect(body.data.allergyIntolerance.entry).toStrictEqual(expected);
          }, cb),
      ]);
      // });
    });
  });
})
;
