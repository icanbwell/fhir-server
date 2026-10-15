// DCON-5986: a MIXED token (patient/ plus user/ and access/ scopes) cannot create a NEW Binary through $merge or
// PUT-create, with ENABLE_PATIENT_SCOPED_BINARY_CREATE on. Only POST /Binary takes the person-context create path
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

    const adminCount = async (request, id) => {
        const r = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders());
        return r.statusCode;
    };

    describe.each(SCOPES)('token $name', ({ scope, wildcard }) => {
        const tagsFor = (code) => [owner('clientA'), access(code)];

        test('(a) $merge new Binary with foreign access tag', async () => {
            const { request, helpers, personA } = await setup();
            const resp = await request
                .post('/4_0_0/Binary/1/$merge?validate=true')
                .send(binary('mixed-merge-foreign', [owner('clientA'), access('clientA'), access('clientB')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            console.log('MERGE foreign', scope, resp.statusCode, JSON.stringify(resp.body).slice(0, 400));
            await helpers.waitForPostSave();
            const stored = await adminCount(request, 'mixed-merge-foreign');
            console.log('MERGE foreign persisted status', stored);
            if (!wildcard) {
                expect(stored).toBe(404);
                expect(resp.body.created).not.toBe(true);
            }
        });

        test('(b) PUT-create new Binary with foreign access tag', async () => {
            const { request, helpers, personA } = await setup();
            const resp = await request
                .put('/4_0_0/Binary/mixed-put-foreign')
                .send(binary('mixed-put-foreign', [owner('clientA'), access('clientA'), access('clientB')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            console.log('PUT foreign', scope, resp.statusCode, JSON.stringify(resp.body).slice(0, 400));
            await helpers.waitForPostSave();
            const stored = await adminCount(request, 'mixed-put-foreign');
            console.log('PUT foreign persisted status', stored);
            if (!wildcard) {
                expect([200, 201]).not.toContain(resp.statusCode);
                expect(stored).toBe(404);
            }
        });

        test('(b2) PUT-create new Binary wholly foreign tenant (owner+access clientB)', async () => {
            const { request, helpers, personA } = await setup();
            const resp = await request
                .put('/4_0_0/Binary/mixed-put-clientb')
                .send(binary('mixed-put-clientb', [owner('clientB'), access('clientB')]))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            console.log('PUT clientB', scope, resp.statusCode, JSON.stringify(resp.body).slice(0, 300));
            await helpers.waitForPostSave();
            const stored = await adminCount(request, 'mixed-put-clientb');
            console.log('PUT clientB persisted status', stored);
            if (!wildcard) {
                expect(stored).toBe(404);
            }
        });

        test('(c) control: own tenant tag via $merge and PUT', async () => {
            const { request, helpers, personA } = await setup();
            const m = await request
                .post('/4_0_0/Binary/1/$merge?validate=true')
                .send(binary('mixed-merge-own', tagsFor('clientA')))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            const p = await request
                .put('/4_0_0/Binary/mixed-put-own')
                .send(binary('mixed-put-own', tagsFor('clientA')))
                .set(getHeadersWithCustomPayload(memberClaims(personA, scope)));
            console.log('CONTROL own', scope, 'merge', m.statusCode, JSON.stringify(m.body).slice(0, 300), 'put', p.statusCode, JSON.stringify(p.body).slice(0, 300));
            await helpers.waitForPostSave();
            console.log('CONTROL persisted', await adminCount(request, 'mixed-merge-own'), await adminCount(request, 'mixed-put-own'));
        });
    });
});
