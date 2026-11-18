const { getHeadersWithCustomPayload, getHeaders, getTestContainer, mockHttpContext } = require('../../common');
const { expect } = require('@jest/globals');
const person1Resource = require('./fixtures/person1.json');

const basePayload = {
    scope: 'patient/Binary.write',
    username: 'patient-123@example.com',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
};

/**
 * Patient-scoped self-lookup resolves the caller's Person by _uuid, so the claims carry the
 * _uuid Mongo assigned to the merged person1 fixture.
 * @param {string} personUuid
 * @param {string} [scope]
 * @return {Object}
 */
function personScopedHeaders (personUuid, scope = basePayload.scope) {
    return getHeadersWithCustomPayload({
        ...basePayload,
        scope,
        clientFhirPersonId: personUuid,
        bwellFhirPersonId: personUuid
    });
}

/**
 * Merges a resource and waits for its post-request tasks (history flush) to finish
 * @param {import('supertest').Agent} request
 * @param {Object} resource
 * @return {Promise<Object>} the merge response
 */
async function mergeResourceAsync (request, resource) {
    const requestId = mockHttpContext();
    const resp = await request
        .post(`/4_0_0/${resource.resourceType}/1/$merge?validate=true`)
        .send(resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
    await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    return resp;
}

/**
 * Merges the person1 fixture (linked to Patient/patient1) and returns its _uuid
 * @param {import('supertest').Agent} request
 * @return {Promise<string>}
 */
async function mergePersonAsync (request) {
    const resp = await mergeResourceAsync(request, person1Resource);
    return resp.body.uuid;
}

module.exports = { personScopedHeaders, mergePersonAsync, mergeResourceAsync };
