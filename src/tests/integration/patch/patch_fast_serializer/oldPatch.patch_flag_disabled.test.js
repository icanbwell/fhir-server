process.env.ENABLE_PATCH_FAST_SERIALIZER = '0';

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const practitionerPayload = () => ({
    resourceType: 'Practitioner',
    active: true,
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
        ]
    },
    name: [{ family: 'NAJJAR  MD', given: ['SAMER S.'], use: 'usual' }]
});

describe('Patch with fast serializer disabled', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('patch uses the existing flow when the flag is disabled', async () => {
        await createTestRequest();
        expect(getTestContainer().patchOperation.useFastSerializer).toStrictEqual(false);
    });

    test('existing flow silently drops an unknown field added by a patch', async () => {
        const request = await createTestRequest();
        const postResp = await request.post('/4_0_0/Practitioner').send(practitionerPayload()).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        const id = postResp.body.id;
        const patchResp = await request
            .patch(`/4_0_0/Practitioner/${id}`)
            .send([
                { op: 'add', path: '/notAFhirField', value: 'x' },
                { op: 'replace', path: '/active', value: false }
            ])
            .set(getHeadersJsonPatch());
        expect(patchResp).toHaveStatusCode(200);
        expect(patchResp.body.notAFhirField).toBeUndefined();
        expect(patchResp.body.active).toStrictEqual(false);
    });
});
