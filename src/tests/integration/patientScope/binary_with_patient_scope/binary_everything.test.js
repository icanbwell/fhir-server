// Patient $everything returns a Binary through its securityContext, with no DocumentReference
// pointing at it, and never returns one owned by another patient.
const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer, mockHttpContext
} = require('../../common');

const patientResource = {
    resourceType: 'Patient',
    id: 'patient1',
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/access', code: 'client' }
        ]
    },
    name: [{ family: 'TEST', given: ['PATIENT'] }]
};

describe('Binary patient $everything by securityContext', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * @param {import('supertest').Agent} request
     * @param {Object} resource
     * @return {Promise<void>}
     */
    async function mergeAsync (request, resource) {
        const requestId = mockHttpContext();
        const resp = await request
            .post(`/4_0_0/${resource.resourceType}/1/$merge?validate=true`)
            .send(resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    }

    /**
     * @param {import('supertest').Agent} request
     * @param {Object} headers
     * @return {Promise<string[]>} the securityContext references of the Binary resources in the response
     */
    async function everythingBinaryIdsAsync (request, headers) {
        const resp = await request.get('/4_0_0/Patient/patient1/$everything').set(headers);
        expect(resp).toHaveStatusCode(200);
        return (resp.body.entry ?? [])
            .map((e) => e.resource)
            .filter((r) => r.resourceType === 'Binary')
            .map((r) => r.securityContext?.extension?.find((x) => x.id === 'sourceId')?.valueString);
    }

    test.each([
        ['an admin token', () => getHeaders('user/*.* access/*.* admin/*.*')],
        ['a patient-scoped token', (personUuid) => personScopedHeaders(personUuid, 'patient/*.read access/*.*')]
    ])('returns only the Binary owned by the patient for %s', async (_name, headersFor) => {
        const request = await createTestRequest();
        const personUuid = await mergePersonAsync(request);
        await mergeAsync(request, patientResource);

        const owned = deepcopy(binary1Resource);
        owned.id = 'binary-owned';
        owned.securityContext.reference = 'Patient/patient1';
        await mergeAsync(request, owned);

        const other = deepcopy(binary1Resource);
        other.id = 'binary-other';
        other.securityContext.reference = 'Patient/someone-else';
        await mergeAsync(request, other);

        const unowned = deepcopy(binary1Resource);
        unowned.id = 'binary-unowned';
        delete unowned.securityContext;
        await mergeAsync(request, unowned);

        const references = await everythingBinaryIdsAsync(request, headersFor(personUuid));

        expect(references).toEqual(['Patient/patient1']);
    });
});
