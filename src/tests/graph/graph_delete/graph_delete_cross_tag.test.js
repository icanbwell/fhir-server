// test file
const personAnchorResource = require('./fixtures/Person/person_anchor.json');
const patientClientP1Resource = require('./fixtures/Patient/patient_clientp1.json');
const patientProaResource = require('./fixtures/Patient/patient_proa.json');
const observationProaResource = require('./fixtures/Observation/observation_proa.json');
const observationProaLinkedToClientP1Resource = require('./fixtures/Observation/observation_proa_linked_to_clientp1.json');
const graphPersonToPatient = require('./fixtures/graph/graph_person_to_patient.json');
const graphPatientToObservation = require('./fixtures/graph/graph_patient_to_observation.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('$graph DELETE cross-tag authorization Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('DELETE Person/$graph should not delete resources the caller lacks write access to', async () => {
        const request = await createTestRequest();

        // ARRANGE
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patientClientP1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patientProaResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observationProaResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(personAnchorResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT - DELETE $graph with custom graph definition, attacker has write to client-p1 but only read to PROA
        const attackerScope = 'user/*.read user/*.write access/client-p1.* access/PROA.read';
        resp = await request
            .delete('/4_0_0/Person/person-anchor/$graph')
            .set(getHeaders(attackerScope))
            .send(graphPersonToPatient);
        expect(resp.status).toBe(200);

        // ASSERT - PROA-tagged Patient must still exist
        resp = await request
            .get('/4_0_0/Patient/patient-proa')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Patient');
        expect(resp.body.id).toBe('patient-proa');

        // ASSERT - PROA-tagged Observation must still exist
        resp = await request
            .get('/4_0_0/Observation/observation-proa')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Observation');
        expect(resp.body.id).toBe('observation-proa');

        // ASSERT - client-p1 Patient should be deleted
        resp = await request
            .get('/4_0_0/Patient/patient-clientp1')
            .set(getHeaders('user/*.read access/client-p1.read'));
        expect(resp.status).toBe(404);
    });

    test('DELETE Patient/$graph should not delete PROA-tagged Observations', async () => {
        const request = await createTestRequest();

        // ARRANGE
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patientClientP1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observationProaLinkedToClientP1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT - DELETE $graph with graph from Patient to Observation
        const attackerScope = 'user/*.read user/*.write access/client-p1.* access/PROA.read';
        resp = await request
            .delete('/4_0_0/Patient/patient-clientp1/$graph')
            .set(getHeaders(attackerScope))
            .send(graphPatientToObservation);
        expect(resp.status).toBe(200);

        // ASSERT - PROA-tagged Observation must still exist
        resp = await request
            .get('/4_0_0/Observation/observation-proa-for-clientp1')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Observation');
        expect(resp.body.id).toBe('observation-proa-for-clientp1');

        // ASSERT - client-p1 Patient should be deleted
        resp = await request
            .get('/4_0_0/Patient/patient-clientp1')
            .set(getHeaders('user/*.read access/client-p1.read'));
        expect(resp.status).toBe(404);
    });
});
