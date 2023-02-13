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
const {ConfigManager} = require('../../../utils/configManager');
const {logInfo} = require('../../../operations/common/logging');

class MockConfigManager extends ConfigManager {
    get doNotRequirePersonOrPatientIdForPatientScope() {
        return true;
    }
}

describe('patient Tests', () => {
    beforeAll(async () => {
        await commonBeforeEach();
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
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

        describe('App clients security filtering if config is on', () => {
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
            logInfo('------- response graphql ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response graphql  ------------');
            expect(body.errors).toBeUndefined();
            expect(body.data.allergyIntolerance.entry).toBeDefined();
            expect(body.data.allergyIntolerance.entry.length).toBe(1);

            expect(body.data.allergyIntolerance.entry[0].resource.id).toBe(
                'eARZpey6BWRZxRZkRpc8OFJ46j3QOFrduk77hYQKWRQmlt9PoMWmqTzLFagJe8t'
            );
            expect(body.data.allergyIntolerance.entry[0].resource.code.text).toBe('Not on File');
            expect(body.data.errors).toBeUndefined();
        });
    });
});
