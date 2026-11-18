// A patient-scoped caller can only update a resource while keeping its patient reference: PUT,
// PATCH and $merge reject re-pointing it (Observation.subject, Binary.securityContext, Task.for) at another
// patient, and the stored resource is left unchanged.
const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync, mergeResourceAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');

const OWNER_PATIENT_REF = 'Patient/patient1';
const FOREIGN_PATIENT_REF = 'Patient/someone-else';
const PATIENT_SCOPE = 'patient/*.* access/*.*';
const MISMATCH_TEXT = 'did not match with patient reference';

const security = [
    { system: 'https://www.icanbwell.com/owner', code: 'client' },
    { system: 'https://www.icanbwell.com/access', code: 'client' }
];

/**
 * @param {string} patientReference
 * @return {Object}
 */
function buildObservation (patientReference) {
    return {
        resourceType: 'Observation',
        id: 'observation-reassign',
        meta: { source: 'client', security },
        status: 'final',
        code: { text: 'test' },
        subject: { reference: patientReference }
    };
}

/**
 * @param {string} patientReference
 * @return {Object}
 */
function buildTask (patientReference) {
    return {
        resourceType: 'Task',
        id: 'task-reassign',
        meta: { source: 'client', security },
        status: 'requested',
        intent: 'order',
        for: { reference: patientReference }
    };
}

/**
 * @param {string} patientReference
 * @return {Object}
 */
function buildBinary (patientReference) {
    const binary = deepcopy(binary1Resource);
    binary.id = 'binary-reassign';
    binary.securityContext.reference = patientReference;
    return binary;
}

describe('Patient-scoped update cannot re-point the patient reference', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each([
        ['Observation', buildObservation, 'subject'],
        ['Binary', buildBinary, 'securityContext'],
        ['Task', buildTask, 'for']
    ])('%s', async (resourceType, build, referenceField) => {
        const request = await createTestRequest();
        const personUuid = await mergePersonAsync(request);
        const owned = build(OWNER_PATIENT_REF);
        await mergeResourceAsync(request, owned);
        const headers = personScopedHeaders(personUuid, PATIENT_SCOPE);
        const foreign = build(FOREIGN_PATIENT_REF);

        const putResp = await request
            .put(`/4_0_0/${resourceType}/${owned.id}`)
            .send(foreign)
            .set(headers);
        const patchResp = await request
            .patch(`/4_0_0/${resourceType}/${owned.id}`)
            .send([{ op: 'replace', path: `/${referenceField}/reference`, value: FOREIGN_PATIENT_REF }])
            .set({ ...headers, 'content-type': 'application/json-patch+json' });
        const mergeResp = await request
            .post(`/4_0_0/${resourceType}/$merge`)
            .send(foreign)
            .set(headers);

        expect(putResp.status).toBe(400);
        expect(JSON.stringify(putResp.body)).toContain(MISMATCH_TEXT);
        expect(patchResp.status).toBe(400);
        expect(JSON.stringify(patchResp.body)).toContain(MISMATCH_TEXT);
        expect(JSON.stringify(mergeResp.body.operationOutcome)).toContain(MISMATCH_TEXT);
        const stored = await request.get(`/4_0_0/${resourceType}/${owned.id}`).set(getHeaders());
        expect(stored.body[referenceField].reference).toBe(OWNER_PATIENT_REF);
    });

    test('an update that keeps the patient reference succeeds', async () => {
        const request = await createTestRequest();
        const personUuid = await mergePersonAsync(request);
        const owned = buildObservation(OWNER_PATIENT_REF);
        await mergeResourceAsync(request, owned);

        const resp = await request
            .put(`/4_0_0/Observation/${owned.id}`)
            .send({ ...owned, status: 'amended' })
            .set(personScopedHeaders(personUuid, PATIENT_SCOPE));

        expect(resp.status).toBe(200);
        const stored = await request.get(`/4_0_0/Observation/${owned.id}`).set(getHeaders());
        expect(stored.body.status).toBe('amended');
    });
});
