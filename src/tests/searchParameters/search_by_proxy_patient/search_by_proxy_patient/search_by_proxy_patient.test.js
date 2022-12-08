// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');
const personResource = require('./fixtures/Person/person.json');
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');

// expected
const expectedPatientResources = require('./fixtures/expected/expected_Patient.json');
const expectedPatientTwoPatientsResources = require('./fixtures/expected/expected_Patient_two_patients.json');
const expectedObservationNormal = require('./fixtures/expected/expectedObservationNormal.json');
const expectedObservationProxyPatient = require('./fixtures/expected/expectedObservationProxyPatient.json');
const expectedObservationProxyPatientWithDirectLink = require('./fixtures/expected/expectedObservationProxyPatientWithDirectLink.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient search_by_proxy_patient Tests', () => {
        test('search obsrvations by patient for normal patients works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=00100000000')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationNormal);
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/00100000000')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationNormal);
        });
        test('search observations by patient for proxy patients works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/person.m65633')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationProxyPatient);
        });
        test('search observations by patient for proxy patients works with nested persons', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/person.m65634')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationProxyPatient);
        });
        test('search observations by patient for proxy patients works with nested persons (access restricted to one)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            const healthsystem1ObservationResources = deepcopy(expectedObservationProxyPatient);
            healthsystem1ObservationResources.entry = healthsystem1ObservationResources.entry.slice(0, 1);
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/person.m65634')
                .set(getHeaders('user/*.read access/healthsystem1.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(healthsystem1ObservationResources);
            const healthsystem2ObservationResources = deepcopy(expectedObservationProxyPatient);
            healthsystem2ObservationResources.entry = healthsystem2ObservationResources.entry.slice(1, 2);
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/person.m65634')
                .set(getHeaders('user/*.read access/healthsystem2.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(healthsystem2ObservationResources);
        });
        test('get patient for proxy patients works with nested persons (one patient)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Patient/?_bundle=1&id=person.m65634')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResources);

            resp = await request
                .get('/4_0_0/Patient/person.m65634')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResources.entry[0].resource);
        });
        test('get patient for proxy patients works with nested persons (two patients)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Patient/?_bundle=1&id=person.m65634')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientTwoPatientsResources);

            resp = await request
                .get('/4_0_0/Patient/person.m65634')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientTwoPatientsResources.entry[0].resource);
        });
        test('get patient for proxy patients works with nested persons (two patients but access restricted to one)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            const healthsystem1PatientResources = deepcopy(expectedPatientTwoPatientsResources);
            healthsystem1PatientResources.entry = healthsystem1PatientResources.entry.slice(0, 1);
            resp = await request
                .get('/4_0_0/Patient/?_bundle=1&id=person.m65634')
                .set(getHeaders('user/*.read access/healthsystem1.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(healthsystem1PatientResources);

            resp = await request
                .get('/4_0_0/Patient/person.m65634')
                .set(getHeaders('user/*.read access/healthsystem1.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(healthsystem1PatientResources.entry[0].resource);
            // Now check healthsystem2 patients
            const healthsystem2PatientResources = deepcopy(expectedPatientTwoPatientsResources);
            healthsystem2PatientResources.entry = healthsystem2PatientResources.entry.slice(1, 2);
            resp = await request
                .get('/4_0_0/Patient/?_bundle=1&id=person.m65634')
                .set(getHeaders('user/*.read access/healthsystem2.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(healthsystem2PatientResources);

            resp = await request
                .get('/4_0_0/Patient/person.m65634')
                .set(getHeaders('user/*.read access/healthsystem2.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(healthsystem2PatientResources.entry[0].resource);
        });
        test('search observations by patient for proxy patients includes proxy patient itself', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=Patient/person.m65633')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationProxyPatientWithDirectLink);
        });
    });
});
