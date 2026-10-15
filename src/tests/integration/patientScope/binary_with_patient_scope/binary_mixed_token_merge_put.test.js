// DCON-5986: a MIXED token (patient/ plus user/ and access/ scopes) cannot create a NEW Binary through $merge or
// PUT-create, with ENABLE_PATIENT_SCOPED_BINARY_CREATE on, for every token shape below including the
// access/*.* user/*.* patient/*.* wildcard that real member tokens carry. Only POST /Binary takes the person-context create path
// (scopesValidator: write with user scopes is refused when a patient scope is present), so the isCreate early
// returns in scopesManager.isAccessTagChangeAllowedByScopes are never reached this way. Nothing is persisted.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getHeadersWithCustomPayload,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');
const { memberClaims, createHelpers } = require('./binaryScopeTestHelpers');

class MixedTokenConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }
}

const owner = (code) => ({ system: 'https://www.icanbwell.com/owner', code });
const access = (code) => ({ system: 'https://www.icanbwell.com/access', code });
const source = 'https://example.com/test';

const SCOPES = [
    { name: 'access/*.* user/*.* patient/*.*', scope: 'access/*.* user/*.* patient/*.*', wildcard: true },
    { name: 'user/*.* access/clientA.* patient/*.*', scope: 'user/*.* access/clientA.* patient/*.*' },
    { name: 'access/clientA.* user/Binary.* patient/Binary.write', scope: 'access/clientA.* user/Binary.* patient/Binary.write' }
];

const binary = (id, security) => ({
    resourceType: 'Binary',
    id,
    meta: { source, security },
    contentType: 'application/pdf',
    data: 'JVBERi0xLjQK'
});

describe('Mixed token Binary $merge / PUT-create with foreign access tag', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });
    afterEach(async () => {
        await commonAfterEach();
    });

    const setup = async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MixedTokenConfigManager());
            return c;
        });
        const helpers = createHelpers(request, requestId);
        await helpers.merge('Patient', {
            resourceType: 'Patient', id: 'shared-patient',
            meta: { source, security: [owner('clientA'), access('clientA')] }, name: [{ family: 'S' }]
        });
        const personA = await helpers.merge('Person', {
            resourceType: 'Person', id: 'person-a', birthDate: '1990-01-01', gender: 'male',
            meta: { source, security: [owner('clientA'), access('clientA')] },
            name: [{ family: 'A', given: ['T'], use: 'usual' }],
            link: [{ target: { reference: 'Patient/shared-patient', type: 'Patient' }, assurance: 'level4' }]
        });
        return { request, helpers, personA };
    };

    const adminStatus = async (request, id) => {
        const r = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders());
        return r.statusCode;
    };

    // $merge answers 200 with a per-entry OperationOutcome; PUT answers 403.
    const expectMergeRefused = (resp) => {
        expect(resp.body.created).not.toBe(true);
        expect(resp.body.updated).not.toBe(true);
        expect(resp.body.operationOutcome.issue[0].code).toBe('forbidden');
        expect(resp.body.operationOutcome.issue[0].details.text).toContain('Write not allowed using user scopes if patient scope is present');
    };
    const expectPutRefused = (resp) => {
        expect(resp.statusCode).toBe(403);
        expect(resp.body.issue[0].code).toBe('forbidden');
    };

    describe.each(SCOPES)('token $name', ({ scope }) => {
        test('(a) $merge new Binary with foreign access tag is refused and not persisted', async () => {
            const { request, helpers, personA } = await setup();
            const resp = await request
                .post('/4_0_0/Binary/1/$merge?validate=true')
                .send(binary('mixed-merge-foreign', [owner('clientA'), access('clientA'), access('clientB')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            expectMergeRefused(resp);
            await helpers.waitForPostSave();
            expect(await adminStatus(request, 'mixed-merge-foreign')).toBe(404);
        });

        test('(b) PUT-create new Binary with foreign access tag is refused and not persisted', async () => {
            const { request, helpers, personA } = await setup();
            const resp = await request
                .put('/4_0_0/Binary/mixed-put-foreign')
                .send(binary('mixed-put-foreign', [owner('clientA'), access('clientA'), access('clientB')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            expectPutRefused(resp);
            await helpers.waitForPostSave();
            expect(await adminStatus(request, 'mixed-put-foreign')).toBe(404);
        });

        test('(b2) PUT-create new Binary wholly in a foreign tenant is refused and not persisted', async () => {
            const { request, helpers, personA } = await setup();
            const resp = await request
                .put('/4_0_0/Binary/mixed-put-clientb')
                .send(binary('mixed-put-clientb', [owner('clientB'), access('clientB')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            expectPutRefused(resp);
            await helpers.waitForPostSave();
            expect(await adminStatus(request, 'mixed-put-clientb')).toBe(404);
        });

        test('(c) own tenant tags are refused too: POST /Binary is the only create path', async () => {
            const { request, helpers, personA } = await setup();
            const m = await request
                .post('/4_0_0/Binary/1/$merge?validate=true')
                .send(binary('mixed-merge-own', [owner('clientA'), access('clientA')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            const p = await request
                .put('/4_0_0/Binary/mixed-put-own')
                .send(binary('mixed-put-own', [owner('clientA'), access('clientA')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            expectMergeRefused(m);
            expectPutRefused(p);
            await helpers.waitForPostSave();
            expect(await adminStatus(request, 'mixed-merge-own')).toBe(404);
            expect(await adminStatus(request, 'mixed-put-own')).toBe(404);
        });
    });
});
