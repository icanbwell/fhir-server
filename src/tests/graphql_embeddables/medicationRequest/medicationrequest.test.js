// test file
const medicationrequest1Resource = require('./fixtures/MedicationRequest/medicationrequest1.json');
const medicationrequest2Resource = require('./fixtures/MedicationRequest/medicationrequest2.json');
const medicationrequestOtherPatientResource = require('./fixtures/MedicationRequest/medicationrequest_other_patient.json');

const medication1Resource = require('./fixtures/Medication/medication1.json');
const medicationDispense1Resource = require('./fixtures/MedicationDispense/medicationdispense1.json');
const medicationStatement1Resource = require('./fixtures/MedicationStatement/medicationstatement1.json');

const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');

// expected
const expectedMedicationRequestResources = require('./fixtures/expected/expected_medicationrequest.json');
const expectedMedicationDispenseResources = require('./fixtures/expected/expected_medicationdispense.json');
const expectedMedicationStatementResources = require('./fixtures/expected/expected_medicationstatement.json');

const fs = require('fs');
const path = require('path');

const medicationrequestQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL MedicationRequest Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL MedicationRequest medicationRequest Tests', () => {
        test('GraphQL medicationRequest works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/MedicationRequest/1/$merge?validate=true')
                .send(medicationrequest1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/MedicationRequest/1/$merge?validate=true')
                .send(medicationrequest2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/MedicationRequest/1/$merge?validate=true')
                .send(medicationrequestOtherPatientResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/MedicationDispense/1/$merge?validate=true')
                .send(medicationDispense1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/MedicationStatement/1/$merge?validate=true')
                .send(medicationStatement1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = medicationrequestQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/$graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedMedicationRequestResources, 'medicationRequest');
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedMedicationDispenseResources, 'medicationDispense');
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedMedicationStatementResources, 'medicationStatement');
        });
    });
});
