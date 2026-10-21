// Read, update, patch, delete and mixed-token behavior with ENABLE_PATIENT_SCOPED_BINARY on.
const binary1Resource = require('./fixtures/binary1.json');
const { personScopedHeaders, mergePersonAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer, mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');

class FlagOnConfigManager extends ConfigManager {
    get enablePatientScopedBinary () {
        return true;
    }
}

const ALL_BINARY_SCOPE = 'patient/Binary.*';
const MIXED_SCOPE = 'patient/*.* user/*.* access/*.*';

describe('Binary patient scope read/write (ENABLE_PATIENT_SCOPED_BINARY on)', () => {
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
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new FlagOnConfigManager());
            return c;
        });
        return { request, personUuid: await mergePersonAsync(request) };
    }

    /**
     * Creates a Binary as a system caller and returns its server-assigned id. Waits for post-request
     * processing so the create's history write has finished before the test acts on the Binary.
     * @return {Promise<string>}
     */
    async function createAsSystemAsync (request, binary) {
        const requestId = mockHttpContext();
        const resp = await request.post('/4_0_0/Binary').send(binary).set(getHeaders());
        expect(resp).toHaveStatusCode(201);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return resp.body.id;
    }

    test('owner can read own Binary by id', async () => {
        const { request, personUuid } = await setupAsync();
        const id = await createAsSystemAsync(request, binary1Resource);
        const resp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
        expect(resp).toHaveStatusCode(200);
    });

    test('Binary owned by another patient is not readable', async () => {
        const { request, personUuid } = await setupAsync();
        const other = deepcopy(binary1Resource);
        other.securityContext.reference = 'Patient/someone-else';
        const id = await createAsSystemAsync(request, other);
        const resp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
        expect(resp.statusCode).toBeGreaterThanOrEqual(403);
        expect(resp.statusCode).toBeLessThanOrEqual(404);
    });

    test('Binary without securityContext is not readable by a patient-scoped token', async () => {
        const { request, personUuid } = await setupAsync();
        const untagged = deepcopy(binary1Resource);
        delete untagged.securityContext;
        const id = await createAsSystemAsync(request, untagged);
        const resp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
        expect(resp.statusCode).toBeGreaterThanOrEqual(403);
        expect(resp.statusCode).toBeLessThanOrEqual(404);
    });

    test('system token still reads a Binary without securityContext', async () => {
        const { request } = await setupAsync();
        const untagged = deepcopy(binary1Resource);
        delete untagged.securityContext;
        const id = await createAsSystemAsync(request, untagged);
        const resp = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders());
        expect(resp).toHaveStatusCode(200);
    });

    test('owner can update own Binary', async () => {
        const { request, personUuid } = await setupAsync();
        const id = await createAsSystemAsync(request, binary1Resource);
        const updated = deepcopy(binary1Resource);
        updated.id = id;
        updated.data = 'dXBkYXRlZA==';
        const resp = await request
            .put(`/4_0_0/Binary/${id}`)
            .send(updated)
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
        expect(resp.statusCode).toBeLessThan(300);
    });

    test('Binary owned by another patient cannot be updated', async () => {
        const { request, personUuid } = await setupAsync();
        const other = deepcopy(binary1Resource);
        other.securityContext.reference = 'Patient/someone-else';
        const id = await createAsSystemAsync(request, other);
        const resp = await request
            .put(`/4_0_0/Binary/${id}`)
            .send({ ...other, id })
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
        expect(resp).toHaveStatusCode(403);
    });

    test('owner can delete own Binary', async () => {
        const { request, personUuid } = await setupAsync();
        const id = await createAsSystemAsync(request, binary1Resource);
        const resp = await request
            .delete(`/4_0_0/Binary/${id}`)
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
                expect(resp.statusCode).toBeLessThan(300);
    });

    test('Binary owned by another patient cannot be deleted', async () => {
        const { request, personUuid } = await setupAsync();
        const other = deepcopy(binary1Resource);
        other.securityContext.reference = 'Patient/someone-else';
        const id = await createAsSystemAsync(request, other);
        await request
            .delete(`/4_0_0/Binary/${id}`)
            .set(personScopedHeaders(personUuid, ALL_BINARY_SCOPE));
        const resp = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders());
        expect(resp).toHaveStatusCode(200);
    });

    test('mixed token (patient + user + access) can create a Binary for its own patient', async () => {
        const { request, personUuid } = await setupAsync();
        const resp = await request
            .post('/4_0_0/Binary')
            .send(binary1Resource)
            .set(personScopedHeaders(personUuid, MIXED_SCOPE));
        expect(resp).toHaveStatusCode(201);
    });

    test('mixed token cannot create a Binary for another patient', async () => {
        const { request, personUuid } = await setupAsync();
        const other = deepcopy(binary1Resource);
        other.securityContext.reference = 'Patient/someone-else';
        const resp = await request
            .post('/4_0_0/Binary')
            .send(other)
            .set(personScopedHeaders(personUuid, MIXED_SCOPE));
        expect(resp).toHaveStatusCode(403);
    });
});
