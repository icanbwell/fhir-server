// B-7: the Patient/$everything response cache must never serve one person's response to another person.
//
// Design: docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md (section 16.1)
//
// Person A and person B both link the same real Patient. A uploads a Binary (owned via securityContext =
// Patient/person.{A}, no patient reference) and a DocumentReference on the shared Patient points at it, so
// Patient/$everything for A includes it. The cache key is built from the Patient uuid + scope; without the
// caller's person id in the key, B would be served A's cached response, Binary included.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getHeadersWithCustomPayload,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');

const OWNER_TAG = { system: 'https://www.icanbwell.com/owner', code: 'client1' };
const ACCESS_TAG = { system: 'https://www.icanbwell.com/access', code: 'client1' };
const SHARED_PATIENT = 'shared-patient';
const SCOPE = 'patient/*.read access/*.read';

class CacheConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }

    get writeToCacheForEverythingOperation () {
        return true;
    }

    get readFromCacheForEverythingOperation () {
        return true;
    }
}

const meta = { source: 'https://example.com/test', security: [OWNER_TAG, ACCESS_TAG] };

const newPerson = (id) => ({
    resourceType: 'Person',
    id,
    birthDate: '1990-01-01',
    gender: 'male',
    meta,
    name: [{ family: id.toUpperCase(), given: ['TEST'], use: 'usual' }],
    link: [{ target: { reference: `Patient/${SHARED_PATIENT}`, type: 'Patient' }, assurance: 'level4' }]
});

const claims = (personUuid, scope) => ({
    scope,
    username: `${personUuid}@example.com`,
    clientFhirPersonId: personUuid,
    clientFhirPatientId: SHARED_PATIENT,
    bwellFhirPersonId: personUuid,
    bwellFhirPatientId: `${personUuid}-bwell-patient`,
    token_use: 'access'
});

const memberWriter = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, 'patient/Binary.write'));
const memberViewer = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, SCOPE));

describe('Binary with patient scope: $everything response cache', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const waitForPostSave = async () => {
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    };

    const merge = async (request, resourceType, body) => {
        const resp = await request
            .post(`/4_0_0/${resourceType}/1/$merge?validate=true`)
            .send(body)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await waitForPostSave();
        return resp.body.uuid;
    };

    const everythingBinaryIds = (resp) =>
        (resp.body.entry || []).filter((e) => e.resource.resourceType === 'Binary').map((e) => e.resource.id);

    test('person B is never served person A\'s cached $everything response containing A\'s Binary', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new CacheConfigManager());
            return c;
        });
        await merge(request, 'Patient', {
            resourceType: 'Patient',
            id: SHARED_PATIENT,
            meta,
            name: [{ family: 'SHARED' }]
        });
        const personA = await merge(request, 'Person', newPerson('person-a'));
        const personB = await merge(request, 'Person', newPerson('person-b'));

        // A uploads a Binary with a patient-scoped token; the server owns it as Patient/person.{A}
        const created = await request
            .post('/4_0_0/Binary')
            .send({
                resourceType: 'Binary',
                id: 'ignored',
                meta,
                contentType: 'application/pdf',
                data: 'JVBERi0xLjQK'
            })
            .set(memberWriter(personA));
        expect(created).toHaveStatusCode(201);
        const binaryId = created.body.id;
        expect(created.body.securityContext.reference).toStrictEqual(`Patient/person.${personA}`);
        await waitForPostSave();

        // a clinical DocumentReference on the shared Patient points at the Binary
        await merge(request, 'DocumentReference', {
            resourceType: 'DocumentReference',
            id: 'doc-1',
            meta,
            status: 'current',
            subject: { reference: `Patient/${SHARED_PATIENT}` },
            content: [{ attachment: { contentType: 'application/pdf', url: `Binary/${binaryId}` } }]
        });

        const url = `/4_0_0/Patient/${SHARED_PATIENT}/$everything`;

        const respA = await request.get(url).set(memberViewer(personA));
        expect(respA).toHaveStatusCode(200);
        expect(everythingBinaryIds(respA)).toContain(binaryId);
        await waitForPostSave();

        // the response must really have been written to the cache, otherwise this test proves nothing
        const cachedKeys = await getTestContainer().redisClient.getAllKeysByPrefix('Patient:');
        expect(cachedKeys.some((k) => k.includes(':Everything:') && !k.endsWith(':Generation'))).toBe(true);

        const respB = await request.get(url).set(memberViewer(personB));
        expect(respB).toHaveStatusCode(200);
        expect(everythingBinaryIds(respB)).not.toContain(binaryId);

        // A still gets their own (cached) response with the Binary
        const respA2 = await request.get(url).set(memberViewer(personA));
        expect(respA2).toHaveStatusCode(200);
        expect(everythingBinaryIds(respA2)).toContain(binaryId);
    });
});
