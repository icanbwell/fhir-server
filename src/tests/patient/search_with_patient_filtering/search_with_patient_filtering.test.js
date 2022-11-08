const fs = require('fs');
const path = require('path');

// test file
const patient1Resource = require('./fixtures/patient/patient1.json');
const person1Resource = require('./fixtures/patient/person.123a.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const person2Resource = require('./fixtures/patient/person.123b.json');
const patientWithMemberId = require('./fixtures/patient/patient-with-member-id.json');
const allergyResource = require('./fixtures/patient/allergy_intolerance.json');
const allergy2Resource = require('./fixtures/patient/allergy_intolerance2.json');
const allergy3Resource = require('./fixtures/patient/allergy_intolerance3.json');
const conditionResource = require('./fixtures/patient/condition.json');
const condition2Resource = require('./fixtures/patient/condition2.json');
const condition3Resource = require('./fixtures/patient/condition3.json');
const otherPatientResource = require('./fixtures/patient/other_patient.json');
const rootPersonResource = require('./fixtures/patient/person.root.json');
const desireePatientResource = require('./fixtures/patient/desiree.patient.json');
const desireePersonResource = require('./fixtures/patient/desiree.root.person.json');
const desireeAllergyIntoleranceResource = require('./fixtures/patient/desiree.allergyIntolerance.json');
// const expectedAllergyIntoleranceBundleResource = require('./fixtures/expected/expected_allergy_intolerances.json');

// const allergyIntoleranceQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/patient/allergy.graphql'), 'utf8');
const allergyIntoleranceQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/patient/desiree.allergy.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    getCustomGraphQLHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeAll, afterAll, expect, test} = require('@jest/globals');

