const patient1Resource = require('./fixtures/patient1.json');
const observation1Resource = require('./fixtures/observation1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('$everything v2 CRUDS scope granularity Tests', () => {
    let originalFlag;

    beforeAll(() => {
        originalFlag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
    });

    afterAll(() => {
        if (originalFlag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalFlag;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each([
        [
            'r on the root and s on the related type returns the patient and its observation',
            'user/Patient.r user/Observation.s access/access.rs access/owner.rs',
            200,
            ['Observation', 'Patient']
        ],
        [
            'r on the root without s on Observation leaves the observation out',
            'user/Patient.r user/Observation.r access/access.rs access/owner.rs',
            200,
            ['Patient']
        ],
        [
            's alone on the root is denied because the request is by id',
            'user/Patient.s user/Observation.s access/access.s access/owner.s',
            200,
            ['OperationOutcome']
        ],
        [
            'r on the resource gate only is denied',
            'user/Patient.r user/Observation.s access/access.s access/owner.s',
            200,
            ['OperationOutcome']
        ]
    ])('GET %s', async (name, scope, status, resourceTypes) => {
        const request = await createTestRequest();
        const merged = await request
            .post('/4_0_0/Patient/$merge')
            .send([patient1Resource, observation1Resource])
            .set(getHeaders());
        expect(merged).toHaveMergeResponse([{ created: true }, { created: true }]);

        const resp = await request.get('/4_0_0/Patient/1/$everything').set(getHeaders(scope));
        expect(resp.status).toBe(status);
        if (resourceTypes) {
            expect(resp.body.entry.map((e) => e.resource.resourceType).sort()).toEqual(resourceTypes);
        }
    });

    test.each([
        [
            'd on the root and ds on the related type deletes both',
            'user/Patient.d user/Observation.ds access/access.ds access/owner.ds',
            ['Observation', 'Patient'],
            true,
            true
        ],
        [
            'd alone deletes the patient and leaves the observation it cannot search',
            'user/Patient.d user/Observation.d access/access.d access/owner.d',
            ['Patient'],
            true,
            false
        ],
        [
            's without d on the root is rejected before anything is deleted',
            'user/Patient.s user/Observation.s access/access.s access/owner.s',
            ['OperationOutcome'],
            false,
            false
        ]
    ])('DELETE %s', async (name, scope, resourceTypes, patientDeleted, observationDeleted) => {
        const request = await createTestRequest();
        const merged = await request
            .post('/4_0_0/Patient/$merge')
            .send([patient1Resource, observation1Resource])
            .set(getHeaders());
        expect(merged).toHaveMergeResponse([{ created: true }, { created: true }]);

        const resp = await request.delete('/4_0_0/Patient/1/$everything').set(getHeaders(scope));
        expect(resp.status).toBe(200);
        expect(resp.body.entry.map((e) => e.resource.resourceType).sort()).toEqual(resourceTypes);

        const patient = await request.get('/4_0_0/Patient/1').set(getHeaders());
        const observation = await request.get('/4_0_0/Observation/obs1').set(getHeaders());
        expect(patient.status).toBe(patientDeleted ? 404 : 200);
        expect(observation.status).toBe(observationDeleted ? 404 : 200);
    });
});
