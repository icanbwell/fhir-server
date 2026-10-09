// Patient-scoped Binary create and person-scoped Binary access.
//
// Design:    docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md  (section 14, test matrix)
// Plan:      docs/superpowers/plans/2026-10-08-binary-patient-scoped-write-plan.md
//
// Test ids (T1, T9, ...) refer to the matrix in the design. Cases that need infrastructure this suite does not
// set up (GraphQL, $everything/$graph, cloud storage, audit logging) remain `test.todo`.
const deepcopy = require('deepcopy');
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

const PERSON_TAG_SYSTEM = 'https://www.icanbwell.com/clientPersonId';
const OWNER_TAG = { system: 'https://www.icanbwell.com/owner', code: 'client1' };
const ACCESS_TAG = { system: 'https://www.icanbwell.com/access', code: 'client1' };
const personTag = (code) => ({ system: PERSON_TAG_SYSTEM, code });
// the server adds an `id` to every security tag it returns, so compare on system and code only
const personTagsOf = (security) => security
    .filter((s) => s.system === PERSON_TAG_SYSTEM)
    .map((s) => ({ system: s.system, code: s.code }));

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

const newBinary = (id, security = [OWNER_TAG, ACCESS_TAG]) => ({
    resourceType: 'Binary',
    id,
    meta: { source: 'https://example.com/member-uploads', security },
    contentType: 'application/pdf',
    data: 'JVBERi0xLjQK'
});

const claims = (personId, scope) => ({
    scope,
    username: `${personId}@example.com`,
    clientFhirPersonId: personId,
    clientFhirPatientId: `${personId}-patient`,
    bwellFhirPersonId: personId,
    bwellFhirPatientId: `${personId}-bwell-patient`,
    token_use: 'access'
});

