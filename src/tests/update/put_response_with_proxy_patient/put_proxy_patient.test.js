// fixtures
const patient = require('./fixtures/patient.json');
const person = require('./fixtures/person.json');

// expected
const expectedPatient = require('./expected/expected_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('ActivityDefinition Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient put_response Tests', () => {
        test('put_response doesnt expands proxy patient, instead create new resource', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request.post('/4_0_0/Patient/$merge').send(patient).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request.post('/4_0_0/Person/$merge').send(person).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const patient2 = deepcopy(patient);
            delete patient2.id;

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .put('/4_0_0/Patient/person.4f28941f-24af-4e81-89b7-d0bdd627626d')
                .send(patient2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatient);
            // should not expand proxy-patient, instead create a resource with that id
            expect(resp.status).toBe(201);
        });
    });
});
