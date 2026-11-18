const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common');

describe('Binary patient scope', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * @return {Promise<{request: import('supertest').Agent, personUuid: string}>}
     */
    async function setupAsync () {
        const request = await createTestRequest();
        return { request, personUuid: await mergePersonAsync(request) };
    }

    test('create succeeds when securityContext is a patient linked to the caller', async () => {
        const { request, personUuid } = await setupAsync();
        const resp = await request
            .post('/4_0_0/Binary')
            .send(binary1Resource)
            .set(personScopedHeaders(personUuid));
        expect(resp).toHaveStatusCode(201);
    });

    test('create succeeds when securityContext is the caller proxy person patient', async () => {
        const { request, personUuid } = await setupAsync();
        const binary = deepcopy(binary1Resource);
        binary.securityContext.reference = `Patient/person.${personUuid}`;
        const resp = await request
            .post('/4_0_0/Binary')
            .send(binary)
            .set(personScopedHeaders(personUuid));
        expect(resp).toHaveStatusCode(201);
    });

    test('create is rejected when securityContext is another patient', async () => {
        const { request, personUuid } = await setupAsync();
        const binary = deepcopy(binary1Resource);
        binary.securityContext.reference = 'Patient/someone-else';
        const resp = await request
            .post('/4_0_0/Binary')
            .send(binary)
            .set(personScopedHeaders(personUuid));
        expect(resp).toHaveStatusCode(403);
    });

    test('create is rejected when securityContext is missing', async () => {
        const { request, personUuid } = await setupAsync();
        const binary = deepcopy(binary1Resource);
        delete binary.securityContext;
        const resp = await request
            .post('/4_0_0/Binary')
            .send(binary)
            .set(personScopedHeaders(personUuid));
        expect(resp).toHaveStatusCode(403);
    });
});