// P: member token that can create a Binary
const memberWriter = (personId) => getHeadersWithCustomPayload(claims(personId, 'patient/Binary.write'));
// Pr: the mixed token clinical viewers use (patient + user + access)
const memberViewer = (personId) => getHeadersWithCustomPayload(
    claims(personId, 'access/*.* patient/*.* user/*.* admin/*.read')
);
// P-read: pure patient token with only a Binary read grant (no user/system scope, no access code)
const memberReader = (personId) => getHeadersWithCustomPayload(claims(personId, 'patient/Binary.read'));

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

    // seed a Binary with a system token ($merge), the way backends write them today
    const seed = async (request, binary) => {
        const resp = await request
            .post('/4_0_0/Binary/1/$merge?validate=true')
            .send(binary)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    };

    const securityOf = (resp) => (resp.body && resp.body.meta && resp.body.meta.security) || [];

    describe('create', () => {
        test('T1: a member creates a Binary with no tag; the server stamps the member\'s person id', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(201);
            expect(personTagsOf(securityOf(resp))).toEqual([personTag('person-A')]);
        });

        test('T2: a member supplying their own tag is accepted with exactly one tag', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored', [OWNER_TAG, ACCESS_TAG, personTag('person-A')]))
                .set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(201);
            expect(personTagsOf(securityOf(resp))).toEqual([personTag('person-A')]);
        });

        test('T3 / T42: another person\'s tag is rejected with 403 and a reason; the other id is not echoed', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored', [OWNER_TAG, ACCESS_TAG, personTag('person-B')]))
                .set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(403);
            expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
            const text = resp.body.issue[0].details.text;
            expect(text).toContain(PERSON_TAG_SYSTEM);
            expect(text).toContain('does not match');
            expect(text).not.toContain('person-B');
        });

        test('T3b: two person tags are rejected with 400', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored', [OWNER_TAG, ACCESS_TAG, personTag('person-A'), personTag('person-A')]))
                .set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(400);
        });

        test('T5: a member cannot update a Binary (PUT)', async () => {
            const request = await createRequest();
            const created = await request.post('/4_0_0/Binary').send(newBinary('ignored')).set(memberWriter('person-A'));
            expect(created).toHaveStatusCode(201);
            const resp = await request
                .put(`/4_0_0/Binary/${created.body.id}`)
                .send({ ...deepcopy(created.body), contentType: 'image/png' })
                .set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(403);
        });

        test('T7: a member cannot delete a Binary', async () => {
            const request = await createRequest();
            const created = await request.post('/4_0_0/Binary').send(newBinary('ignored')).set(memberWriter('person-A'));
            expect(created).toHaveStatusCode(201);
            const resp = await request.delete(`/4_0_0/Binary/${created.body.id}`).set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(403);
        });

        test('T8: a member cannot $merge a Binary', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary/1/$merge?validate=true')
                .send(newBinary('b-merge', [OWNER_TAG, ACCESS_TAG, personTag('person-A')]))
                .set(memberWriter('person-A'));
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
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(memberReader('person-A'));
            expect(resp).toHaveStatusCode(403);
        });

        test('T18: a system token writes a Binary with no tag and none is added', async () => {
            const request = await createRequest();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(getHeaders());
            expect(resp).toHaveStatusCode(201);
            expect(personTagsOf(securityOf(resp))).toEqual([]);
        });

        test('T31: with the flag off a member create is rejected exactly as today', async () => {
            const request = await createRequest({ flag: false });
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary('ignored'))
                .set(memberWriter('person-A'));
            expect(resp).toHaveStatusCode(403);
            expect(resp.body.issue[0].details.text).toContain(
                'Write not allowed using user scopes if patient scope is present'
            );
        });
    });

    describe('read', () => {
        // person A's tagged Binary, person B's tagged Binary, and one untagged (existing, clinical) Binary
        const seedThree = async (request) => {
            await seed(request, newBinary('binary-a', [OWNER_TAG, ACCESS_TAG, personTag('person-A')]));
            await seed(request, newBinary('binary-b', [OWNER_TAG, ACCESS_TAG, personTag('person-B')]));
            await seed(request, newBinary('binary-untagged'));
        };

        test('T19 / T20: a system token reads tagged and untagged Binary (no person filter)', async () => {
            const request = await createRequest();
            await seedThree(request);
            for (const id of ['binary-a', 'binary-b', 'binary-untagged']) {
                const resp = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders());
                expect(resp).toHaveStatusCode(200);
            }
        });

        test('T9: member A reads their own tagged Binary (mixed viewer token)', async () => {
            const request = await createRequest();
            await seedThree(request);
            const resp = await request.get('/4_0_0/Binary/binary-a').set(memberViewer('person-A'));
            expect(resp).toHaveStatusCode(200);
        });

        test('T10: member B cannot read member A\'s tagged Binary by id (mixed viewer token)', async () => {
            const request = await createRequest();
            await seedThree(request);
            const resp = await request.get('/4_0_0/Binary/binary-a').set(memberViewer('person-B'));
            expect(resp).toHaveStatusCode(404);
        });

        test('T11: member B\'s search does not return member A\'s Binary (mixed viewer token)', async () => {
            const request = await createRequest();
            await seedThree(request);
            const resp = await request.get('/4_0_0/Binary').set(memberViewer('person-B'));
            expect(resp).toHaveStatusCode(200);
            const ids = (resp.body.entry || []).map((e) => e.resource.id);
            expect(ids).toEqual(expect.arrayContaining(['binary-b', 'binary-untagged']));
            expect(ids).not.toContain('binary-a');
        });

        test('T17 / T41: an untagged Binary is readable by a mixed viewer token exactly as today', async () => {
            const request = await createRequest();
            await seedThree(request);
            for (const person of ['person-A', 'person-B']) {
                const resp = await request.get('/4_0_0/Binary/binary-untagged').set(memberViewer(person));
                expect(resp).toHaveStatusCode(200);
            }
        });

        test('T37: a pure patient token with patient/Binary.read reads its own tagged Binary', async () => {
            const request = await createRequest();
            await seedThree(request);
            const resp = await request.get('/4_0_0/Binary/binary-a').set(memberReader('person-A'));
            expect(resp).toHaveStatusCode(200);
        });

        test('T38: a pure patient token cannot read another member\'s tagged Binary (by id or search)', async () => {
            const request = await createRequest();
            await seedThree(request);
            const byId = await request.get('/4_0_0/Binary/binary-a').set(memberReader('person-B'));
            expect(byId).toHaveStatusCode(404);
            const search = await request.get('/4_0_0/Binary').set(memberReader('person-B'));
            expect(search).toHaveStatusCode(200);
            const ids = (search.body.entry || []).map((e) => e.resource.id);
            expect(ids).toEqual(['binary-b']);
        });

        test('T39: a pure patient token never sees an untagged Binary (no tenant filter exists for it)', async () => {
            const request = await createRequest();
            await seedThree(request);
            const byId = await request.get('/4_0_0/Binary/binary-untagged').set(memberReader('person-A'));
            expect(byId).toHaveStatusCode(404);
            const search = await request.get('/4_0_0/Binary').set(memberReader('person-A'));
            const ids = (search.body.entry || []).map((e) => e.resource.id);
            expect(ids).not.toContain('binary-untagged');
        });

        test('T40: a pure patient token without a Binary grant cannot read Binary', async () => {
            const request = await createRequest();
            await seedThree(request);
            const headers = getHeadersWithCustomPayload(claims('person-A', 'patient/Condition.read'));
            const resp = await request.get('/4_0_0/Binary/binary-a').set(headers);
            expect(resp).toHaveStatusCode(403);
        });

        test('T32: with the flag off there is no person filter and a pure patient token still cannot read Binary', async () => {
            const request = await createRequest({ flag: false });
            await seedThree(request);
            // viewer token: today's behavior, a tagged Binary of another person is readable in-tenant
            const viewer = await request.get('/4_0_0/Binary/binary-a').set(memberViewer('person-B'));
            expect(viewer).toHaveStatusCode(200);
            const reader = await request.get('/4_0_0/Binary/binary-a').set(memberReader('person-A'));
            expect(reader).toHaveStatusCode(403);
        });

        test('a member reads back the Binary they just created, another member cannot', async () => {
            const request = await createRequest();
            const created = await request.post('/4_0_0/Binary').send(newBinary('ignored')).set(memberWriter('person-A'));
            expect(created).toHaveStatusCode(201);
            const own = await request.get(`/4_0_0/Binary/${created.body.id}`).set(memberReader('person-A'));
            expect(own).toHaveStatusCode(200);
            const other = await request.get(`/4_0_0/Binary/${created.body.id}`).set(memberReader('person-B'));
            expect(other).toHaveStatusCode(404);
        });
    });

    describe('not covered here', () => {
        test.todo('T4: patient scope but no/empty person id (401 at auth; op-layer 403 is a unit test)');
        test.todo('T12: _history and _history/{vid} stay 403 for patient scopes (unchanged)');
        test.todo('T13: Patient/$everything and Person/$everything omit another member\'s tagged Binary');
        test.todo('T14: $graph DocumentReference -> Binary omits another member\'s tagged Binary');
        test.todo('T15: GraphQL DocumentReference -> attachment.resource returns the owner\'s Binary');
        test.todo('T16: GraphQL same query as another member returns resource: null');
        test.todo('T21: a system token for another tenant is still denied by the access-tag filter');
        test.todo('T22: mixed-scope create (patient grant required; system/* alone does not bypass) at the HTTP level (unit-tested in personTagScopes.test.js)');
        test.todo('T24: user/ + access/ tokens without a patient scope are unchanged');
        test.todo('T25: Binary read with format=text/plain (fhirResponseWriter) omits another member\'s tagged Binary (OQ-2)');
        test.todo('T26: cache short-circuit paths in $everything/$graph run after the filter (OQ-2)');
        test.todo('T30: cloud-storage offload on with a member Binary above the threshold keeps the tag on the stored doc and the history entry');
        test.todo('T33: an empty person id on read fails closed (unit-tested in securityTagManager.test.js)');
        test.todo('T34: query shape via toHaveMongoQuery (unit-tested in securityTagManager.test.js)');
        test.todo('T36: audit entry written once and stamping logged');
    });
});
