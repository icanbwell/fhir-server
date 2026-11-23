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
    async function everythingBinarySourceIdsAsync (request, headers, path = 'Patient/patient1', query = '') {
        const resp = await request.get(`/4_0_0/${path}/$everything${query}`).set(headers);
        const sourceIds = (resp.body.entry ?? [])
            .map((e) => e.resource)
            .filter((r) => r?.resourceType === 'Binary')
            .map((r) => r.securityContext?.extension?.find((x) => x.id === 'sourceId')?.valueString);
        return { status: resp.status, sourceIds };
    }

    /**
     * Seeds the Person linked to patient1, patient1, and three Binary resources
     * (owned by patient1, owned by someone else, and without a securityContext, the last one
     * referenced by a DocumentReference of patient1)
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

        // a DocumentReference for patient1 that points at the unowned Binary must not pull it in
        await mergeResourceAsync(request, {
            resourceType: 'DocumentReference',
            id: 'docref-unowned',
            meta: patientResource.meta,
            status: 'current',
            subject: { reference: 'Patient/patient1' },
            content: [{ attachment: { contentType: 'text/plain', url: 'Binary/binary-unowned' } }]
        });
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

    test.each([
        ['Patient', 'Patient/patient1'],
        ['Person', 'Person/person1']
    ])('%s $everything with _type=Binary returns only the Binary owned by the patient', async (_name, path) => {
        const request = await createTestRequest();
        await seedAsync(request);

        const { status, sourceIds } = await everythingBinarySourceIdsAsync(
            request,
            getHeaders('user/*.* access/*.* admin/*.*'),
            path,
            '?_type=Binary'
        );

        expect(status).toBe(200);
        expect(sourceIds).toEqual(['Patient/patient1']);
    });

    test('Person $everything returns only the Binary owned by a linked patient', async () => {
        const request = await createTestRequest();
        await seedAsync(request);

        const { status, sourceIds } = await everythingBinarySourceIdsAsync(
            request,
            getHeaders('user/*.* access/*.* admin/*.*'),
            'Person/person1'
        );

        expect(status).toBe(200);
        expect(sourceIds).toEqual(['Patient/patient1']);
    });

    test('returns no Binary to a patient-scoped token whose Person is not linked to the patient', async () => {
        const request = await createTestRequest();
        const personUuid = await seedAsync(request);

        // control: the linked Person sees the owned Binary, so an empty result below is filtering
        const linked = await everythingBinarySourceIdsAsync(
            request,
            personScopedHeaders(personUuid, 'patient/*.read access/*.*')
        );
        expect(linked.status).toBe(200);
        expect(linked.sourceIds).toEqual(['Patient/patient1']);

        const { status, sourceIds } = await everythingBinarySourceIdsAsync(
            request,
            personScopedHeaders('00000000-0000-4000-8000-000000000000', 'patient/*.read access/*.*')
        );

        expect(status).toBe(200);
        expect(sourceIds).toEqual([]);
    });
});
