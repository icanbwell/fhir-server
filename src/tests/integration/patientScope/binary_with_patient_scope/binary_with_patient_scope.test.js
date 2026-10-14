// Patient-scoped Binary create and person-scoped Binary access.
//
// Design:    docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md  (section 14, test matrix)
// Plan:      docs/superpowers/plans/2026-10-08-binary-patient-scoped-write-plan.md
//
// A member's upload is owned through its securityContext, which the server sets from the token's person id to
// the person's proxy patient, `Patient/person.{person_uuid}`. Test ids (T1, T9, ...) refer to the matrix in the
// design. Cases that need other infrastructure (GraphQL, $everything/$graph, cloud storage, audit logging) live in
// the sibling files in this directory; see the index at the bottom of this file.
const deepcopy = require('deepcopy');
const { describe, beforeEach, afterEach, test, expect, jest: jestObj } = require('@jest/globals');
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
const metrics = require('../../../../utils/metrics');

const OWNER_TAG = { system: 'https://www.icanbwell.com/owner', code: 'client1' };
const ACCESS_TAG = { system: 'https://www.icanbwell.com/access', code: 'client1' };
const proxyOf = (personUuid) => ({ reference: `Patient/person.${personUuid}` });

// The test app (and so its configManager) is created once per test file, by the first createTestRequest call,
// so the flag has to be switchable at runtime rather than by registering a different config class per test.
let binaryFlagEnabled = true;

class BinaryConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return binaryFlagEnabled;
    }

    // searches must return a Bundle so the tests can read `entry`
    get enableReturnBundle () {
        return true;
    }
}

const newBinary = (id, securityContext) => ({
    resourceType: 'Binary',
    id,
    meta: { source: 'https://example.com/member-uploads', security: [OWNER_TAG, ACCESS_TAG] },
    contentType: 'application/pdf',
    data: 'JVBERi0xLjQK',
    ...(securityContext ? { securityContext } : {})
});

const newPerson = (id) => ({
    resourceType: 'Person',
    id,
    birthDate: '1990-01-01',
    gender: 'male',
    meta: { source: 'client', security: [{ system: 'https://www.icanbwell.com/access', code: 'client1' }, OWNER_TAG] },
    name: [{ family: id.toUpperCase(), given: ['TEST'], use: 'usual' }],
    link: [{ target: { reference: `Patient/${id}-patient`, type: 'Patient' }, assurance: 'level4' }]
});

const claims = (personUuid, scope) => ({
    scope,
    username: `${personUuid}@example.com`,
    clientFhirPersonId: personUuid,
    clientFhirPatientId: `${personUuid}-patient`,
    bwellFhirPersonId: personUuid,
    bwellFhirPatientId: `${personUuid}-bwell-patient`,
    token_use: 'access'
});

// P: member token that can create a Binary
const memberWriter = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, 'patient/Binary.write'));
// Pr: the mixed token clinical viewers use (patient + user + access)
const memberViewer = (personUuid) => getHeadersWithCustomPayload(
    claims(personUuid, 'access/*.* patient/*.* user/*.* admin/*.read')
);
// P-read: pure patient token with only a Binary read grant (no user/system scope, no access code)
const memberReader = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, 'patient/Binary.read'));

