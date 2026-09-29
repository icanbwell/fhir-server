// test file
const personAnchorResource = require('./fixtures_cross_tag/Person/person_anchor.json');
const patientClientP1Resource = require('./fixtures_cross_tag/Patient/patient_clientp1.json');
const patientProaResource = require('./fixtures_cross_tag/Patient/patient_proa.json');
const observationProaResource = require('./fixtures_cross_tag/Observation/observation_proa.json');
const observationProaLinkedToClientP1Resource = require('./fixtures_cross_tag/Observation/observation_proa_linked_to_clientp1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Delete $everything cross-tag authorization Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('DELETE Person/$everything should not delete resources the caller lacks write access to', async () => {
        const request = await createTestRequest();

        // ARRANGE - seed resources using full-access token
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patientClientP1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patientProaResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observationProaResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(personAnchorResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Verify PROA resources are accessible before the attack
        resp = await request
            .get('/4_0_0/Patient/patient-proa')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('patient-proa');

        resp = await request
            .get('/4_0_0/Observation/observation-proa')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('observation-proa');

        // ACT - Delete $everything with token that has:
        //   - write access to client-p1 (the anchor Person's tag)
        //   - read-only access to PROA (the linked Patient & Observation's tag)
        const attackerScope = 'user/*.read user/*.write access/client-p1.* access/PROA.read';
        resp = await request
            .delete('/4_0_0/Person/person-anchor/$everything')
            .set(getHeaders(attackerScope));
        expect(resp.status).toBe(200);

        // ASSERT - PROA-tagged Patient must still exist (not deleted)
        resp = await request
            .get('/4_0_0/Patient/patient-proa')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Patient');
        expect(resp.body.id).toBe('patient-proa');

        // ASSERT - PROA-tagged Observation must still exist (not deleted)
        resp = await request
            .get('/4_0_0/Observation/observation-proa')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Observation');
        expect(resp.body.id).toBe('observation-proa');

        // ASSERT - client-p1 Patient should be deleted (caller has write access)
        resp = await request
            .get('/4_0_0/Patient/patient-clientp1')
            .set(getHeaders('user/*.read access/client-p1.read'));
        expect(resp.status).toBe(404);

        // ASSERT - anchor Person should be deleted (caller has write access)
        resp = await request
            .get('/4_0_0/Person/person-anchor')
            .set(getHeaders('user/*.read access/client-p1.read'));
        expect(resp.status).toBe(404);
    });

    test('DELETE Patient/$everything should not delete PROA-tagged Observations linked to the patient', async () => {
        const request = await createTestRequest();

        // ARRANGE - Patient with client-p1 access, Observation linked to it with PROA access
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patientClientP1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observationProaLinkedToClientP1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Verify Observation exists before attack
        resp = await request
            .get('/4_0_0/Observation/observation-proa-for-clientp1')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.id).toBe('observation-proa-for-clientp1');

        // ACT - Delete Patient/$everything with token that has write to client-p1 but only read to PROA
        const attackerScope = 'user/*.read user/*.write access/client-p1.* access/PROA.read';
        resp = await request
            .delete('/4_0_0/Patient/patient-clientp1/$everything')
            .set(getHeaders(attackerScope));
        expect(resp.status).toBe(200);

        // ASSERT - PROA-tagged Observation must still exist
        resp = await request
            .get('/4_0_0/Observation/observation-proa-for-clientp1')
            .set(getHeaders('user/*.read access/PROA.read'));
        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Observation');
        expect(resp.body.id).toBe('observation-proa-for-clientp1');

        // ASSERT - client-p1 Patient itself should be deleted (caller has write access)
        resp = await request
            .get('/4_0_0/Patient/patient-clientp1')
            .set(getHeaders('user/*.read access/client-p1.read'));
        expect(resp.status).toBe(404);
    });
});
