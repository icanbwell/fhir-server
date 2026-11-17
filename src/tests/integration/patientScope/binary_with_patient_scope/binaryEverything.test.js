// Patient $everything returns a Binary through its securityContext, with no DocumentReference
// pointing at it, and never returns one owned by another patient.
const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync, mergeResourceAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders
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
     * @param {Object} headers
     * @return {Promise<{status: number, sourceIds: string[]}>} the response status and the
     * securityContext sourceId values (extension valueString) of the Binary resources returned
     */
    async function everythingBinarySourceIdsAsync (request, headers) {
        const resp = await request.get('/4_0_0/Patient/patient1/$everything').set(headers);
        const sourceIds = (resp.body.entry ?? [])
            .map((e) => e.resource)
            .filter((r) => r?.resourceType === 'Binary')
            .map((r) => r.securityContext?.extension?.find((x) => x.id === 'sourceId')?.valueString);
        return { status: resp.status, sourceIds };
    }

    /**
     * Seeds the Person linked to patient1, patient1, and three Binary resources
     * (owned by patient1, owned by someone else, and without a securityContext)
     * @param {import('supertest').Agent} request
     * @return {Promise<string>} the _uuid of the merged Person linked to patient1
     */
    async function seedAsync (request) {
        const personUuid = await mergePersonAsync(request);
        await mergeResourceAsync(request, patientResource);

        const owned = deepcopy(binary1Resource);
        owned.id = 'binary-owned';
        owned.securityContext.reference = 'Patient/patient1';
        await mergeResourceAsync(request, owned);

        const other = deepcopy(binary1Resource);
        other.id = 'binary-other';
        other.securityContext.reference = 'Patient/someone-else';
        await mergeResourceAsync(request, other);

        const unowned = deepcopy(binary1Resource);
        unowned.id = 'binary-unowned';
        delete unowned.securityContext;
        await mergeResourceAsync(request, unowned);
        return personUuid;
    }

    test.each([
        ['an admin token', () => getHeaders('user/*.* access/*.* admin/*.*')],
        ['a patient-scoped token', (personUuid) => personScopedHeaders(personUuid, 'patient/*.read access/*.*')]
    ])('returns only the Binary owned by the patient for %s', async (_name, headersFor) => {
        const request = await createTestRequest();
        const personUuid = await seedAsync(request);

        const { status, sourceIds } = await everythingBinarySourceIdsAsync(
            request,
            headersFor(personUuid)
        );

        expect(status).toBe(200);
        expect(sourceIds).toEqual(['Patient/patient1']);
    });

    test('returns no Binary to a patient-scoped token whose Person is not linked to the patient', async () => {
        const request = await createTestRequest();
        await seedAsync(request);

        const { status, sourceIds } = await everythingBinarySourceIdsAsync(
            request,
            personScopedHeaders('00000000-0000-4000-8000-000000000000', 'patient/*.read access/*.*')
        );

        expect([200, 403]).toContain(status);
        expect(sourceIds).toEqual([]);
    });
});