describe('Binary with patient scope', () => {
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

    const createRequest = async ({ flag = true } = {}) => {
        binaryFlagEnabled = flag;
        return createTestRequest((c) => {
            c.register('configManager', () => new BinaryConfigManager());
            return c;
        });
    };

    const waitForPostSave = async () => {
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    };

    // seed a Binary with a system token ($merge), the way backends write them today
    const seedBinary = async (request, binary) => {
        const resp = await request
            .post('/4_0_0/Binary/1/$merge?validate=true')
            .send(binary)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await waitForPostSave();
    };

    // seed a Person (linked to one Patient) and return the uuid the server assigned: that uuid is what a
    // member token carries as its clientFhirPersonId
    const seedPerson = async (request, id) => {
        const resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(newPerson(id))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await waitForPostSave();
        return resp.body.uuid;
    };

    describe('create', () => {
        test('T1: a member creates a Binary with no securityContext; the server sets the member\'s proxy patient', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const addSpy = jestObj.spyOn(metrics.binaryPatientCreateCounter, 'add');
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(memberWriter(personA));
            expect(resp).toHaveStatusCode(201);
            expect(resp.body.securityContext.reference).toStrictEqual(proxyOf(personA).reference);
            expect(addSpy).toHaveBeenCalledTimes(1);
            expect(addSpy).toHaveBeenCalledWith(1, { outcome: 'set' });
            addSpy.mockRestore();
        });

        test('T2: a member supplying their own proxy patient is accepted unchanged', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored', proxyOf(personA)))
                .set(memberWriter(personA));
            expect(resp).toHaveStatusCode(201);
            expect(resp.body.securityContext.reference).toStrictEqual(proxyOf(personA).reference);
        });

        test('T3 / T42: another person\'s securityContext is rejected with 403 and a reason; the other id is not echoed', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const personB = await seedPerson(request, 'person-b');
            const addSpy = jestObj.spyOn(metrics.binaryPatientCreateCounter, 'add');
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored', proxyOf(personB)))
                .set(memberWriter(personA));
            expect(resp).toHaveStatusCode(403);
            expect(addSpy).toHaveBeenCalledTimes(1);
            // bounded attributes only: no person or patient id
            expect(addSpy).toHaveBeenCalledWith(1, { outcome: 'rejected', reason: 'client_supplied_security_context' });
            addSpy.mockRestore();
            expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
            const text = resp.body.issue[0].details.text;
            expect(text).toContain('securityContext');
            expect(text).toContain('cannot be supplied by the client');
            expect(text).not.toContain(personB);
        });

        test('T3b: a member cannot point the securityContext at a real Patient or any other resource either', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            for (const reference of ['Patient/person-a-patient', 'Organization/org1']) {
                const resp = await request
                    .post('/4_0_0/Binary')
                    .send(newBinary('ignored', { reference }))
                    .set(memberWriter(personA));
                expect(resp).toHaveStatusCode(403);
            }
        });

        test('T5: a member cannot update a Binary (PUT)', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const created = await request.post('/4_0_0/Binary').send(newBinary('ignored')).set(memberWriter(personA));
            expect(created).toHaveStatusCode(201);
            const resp = await request
                .put(`/4_0_0/Binary/${created.body.id}`)
                .send({ ...deepcopy(created.body), contentType: 'image/png' })
                .set(memberWriter(personA));
            expect(resp).toHaveStatusCode(403);
        });

        test('T7: a member cannot delete a Binary', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const created = await request.post('/4_0_0/Binary').send(newBinary('ignored')).set(memberWriter(personA));
            expect(created).toHaveStatusCode(201);
            const resp = await request.delete(`/4_0_0/Binary/${created.body.id}`).set(memberWriter(personA));
            expect(resp).toHaveStatusCode(403);
        });

        test('T8: a member cannot $merge a Binary', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const resp = await request
                .post('/4_0_0/Binary/1/$merge?validate=true')
                .send(newBinary('b-merge', proxyOf(personA)))
                .set(memberWriter(personA));
            // $merge reports a per-resource result rather than failing the whole request
            expect(resp.body.created).toBe(false);
            expect(resp.body.updated).toBe(false);
            expect(resp.body.issue.code).toBe('forbidden');
            expect(resp.body.issue.details.text).toContain(
                'Write not allowed using user scopes if patient scope is present'
            );
        });

        test('T23: a member token with only patient/Binary.read cannot create a Binary', async () => {
            const request = await createRequest();
            const personA = await seedPerson(request, 'person-a');
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(memberReader(personA));
            expect(resp).toHaveStatusCode(403);
        });

        test('T18: a system token writes a Binary with no securityContext and none is added', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);
            expect(resp.body.securityContext).toBeUndefined();
        });

        test('T19a: a system token may set the securityContext to a real Patient or to a person proxy', async () => {
            const request = await createRequest();
            for (const reference of ['Patient/some-patient', 'Patient/person.00000000-0000-4000-8000-000000000001']) {
                const resp = await request
                    .post('/4_0_0/Binary')
                    .send(newBinary('ignored', { reference }))
                    .set(getHeaders());
                expect(resp).toHaveStatusCode(201);
                expect(resp.body.securityContext.reference).toStrictEqual(reference);
            }
        });

        test('T31: with the flag off a member create is rejected exactly as today', async () => {
            const request = await createRequest({ flag: false });
            const personA = await seedPerson(request, 'person-a');
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(memberWriter(personA));
            expect(resp).toHaveStatusCode(403);
            expect(resp.body.issue[0].details.text).toContain(
                'Write not allowed using user scopes if patient scope is present'
            );
        });
    });

    describe('read', () => {
        // person A's Binary, person B's Binary (both as the server stamps member uploads), a Binary owned by a
        // real patient linked to person A, and one existing untagged (clinical) Binary
        const seedAll = async (request) => {
            const personA = await seedPerson(request, 'person-a');
            const personB = await seedPerson(request, 'person-b');
            await seedBinary(request, newBinary('binary-a', proxyOf(personA)));
            await seedBinary(request, newBinary('binary-b', proxyOf(personB)));
            await seedBinary(request, newBinary('binary-untagged'));
            return { personA, personB };
        };

        test('T19 / T20: a system token reads owned and unowned Binary (no person filter)', async () => {
            const request = await createRequest();
            await seedAll(request);
            for (const id of ['binary-a', 'binary-b', 'binary-untagged']) {
                const resp = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders());
                expect(resp).toHaveStatusCode(200);
            }
        });

        test('T9: member A reads their own Binary (mixed viewer token)', async () => {
            const request = await createRequest();
            const { personA } = await seedAll(request);
            const resp = await request.get('/4_0_0/Binary/binary-a').set(memberViewer(personA));
            expect(resp).toHaveStatusCode(200);
        });

        test('T10: member B cannot read member A\'s Binary by id (mixed viewer token)', async () => {
            const request = await createRequest();
            const { personB } = await seedAll(request);
            const resp = await request.get('/4_0_0/Binary/binary-a').set(memberViewer(personB));
            expect(resp).toHaveStatusCode(404);
        });

        test('T11: member B\'s search does not return member A\'s Binary (mixed viewer token)', async () => {
            const request = await createRequest();
            const { personB } = await seedAll(request);
            const resp = await request.get('/4_0_0/Binary').set(memberViewer(personB));
            expect(resp).toHaveStatusCode(200);
            const ids = (resp.body.entry || []).map((e) => e.resource.id);
            expect(ids).toEqual(expect.arrayContaining(['binary-b', 'binary-untagged']));
            expect(ids).not.toContain('binary-a');
        });

        test('T17 / T41: an existing Binary with no securityContext is readable by a mixed viewer token exactly as today', async () => {
            const request = await createRequest();
            const { personA, personB } = await seedAll(request);
            for (const person of [personA, personB]) {
                const resp = await request.get('/4_0_0/Binary/binary-untagged').set(memberViewer(person));
                expect(resp).toHaveStatusCode(200);
            }
        });

        test('a Binary whose securityContext is a real patient linked to the caller is readable by that caller only', async () => {
            const request = await createRequest();
            const { personA, personB } = await seedAll(request);
            await seedBinary(request, newBinary('binary-patient-a', { reference: 'Patient/person-a-patient' }));
            const own = await request.get('/4_0_0/Binary/binary-patient-a').set(memberViewer(personA));
            expect(own).toHaveStatusCode(200);
            const other = await request.get('/4_0_0/Binary/binary-patient-a').set(memberViewer(personB));
            expect(other).toHaveStatusCode(404);
        });

        test('T37: a pure patient token with patient/Binary.read reads its own Binary', async () => {
            const request = await createRequest();
            const { personA } = await seedAll(request);
            const addSpy = jestObj.spyOn(metrics.binaryPersonFilterAppliedCounter, 'add');
            const resp = await request.get('/4_0_0/Binary/binary-a').set(memberReader(personA));
            expect(resp).toHaveStatusCode(200);
            expect(addSpy).toHaveBeenCalledWith(1, { mode: 'strict' });
            expect(addSpy).not.toHaveBeenCalledWith(1, { mode: 'mixed' });
            addSpy.mockRestore();
        });

        test('the person filter counter records mode=mixed for a mixed viewer token', async () => {
            const request = await createRequest();
            const { personA } = await seedAll(request);
            const addSpy = jestObj.spyOn(metrics.binaryPersonFilterAppliedCounter, 'add');
            const resp = await request.get('/4_0_0/Binary/binary-untagged').set(memberViewer(personA));
            expect(resp).toHaveStatusCode(200);
            expect(addSpy).toHaveBeenCalledWith(1, { mode: 'mixed' });
            addSpy.mockRestore();
        });

        test('T38: a pure patient token cannot read another member\'s Binary (by id or search)', async () => {
            const request = await createRequest();
            const { personB } = await seedAll(request);
            const byId = await request.get('/4_0_0/Binary/binary-a').set(memberReader(personB));
            expect(byId).toHaveStatusCode(404);
            const search = await request.get('/4_0_0/Binary').set(memberReader(personB));
            expect(search).toHaveStatusCode(200);
            const ids = (search.body.entry || []).map((e) => e.resource.id);
            expect(ids).toEqual(['binary-b']);
        });

        test('T39: a pure patient token never sees a Binary with no securityContext (no tenant filter exists for it)', async () => {
            const request = await createRequest();
            const { personA } = await seedAll(request);
            const byId = await request.get('/4_0_0/Binary/binary-untagged').set(memberReader(personA));
            expect(byId).toHaveStatusCode(404);
            const search = await request.get('/4_0_0/Binary').set(memberReader(personA));
            const ids = (search.body.entry || []).map((e) => e.resource.id);
            expect(ids).not.toContain('binary-untagged');
        });

        test('T40: a pure patient token without a Binary grant cannot read Binary', async () => {
            const request = await createRequest();
            const { personA } = await seedAll(request);
            const headers = getHeadersWithCustomPayload(claims(personA, 'patient/Condition.read'));
            const resp = await request.get('/4_0_0/Binary/binary-a').set(headers);
            expect(resp).toHaveStatusCode(403);
        });

        test('T32: with the flag off a pure patient token still cannot read Binary, and owned Binary stay filtered', async () => {
            const request = await createRequest({ flag: false });
            const { personA, personB } = await seedAll(request);
            // viewer token: the person filter is NOT gated on the flag, so another person's owned Binary is
            // hidden even with the flag off (see binary_flag_rollback.test.js); unowned Binary stay readable
            const viewer = await request.get('/4_0_0/Binary/binary-a').set(memberViewer(personB));
            expect(viewer).toHaveStatusCode(404);
            const unowned = await request.get('/4_0_0/Binary/binary-untagged').set(memberViewer(personB));
            expect(unowned).toHaveStatusCode(200);
            const reader = await request.get('/4_0_0/Binary/binary-a').set(memberReader(personA));
            expect(reader).toHaveStatusCode(403);
        });

        test('a member reads back the Binary they just created, another member cannot', async () => {
            const request = await createRequest();
            const { personA, personB } = await seedAll(request);
            const created = await request.post('/4_0_0/Binary').send(newBinary('ignored')).set(memberWriter(personA));
            expect(created).toHaveStatusCode(201);
            const own = await request.get(`/4_0_0/Binary/${created.body.id}`).set(memberReader(personA));
            expect(own).toHaveStatusCode(200);
            const other = await request.get(`/4_0_0/Binary/${created.body.id}`).set(memberReader(personB));
            expect(other).toHaveStatusCode(404);
        });
    });

    // Cases covered elsewhere (every id refers to the matrix in the design, section 14):
    //   T4   token without a person id: 401 at auth in binary_cross_member_matrix.test.js; the operation-layer 403 is
    //        unit-tested in src/tests/unit/operations/create/create.test.js (~L370)
    //   T12  _history and _history/{vid}: binary_cross_member_matrix.test.js
    //   T13  Patient/$everything and Person/$everything: binary_everything_graph.test.js (cache: binary_everything_cache.test.js)
    //   T14  $graph: binary_everything_graph.test.js
    //   T15 / T16  GraphQL v2 DocumentReference -> attachment.resource: binary_graphql.test.js (v1 has no such field)
    //   T21  another tenant's token: binary_cross_member_matrix.test.js
    //   T22  mixed-scope create: binary_cross_member_matrix.test.js (truth table: unit/operations/security/personContextScopes.test.js)
    //   T24  user/ + access/ tokens without a patient scope: binary_cross_member_matrix.test.js
    //   T25  _format=text/plain read: binary_cross_member_matrix.test.js
    //   T26  $everything cache: binary_everything_cache.test.js; $graph has no cache (asserted in binary_everything_graph.test.js)
    //   T30  cloud-storage offload: binary_cloud_storage.test.js
    //   T33  no patient ids on read fails closed: unit/operations/common/patientQueryCreator.test.js (~L124)
    //   T34  query shape: unit/operations/common/patientQueryCreator.test.js (~L78)
    //   T36  audit entry and stamping log: binary_audit.test.js
});
