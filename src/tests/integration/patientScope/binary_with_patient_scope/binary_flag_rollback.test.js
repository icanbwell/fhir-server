// Rollback safety: the person read filter on owned Binary is NOT gated on ENABLE_PATIENT_SCOPED_BINARY_CREATE.
//
// Design: docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md (section 16.3)
//
// Persons A and B both link the same real Patient. With the flag ON, A uploads a Binary (owned via
// securityContext = Patient/person.{A}) and a DocumentReference on the shared Patient points at it. The flag is
// then turned OFF (rollback, or another fhir-server deployment where it is not set). B's mixed token must still
// not see A's Binary; A, a system token and the strict-read denial behave as before.
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
const MIXED_SCOPE = 'patient/*.* user/*.* access/*.*';

// switchable at runtime: the app (and its configManager) is created once per test file
let binaryFlagEnabled = true;

class RollbackConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return binaryFlagEnabled;
    }

    get enableReturnBundle () {
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

const memberWriter = (p) => getHeadersWithCustomPayload(claims(p, 'patient/Binary.write'));
const mixed = (p) => getHeadersWithCustomPayload(claims(p, MIXED_SCOPE));
const strictReader = (p) => getHeadersWithCustomPayload(claims(p, 'patient/Binary.read'));

describe('Binary person filter survives the flag being turned off', () => {
    let requestId;

    beforeEach(async () => {
        binaryFlagEnabled = true;
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        binaryFlagEnabled = true;
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

    test('after rollback B cannot read A\'s Binary by id, search or $everything; A and system still can', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new RollbackConfigManager());
            return c;
        });
        await merge(request, 'Patient', { resourceType: 'Patient', id: SHARED_PATIENT, meta, name: [{ family: 'SHARED' }] });
        const personA = await merge(request, 'Person', newPerson('person-a'));
        const personB = await merge(request, 'Person', newPerson('person-b'));

        // flag ON: A uploads
        const created = await request
            .post('/4_0_0/Binary')
            .send({ resourceType: 'Binary', id: 'ignored', meta, contentType: 'application/pdf', data: 'JVBERi0xLjQK' })
            .set(memberWriter(personA));
        expect(created).toHaveStatusCode(201);
        const binaryId = created.body.id;
        expect(created.body.securityContext.reference).toStrictEqual(`Patient/person.${personA}`);
        await waitForPostSave();
        await merge(request, 'DocumentReference', {
            resourceType: 'DocumentReference',
            id: 'doc-1',
            meta,
            status: 'current',
            subject: { reference: `Patient/${SHARED_PATIENT}` },
            content: [{ attachment: { contentType: 'application/pdf', url: `Binary/${binaryId}` } }]
        });

        const onA = await request.get(`/4_0_0/Patient/${SHARED_PATIENT}/$everything`).set(mixed(personA));
        expect(everythingBinaryIds(onA)).toContain(binaryId);

        // flag OFF (rollback / deployment without the flag)
        binaryFlagEnabled = false;

        // B (mixed token, in-tenant access tag) is still filtered out
        const byId = await request.get(`/4_0_0/Binary/${binaryId}`).set(mixed(personB));
        expect(byId).toHaveStatusCode(404);
        const search = await request.get('/4_0_0/Binary').set(mixed(personB));
        expect(search).toHaveStatusCode(200);
        expect((search.body.entry || []).map((e) => e.resource.id)).not.toContain(binaryId);
        const patientEverything = await request.get(`/4_0_0/Patient/${SHARED_PATIENT}/$everything`).set(mixed(personB));
        expect(patientEverything).toHaveStatusCode(200);
        expect(everythingBinaryIds(patientEverything)).not.toContain(binaryId);
        const personEverything = await request.get(`/4_0_0/Person/${personB}/$everything`).set(mixed(personB));
        expect(personEverything).toHaveStatusCode(200);
        expect(everythingBinaryIds(personEverything)).not.toContain(binaryId);

        // A still reads its own Binary
        const own = await request.get(`/4_0_0/Binary/${binaryId}`).set(mixed(personA));
        expect(own).toHaveStatusCode(200);
        const ownEverything = await request.get(`/4_0_0/Patient/${SHARED_PATIENT}/$everything`).set(mixed(personA));
        expect(everythingBinaryIds(ownEverything)).toContain(binaryId);

        // a system token (no patient scope) is unchanged
        const system = await request.get(`/4_0_0/Binary/${binaryId}`).set(getHeaders());
        expect(system).toHaveStatusCode(200);

        // strict (pure patient) read authorization stays flag-gated: still 403, for the owner too
        const strictB = await request.get(`/4_0_0/Binary/${binaryId}`).set(strictReader(personB));
        expect(strictB).toHaveStatusCode(403);
        const strictA = await request.get(`/4_0_0/Binary/${binaryId}`).set(strictReader(personA));
        expect(strictA).toHaveStatusCode(403);
    });
});
