// A patient-scoped caller can only update a resource while keeping its patient reference: PUT,
// PATCH and $merge reject re-pointing it (Observation.subject, Binary.securityContext) at another
// patient, and the stored resource is left unchanged.
const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync, mergeResourceAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');

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
        ['Binary', buildBinary, 'securityContext']
    ])('%s', async (resourceType, build, referenceField) => {
        const request = await createTestRequest();
        const personUuid = await mergePersonAsync(request);
        const owned = build('Patient/patient1');
        await mergeResourceAsync(request, owned);
        const headers = personScopedHeaders(personUuid, 'patient/*.* access/*.*');
        const foreign = build('Patient/someone-else');

        const putResp = await request
            .put(`/4_0_0/${resourceType}/${owned.id}`)
            .send(foreign)
            .set(headers);
        const patchResp = await request
            .patch(`/4_0_0/${resourceType}/${owned.id}`)
            .send([{ op: 'replace', path: `/${referenceField}/reference`, value: 'Patient/someone-else' }])
            .set({ ...headers, 'content-type': 'application/json-patch+json' });
        const mergeResp = await request
            .post(`/4_0_0/${resourceType}/$merge`)
            .send(foreign)
            .set(headers);

        expect(putResp.status).toBe(400);
        expect(patchResp.status).toBe(400);
        const mergeOutcome = mergeResp.body.operationOutcome ?? mergeResp.body;
        expect(JSON.stringify(mergeOutcome)).toContain('did not match with patient reference');
        const stored = await request.get(`/4_0_0/${resourceType}/${owned.id}`).set(getHeaders());
        expect(stored.body[referenceField].reference).toBe('Patient/patient1');
    });
});
