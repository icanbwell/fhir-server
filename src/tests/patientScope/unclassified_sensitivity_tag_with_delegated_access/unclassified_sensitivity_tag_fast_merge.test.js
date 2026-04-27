const { describe, beforeAll, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    fakeTimerBeforeEach,
    resetTimerAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    getHeadersJsonPatch,
    getGraphQLHeaders,
    mockHttpContext
} = require('../../common');

const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const activeConsentResource = require('./fixtures/Consent/activeConsent.json');
const expectedPatientScopedObservation = require('./fixtures/expected/patientSearchVisible.json');
const expectedDelegatedSearchHidden = require('./fixtures/expected/delegatedSearchHidden.json');
const expectedUnclassifiedObservation = require('./fixtures/expected/expectedUnclassifiedObservation.json');
const expectedUnclassifiedCareTeam = require('./fixtures/expected/expectedUnclassifiedCareTeam.json');

const { ConfigManager } = require('../../../utils/configManager');
const { SENSITIVE_CATEGORY } = require('../../../constants');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
const deepcopy = require('deepcopy');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }

    get resourceTypesForUnclassifiedTagging () {
        return new Set(['Observation', 'CareTeam']);
    }

    get enableMergeFastSerializer () {
        return true;
    }

    get enableDelegatedAccessDetection () {
        return true;
    }
}

async function seedBaseFixtures (request) {
    const seedFixtures = [
        { url: '/4_0_0/Person/1/$merge?validate=true', body: deepcopy(topLevelPersonResource) },
        { url: '/4_0_0/Person/1/$merge?validate=true', body: deepcopy(person1Resource) },
        { url: '/4_0_0/Patient/1/$merge?validate=true', body: deepcopy(patient1Resource) }
    ];

    for (const { url, body } of seedFixtures) {
        const resp = await request.post(url).send(body).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
    }
}

const patientPayload = {
    scope: 'patient/Patient.read patient/Observation.read access/*.read',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
    clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access'
};

const delegatedPayload = {
    ...patientPayload,
    act: {
        reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
        sub: 'delegated-sub-123'
    }
};