describe('patient Tests', () => {
    beforeAll(async () => {
        await commonBeforeEach();
        const request = await createTestRequest();
        let resp = await request
            .get('/4_0_0/Patient')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(0);

        // ARRANGE
        // add the resources to FHIR server
        resp = await request
            .post('/4_0_0/patient/patient-123-a/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/patient/patient-123-b/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/patient/other-patient/$merge?validate=true')
            .send(otherPatientResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/patient/member-id-patient/$merge?validate=true')
            .send(patientWithMemberId)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/patient/epic-sandbox-r4c-eAB3mDIBBcyUKviyzrxsnAw3/$merge?validate=true')
            .send(desireePatientResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/desiree-root-person/$merge')
            .send(desireePersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/person/person-123-a/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/person/person-123-b/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/person/root-person/$merge?validate=true')
            .send(rootPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request.get('/4_0_0/Person?_bundle=1').set(getHeaders()).expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(4);

        resp = await request
            .put('/4_0_0/AllergyIntolerance/patient-123-b-allergy-intolerance')
            .send(allergyResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put(
                '/4_0_0/AllergyIntolerance/eARZpey6BWRZxRZkRpc8OFJ46j3QOFrduk77hYQKWRQmlt9PoMWmqTzLFagJe8t'
            )
            .send(desireeAllergyIntoleranceResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put('/4_0_0/AllergyIntolerance/patient-123-c-allergy-intolerance')
            .send(allergy3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put('/4_0_0/AllergyIntolerance/other-patient-allergy')
            .send(allergy2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put('/4_0_0/Condition/patient-123-b-condition')
            .send(conditionResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put('/4_0_0/Condition/patient-123-c-condition')
            .send(condition3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .put('/4_0_0/Condition/other-patient-condition')
            .send(condition2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    describe('patient search_with_patient_filtering Tests', () => {
        let patient_123_payload = {
            'cognito:username': 'patient-123@example.com',
            'custom:bwell_fhir_id': 'patient-123-a',
            'custom:bwell_fhir_person_id': 'root-person',
            'custom:bwell_fhir_ids': 'patient-123-a|patient-123-b',
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'patient-123@example.com',
        };
        let only_fhir_person_payload = {
            'cognito:username': 'patient-123@example.com',
            'custom:bwell_fhir_person_id': 'root-person',
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'patient-123@example.com',
        };
        let no_ids_user_payload = {
            'cognito:username': 'patient-123@example.com',
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'patient-123@example.com',
        };
        let other_patient_payload = {
            'cognito:username': 'other-patient@example.com',
            'custom:bwell_fhir_id': 'other-patient',
            'custom:bwell_fhir_ids': 'other-patient',
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'other-patient@example.com',
        };
        // Legacy payload represents a user that registered before FHIR person support was added
        let patient_123_legacy_payload = {
            'cognito:username': 'patient-123@example.com',
            'custom:bwell_fhir_id': 'patient-123-a',
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'patient-123@example.com',
        };
        let patient_123_legacy_bad_id_payload = {
            'custom:bwell_fhir_id': '-',
            'cognito:username': '4c66b9b6-7bdc-4960-87f0-b2c25a348eb6',
            'custom:scope': 'patient/*.read user/*.* access/*.*',
            scope: 'patient/*.read user/*.* access/*.*',
            patient: '-',
            email: 'test+devb2c@icanbwell.com',
        };
        let app_client_payload = {
            scope: 'patient/*.read user/*.* access/*.*',
            username: 'Some App',
        };
        let desiree_payload = {
            'custom:bwell_fhir_person_id': 'desiree-root-person',
            'cognito:username': '4c66b9b6-7bdc-4960-87f0-b2c25a348eb6',
            'custom:scope': 'patient/*.read user/*.* access/*.*',
            scope: 'patient/*.read user/*.* access/*.*',
            email: 'test+devb2c@icanbwell.com',
        };

        describe('User security filtering', () => {
            test('Legacy users can only access a single patient', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/patient/?_bundle=1')
                    .set(getHeadersWithCustomPayload(patient_123_legacy_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(1);
                expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
            });

            test('Only linked patients are returned', async () => {
                const request = await createTestRequest();
                // ACT & ASSERT
                // search by token system and code and make sure we get the right patient back
                // console.log(getHeadersWithCustomPayload(payload));
                //
                // let resp1 = await request
                //     .get('/4_0_0/patient/?_bundle=1')
                //     .set(getHeaders())
                //     .expect(200);
                //
                // console.log('------- response from getting patients ------------');
                // console.log(JSON.stringify(resp1.body, null, 2));
                // console.log('------- end response  ------------');

                let resp = await request
                    .get('/4_0_0/patient/?_bundle=1')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);
                expect(resp.body.entry[0].resource.id).toBe('patient-123-a');
                expect(resp.body.entry[1].resource.id).toBe('patient-123-b');
            });

            test('No resources are returned if user has no fhir ids', async () => {
                const request = await createTestRequest();
                // ACT & ASSERT
                // search by token system and code and make sure we get the right patient back
                // console.log(getHeadersWithCustomPayload(payload));
                let resp = await request
                    .get('/4_0_0/patient/?_bundle=1')
                    .set(getHeadersWithCustomPayload(no_ids_user_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .get('/4_0_0/AllergyIntolerance/?_bundle=1')
                    .set(getHeadersWithCustomPayload(no_ids_user_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);
            });

            test('No resources are returned if user has a bad fhir id', async () => {
                const request = await createTestRequest();
                // ACT & ASSERT
                // search by token system and code and make sure we get the right patient back
                // console.log(getHeadersWithCustomPayload(payload));
                let resp = await request
                    .get('/4_0_0/patient/?_bundle=1')
                    .set(getHeadersWithCustomPayload(patient_123_legacy_bad_id_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);

                resp = await request
                    .get('/4_0_0/AllergyIntolerance/?_bundle=1')
                    .set(getHeadersWithCustomPayload(patient_123_legacy_bad_id_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(0);
            });

            test('A user can access their patient by id', async () => {
                const request = await createTestRequest();
                // Patient-123 should be able to access himself
                let resp = await request
                    .get('/4_0_0/patient/patient-123-a')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(1);

                expect(resp.body.id).toBe('patient-123-a');

                resp = await request
                    .get('/4_0_0/patient/other-patient?_bundle=1')
                    .set(getHeadersWithCustomPayload(other_patient_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(1);

                expect(resp.body.id).toBe('other-patient');
            });

            test('A user cannot access another patient by id', async () => {
                const request = await createTestRequest();
                // Make sure patient-123 access other-patient
                let resp = await request
                    .get('/4_0_0/Patient/other-patient')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveStatusCode(404);
                expect(resp.body.issue[0].code).toBe('not-found');
            });

            test('A user cannot access another patient by id (member id)', async () => {
                const request = await createTestRequest();
                // Make sure patient-123 access other-patient
                let resp = await request
                    .get('/4_0_0/Patient/other-patient')
                    .set(getHeadersWithCustomPayload(only_fhir_person_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveStatusCode(404);
                expect(resp.body.issue[0].code).toBe('not-found');
            });

            test('Resources are filtered by patient', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/AllergyIntolerance/?_bundle=1')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);

                expect(resp.body.entry[0].resource.id).toBe('patient-123-a-allergy-intolerance');
                expect(resp.body.entry[1].resource.id).toBe('patient-123-b-allergy-intolerance');

                resp = await request
                    .get('/4_0_0/Condition/?_bundle=1&_sort=id')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(2);
                expect(resp.body.entry[0].resource.id).toBe('patient-123-a-condition');
                expect(resp.body.entry[1].resource.id).toBe('patient-123-b-condition');
            });

            test('A user can access their patient-filtered resources by id', async () => {
                const request = await createTestRequest();
                // Make sure patient 123 can access a certain allergy
                let resp = await request
                    .get('/4_0_0/AllergyIntolerance/patient-123-b-allergy-intolerance')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(1);

                expect(resp.body.id).toBe('patient-123-b-allergy-intolerance');
            });

            test('A user cannot access another patient\'s patient-filtered resources by id', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/AllergyIntolerance/other-patient-allergy')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveStatusCode(404);

                expect(resp.body.issue[0].code).toBe('not-found');
            });
            //Make sure patient 123 can only access his Conditions

            test('A user can access their subject-filtered resources by id', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/Condition/other-patient-condition')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveStatusCode(404);

                expect(resp.body.issue[0].code).toBe('not-found');
            });

            test('A user cannot access another patients\'s subject-filtered resources by id', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/AllergyIntolerance/other-patient-allergy')
                    .set(getHeadersWithCustomPayload(patient_123_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveStatusCode(404);
                expect(resp.body.issue[0].code).toBe('not-found');
            });
        });

        describe('App clients security filtering', () => {
            //Make sure app clients can access all patients
            test('App clients can access all id-filtered resources', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/Patient/?_bundle=1')
                    .set(getHeadersWithCustomPayload(app_client_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(5);
            });

            test('App clients can access all patient-filtered resources', async () => {
                const request = await createTestRequest();
                //Make sure app clients can access all patient filtered resources
                let resp = await request
                    .get('/4_0_0/AllergyIntolerance/?_bundle=1')
                    .set(getHeadersWithCustomPayload(app_client_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(4);
            });

            test('App clients can access all subject-filtered resources', async () => {
                const request = await createTestRequest();
                let resp = await request
                    .get('/4_0_0/Condition/?_bundle=1')
                    .set(getHeadersWithCustomPayload(app_client_payload));
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveResourceCount(3);
            });
        });

        test('Graphql security filtering', async () => {
            // noinspection JSUnusedLocalSymbols
            let payload = desiree_payload;

            const graphqlQueryText = allergyIntoleranceQuery.replace(/\\n/g, '');
            const request = await createTestRequest();
            let resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getCustomGraphQLHeaders(payload));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            console.log('------- response graphql ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response graphql  ------------');
            expect(body.errors).toBeUndefined();
            expect(body.data.allergyIntolerance.entry.length).toBe(1);

            expect(body.data.allergyIntolerance.entry[0].resource.id).toBe(
                'eARZpey6BWRZxRZkRpc8OFJ46j3QOFrduk77hYQKWRQmlt9PoMWmqTzLFagJe8t'
            );
            expect(body.data.allergyIntolerance.entry[0].resource.code.text).toBe('Not on File');
            expect(body.data.errors).toBeUndefined();
        });
    });
});