describe('Unclassified Sensitivity Tag (Fast Merge Serializer)', () => {
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeAll(() => {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = '1';
    });

    afterAll(async () => {
        delete process.env.ENABLE_MERGE_FAST_SERIALIZER;
        cursorSpy.mockRestore();
        await commonAfterEach();
    });

    beforeEach(async () => {
        await fakeTimerBeforeEach();
        jest.setSystemTime(MOCK_DATE);
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        await resetTimerAfterEach();
    });

    test('$merge insert adds unclassified tag, visible to service and patient scope', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // service-scope: sees unclassified observation
        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp).toHaveResponse(expectedUnclassifiedObservation);

        // patient-scope: sees unclassified observation with full response match
        resp = await request
            .get('/4_0_0/Observation/?_debug=1')
            .set(getHeadersWithCustomPayload(patientPayload));

        const expectedResponse = deepcopy(expectedPatientScopedObservation);
        expect(resp).toHaveMongoQuery(expectedResponse);
        expect(resp).toHaveResponse(expectedResponse);
    });

    test('$merge insert adds unclassified tag, hidden from delegated user', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Consent/1/$merge?validate=true')
            .send(deepcopy(activeConsentResource))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // delegated-scope: unclassified observation is filtered out
        resp = await request
            .get('/4_0_0/Observation/?_debug=1')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        const expectedDelegated = deepcopy(expectedDelegatedSearchHidden);
        expect(resp).toHaveMongoQuery(expectedDelegated);
        expect(resp).toHaveResponse(expectedDelegated);
    });

    test('$merge update preserves unclassified tag, visible to service and patient scope', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const updatedObservation = deepcopy(observation1Resource);
        updatedObservation.valueQuantity.value = 240;

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(updatedObservation)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        // service-scope: sees updated observation with tag
        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        const expectedMergeUpdate = deepcopy(expectedUnclassifiedObservation);
        expectedMergeUpdate.valueQuantity.value = 240;
        expectedMergeUpdate.meta.versionId = '2';
        expect(resp).toHaveResponse(expectedMergeUpdate);

        // patient-scope: also sees the updated observation
        resp = await request
            .get('/4_0_0/Observation/?_debug=1')
            .set(getHeadersWithCustomPayload(patientPayload));

        const expectedResponse = deepcopy(expectedPatientScopedObservation);
        expectedResponse.entry[0].resource.valueQuantity.value = 240;
        expectedResponse.entry[0].resource.meta.versionId = '2';
        expect(resp).toHaveMongoQuery(expectedResponse);
        expect(resp).toHaveResponse(expectedResponse);
    });

    test('PATCH preserves unclassified tag on patched resource', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        mockHttpContext();

        await seedBaseFixtures(request);

        // merge with suppress header — unclassified tag not added
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === 'https://www.icanbwell.com/sensitivity-category' && s.code === 'unclassified'
        )).toBeUndefined();

        // PATCH without suppress — preSaveHandler adds unclassified tag
        const patchOps = [
            { op: 'replace', path: '/valueQuantity/value', value: 220 }
        ];

        resp = await request
            .patch('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .send(patchOps)
            .set(getHeadersJsonPatch());
        expect(resp.status).toBe(200);

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        const expectedPatch = deepcopy(expectedUnclassifiedObservation);
        expectedPatch.valueQuantity.value = 220;
        expectedPatch.meta.versionId = '2';
        expect(resp).toHaveResponse(expectedPatch);
    });

    test('PUT preserves unclassified tag on updated resource', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        mockHttpContext();

        await seedBaseFixtures(request);

        // merge with suppress header — unclassified tag not added
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === 'https://www.icanbwell.com/sensitivity-category' && s.code === 'unclassified'
        )).toBeUndefined();

        // PUT without suppress — preSaveHandler adds unclassified tag
        const updatedObservation = deepcopy(observation1Resource);
        updatedObservation.valueQuantity.value = 230;

        resp = await request
            .put('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .send(updatedObservation)
            .set(getHeaders());
        expect(resp.status).toBe(200);

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        const expectedPut = deepcopy(expectedUnclassifiedObservation);
        expectedPut.valueQuantity.value = 230;
        expectedPut.meta.versionId = '2';
        expect(resp).toHaveResponse(expectedPut);
    });

    test('suppress header on $merge update preserves existing unclassified tag', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        // create with tag
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();

        // $merge update with suppress header — existing tag preserved
        let updatedObservation = deepcopy(observation1Resource);
        updatedObservation.valueQuantity.value = 250;

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(updatedObservation)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();

        // smartMerge=false will remove the tag
        updatedObservation = deepcopy(observation1Resource);

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true&smartMerge=0')
            .send(updatedObservation)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();
    });

    test('$merge update without suppress adds tag to previously suppressed resource', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        // create with suppress — no tag
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();

        // $merge update without suppress — tag should be added
        const updatedObservation = deepcopy(observation1Resource);
        updatedObservation.valueQuantity.value = 260;

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(updatedObservation)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
    });

    test('$merge should add unclassified tag to previously suppressed resource when suppress header is not set', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();

        const observationWithTag = deepcopy(observation1Resource);
        observationWithTag.meta.security.push({
            system: SENSITIVE_CATEGORY.SYSTEM,
            code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE,
            id: "2a642de9-eaea-53d5-a5d5-277d9d46ac1e"
        });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observationWithTag)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
        expect(resp.body.meta.versionId).toBe('2');
    });

    test('put should add unclassified tag to previously suppressed resource when suppress header is not set and unclassified is passed', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();

        const serverResource = resp.body;

        // PUT the server response back with unclassified tag added — should update
        const observationWithTag = deepcopy(serverResource);
        observationWithTag.meta.security.push({
            id: '2a642de9-eaea-53d5-a5d5-277d9d46ac1e',
            system: SENSITIVE_CATEGORY.SYSTEM,
            code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        });

        resp = await request
            .put('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .send(observationWithTag)
            .set(getHeaders());
        expect(resp.status).toBe(200);

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
        expect(resp.body.meta.versionId).toBe('2');
    });

     test('patch should add unclassified tag to previously suppressed resource when suppress header is not set and unclassified is passed', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();

        const patchOps = [
            { op: 'add', path: '/meta/security/-', value: {
                system: SENSITIVE_CATEGORY.SYSTEM,
                code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE,
                id: "2a642de9-eaea-53d5-a5d5-277d9d46ac1e"
            }}
        ];

        resp = await request
            .patch('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .send(patchOps)
            .set(getHeadersJsonPatch());
        expect(resp.status).toBe(200);

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
        expect(resp.body.meta.versionId).toBe('2');
    });

    test('$merge with smartMerge adds unclassified tag to previously suppressed resource', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();

        const observationWithTag = deepcopy(observation1Resource);
        observationWithTag.meta.security.push({
            system: SENSITIVE_CATEGORY.SYSTEM,
            code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE,
            id: '2a642de9-eaea-53d5-a5d5-277d9d46ac1e'
        });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true&smartMerge=1')
            .send(observationWithTag)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
        expect(resp.body.meta.versionId).toBe('2');
    });

    test('suppress header on PATCH preserves existing unclassified tag', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        mockHttpContext();

        await seedBaseFixtures(request);

        // create with tag
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();

        // PATCH with suppress header — existing tag preserved
        const patchOps = [
            { op: 'replace', path: '/valueQuantity/value', value: 270 }
        ];

        resp = await request
            .patch('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .send(patchOps)
            .set({ ...getHeadersJsonPatch(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp.status).toBe(200);

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
    });

    test('smart merge -delete on unclassified tag returns updated:false (tag re-added by preSave)', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        const unclassifiedTag = resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        );
        expect(unclassifiedTag).toBeDefined();

        const deleteDirective = {
            resourceType: 'Observation',
            id: 'b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b',
            meta: {
                source: '/patients',
                security: [
                    { id: `${unclassifiedTag.id}-delete` }
                ]
            }
        };

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(deleteDirective)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: false });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeDefined();
        expect(resp.body.meta.versionId).toBe('1');
    });

    test('smart merge -delete on unclassified tag should remove the tag with suppress headers', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        const unclassifiedTag = resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        );
        expect(unclassifiedTag).toBeDefined();

        const deleteDirective = {
            resourceType: 'Observation',
            id: 'b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b',
            meta: {
                source: '/patients',
                security: [{ id: `${unclassifiedTag.id}-delete` }]
            }
        };

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(deleteDirective)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ updated: false });

        // with suppress headers
        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(deleteDirective)
            .set({ ...getHeaders(), [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });
        expect(resp).toHaveMergeResponse({ updated: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        expect(resp.body.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        )).toBeUndefined();
        expect(resp.body.meta.versionId).toBe('2');
    });

    test('$merge with duplicate unclassified tags in payload deduplicates to one', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });

        await seedBaseFixtures(request);

        const observationWithDuplicateTags = deepcopy(observation1Resource);
        observationWithDuplicateTags.meta.security.push(
            { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE },
            { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE },
            { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }
        );

        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observationWithDuplicateTags)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation/b7d5e8a1-3c2f-4d9e-a1b6-8f7c3e2d1a0b')
            .set(getHeaders());
        expect(resp).toHaveStatusOk();
        const tags = resp.body.meta.security.filter(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        );
        expect(tags).toHaveLength(1);
        expect(tags[0].id).toBeDefined();
    });

    describe('GraphQL mutations with unclassified tagging', () => {
        test('updatePreferredProviders mutation adds unclassified tag to CareTeam', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            mockHttpContext();

            const patientForMutation = {
                resourceType: 'Patient',
                id: 'ct-patient-1',
                meta: {
                    source: 'http://clienthealth.org/provider',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                birthDate: '2000-01-01',
                gender: 'male',
                name: [{ use: 'usual', family: 'CARETEAM', given: ['TEST'] }]
            };

            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientForMutation)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const practitionerForMutation = {
                resourceType: 'Practitioner',
                id: 'ct-pract-1',
                meta: {
                    source: 'http://clienthealth.org/provider',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                name: [{ family: 'Jones', given: ['Bob'] }]
            };

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge?validate=true')
                .send(practitionerForMutation)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const mutationQuery = `mutation {
                updatePreferredProviders(
                    patientId: "ct-patient-1"
                    team: {
                        resourceType: CareTeam
                        id: "ct-team-1"
                        meta: {
                            source: "client"
                            security: [
                                { system: "https://www.icanbwell.com/access", code: "client" }
                                { system: "https://www.icanbwell.com/owner", code: "client" }
                            ]
                        }
                        status: active
                        name: "Test Care Team"
                        subject: "Patient/ct-patient-1"
                        participant: [
                            { role: [{ text: "adviser" }], member: "Practitioner/ct-pract-1" }
                        ]
                    }
                ) {
                    id
                }
            }`;

            resp = await request
                .post('/$graphql')
                .send({ operationName: null, variables: {}, query: mutationQuery })
                .set(getGraphQLHeaders('user/Patient.read user/Patient.write user/CareTeam.write user/Practitioner.read access/client.*'));

            expect(resp.status).toBe(200);
            if (resp.body.errors) {
                expect(resp.body.errors).toBeUndefined();
            }

            resp = await request
                .get('/4_0_0/CareTeam/ct-team-1')
                .set(getHeaders());
            expect(resp).toHaveStatusOk();
            const expectedCareTeam = deepcopy(expectedUnclassifiedCareTeam);
            delete expectedCareTeam.encounter;
            delete expectedCareTeam.participant[0].onBehalfOf;
            expect(resp).toHaveResponse(expectedCareTeam);
        });
    });
});
