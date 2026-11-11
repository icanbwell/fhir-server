/**
 * The patient's `dataConnectionViewControl` Consent must hide the blocked resource on every
 * user-token read path:
 *   - GraphQL v1 (/$graphql)             - REST search (bundle and streaming)
 *   - REST read-by-id (404 as if missing) - GraphQL v2, $everything and /mcp
 * Every path loads the Consent once per request and fails the request when the caller's Person has
 * no owner tag. Only user tokens of clients listed in CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL are
 * affected. All data is synthetic.
 */
const { describe, beforeEach, afterEach, test, expect, jest: jestObj } = require('@jest/globals');
const { PatientDataViewControlManager } = require('../../../../utils/patientDataViewController');
const deepcopy = require('deepcopy');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    createTestRequest,
    getHeadersWithCustomPayload,
    getCustomGraphQLHeaders,
    getTestContainer
} = require('../../common');
const { callMcpTool, parseMcpRpcResponse } = require('../../mcp/mcpTestHelpers');

const fx = (p) => require(`./fixtures/${p}`);
const SEED = [
    'Person/topLevelPerson.json',
    'Person/person1.json',
    'Patient/patient1.json',
    'Patient/patient3.json',
    'CarePlan/carePlan.json',
    'CarePlan/carePlan2.json',
    'Procedure/procedure.json',
    'Condition/condition.json'
];
const PERSON_ID = '5f3ca115-8630-5e55-a97d-4d6ee26c0adc';
// uuid of CarePlan/care-plan-1 (the resource consent1.json blocks)
const BLOCKED_UUID = 'f49c5e15-81b5-57a9-bade-77e9e744fb2e';
// resource.id as returned by search / GraphQL is the source id
const BLOCKED = 'care-plan-1';
const UNBLOCKED = 'care-plan-2';
// GraphQL v2 returns uuids as resource ids
const UNBLOCKED_UUID = '98edd83a-bb70-547b-8f36-7f243658152f';
const CONSENT_ID = '6c599219-4242-5cad-89bb-80f7c0b4aa3f';

const USER_PAYLOAD = {
    scope: 'patient/*.* user/*.* access/*.*',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: PERSON_ID,
    clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access'
};
const userHeaders = () => getHeadersWithCustomPayload(USER_PAYLOAD);
const userGraphqlHeaders = () => getCustomGraphQLHeaders(USER_PAYLOAD);

/** consent blocking only the given references */
function consentBlocking(references) {
    const consent = deepcopy(fx('Consent/consent1.json'));
    consent.provision.data = references.map((reference, i) => ({
        id: `data-${i}`,
        meaning: 'instance',
        reference: { reference }
    }));
    return consent;
}

describe('dataConnectionViewControl Consent on REST search/read and GraphQL v1', () => {
    let savedEnrolled;
    let request;

    const merge = async (type, resource) => {
        const resp = await request.post(`/4_0_0/${type}/1/$merge`).send(resource).set(getHeaders());
        expect(resp.status).toBe(200);
    };
    // REST search answers with a bare array of resources unless _bundle=1 is passed
    const idsOf = (body) =>
        Array.isArray(body) ? body.map((r) => r.id) : (body.entry || []).map((e) => e.resource.id);
    const gqlV1 = (query, headers = userGraphqlHeaders()) =>
        request.post('/$graphql').send({ operationName: null, variables: {}, query }).set(headers);
    /** every value of an `id` key anywhere in a response body: the ids of the resources returned */
    const allIdValues = (body) => {
        const ids = [];
        const walk = (node) => {
            if (Array.isArray(node)) {
                node.forEach(walk);
            } else if (node && typeof node === 'object') {
                if (typeof node.id === 'string') {
                    ids.push(node.id);
                }
                Object.values(node).forEach(walk);
            }
        };
        walk(body);
        return ids;
    };
    const gqlV1Ids = (resp) => {
        expect(resp.body.errors).toBeUndefined();
        const field = Object.values(resp.body.data)[0];
        return (field.entry || []).map((e) => e.resource.id);
    };

    async function seed(consent = fx('Consent/consent1.json')) {
        request = await createTestRequest();
        for (const p of SEED) {
            await merge(p.split('/')[0], fx(p));
        }
        await merge('Consent', consent);
        const all = await request.get('/4_0_0/CarePlan').set(getHeaders());
        expect(idsOf(all.body).sort()).toEqual([BLOCKED, UNBLOCKED]);
    }

    beforeEach(async () => {
        savedEnrolled = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'healthsystem1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        if (savedEnrolled === undefined) {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        } else {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = savedEnrolled;
        }
        await commonAfterEach();
    });

    // Writes reject a resource without an owner tag, so this state only arises from data
    // written around the API; strip the tag in Mongo to reproduce it.
    const stripPersonOwnerTag = async () => {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const result = await db.collection('Person_4_0_0').updateOne(
            { _uuid: PERSON_ID },
            { $pull: { 'meta.security': { system: 'https://www.icanbwell.com/owner' } } }
        );
        expect(result.modifiedCount).toBe(1);
    };

    describe('enrolled client, user token', () => {
        beforeEach(async () => {
            await seed();
        });

        test.each([
            ['default (array) response', '/4_0_0/CarePlan'],
            ['bundle response', '/4_0_0/CarePlan?_bundle=1'],
            ['streaming response', '/4_0_0/CarePlan?_streamResponse=1']
        ])('REST search hides the blocked resource and keeps the unblocked one: %s', async (_name, url) => {
            const resp = await request.get(url).set(userHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body)).toEqual([UNBLOCKED]);
        });

        test('REST search by explicit _id still hides the blocked resource', async () => {
            const resp = await request
                .get(`/4_0_0/CarePlan?_id=${BLOCKED_UUID},${UNBLOCKED}`)
                .set(userHeaders());
            expect(idsOf(resp.body)).toEqual([UNBLOCKED]);
        });

        test('REST search keeps a caller-supplied _id:not next to the consent exclusion', async () => {
            const resp = await request
                .get(`/4_0_0/CarePlan?_id:not=${UNBLOCKED}`)
                .set(userHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body)).toEqual([]);
        });

        test('REST read-by-id of the blocked resource is a 404 identical to a missing resource', async () => {
            const blocked = await request.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(userHeaders());
            const missingId = '00000000-0000-4000-8000-000000000000';
            const missing = await request.get(`/4_0_0/CarePlan/${missingId}`).set(userHeaders());
            expect(blocked.status).toBe(404);
            expect(missing.status).toBe(404);
            const normalise = (body, id) => JSON.stringify(body).split(id).join('<id>');
            expect(normalise(blocked.body, BLOCKED_UUID)).toEqual(normalise(missing.body, missingId));
        });

        test('REST read-by-id of an unblocked resource is still 200', async () => {
            const resp = await request.get(`/4_0_0/CarePlan/${UNBLOCKED}`).set(userHeaders());
            expect(resp.status).toBe(200);
            expect(resp.body.id).toBe(UNBLOCKED);
        });

        test('GraphQL v1 query without arguments hides the blocked resource', async () => {
            const resp = await gqlV1('query { carePlan { entry { resource { id } } } }');
            expect(gqlV1Ids(resp)).toEqual([UNBLOCKED]);
        });

        test('GraphQL v1 query shaped like health-data-service (patient person proxy + _id) hides it', async () => {
            const query = `query {
                carePlan(patient: { value: "Patient/person.${PERSON_ID}" }) { entry { resource { id } } }
            }`;
            expect(gqlV1Ids(await gqlV1(query))).toEqual([UNBLOCKED]);

            const byIds = `query {
                carePlan(_id: { value: "${BLOCKED_UUID},${UNBLOCKED}" }) { entry { resource { id } } }
            }`;
            expect(gqlV1Ids(await gqlV1(byIds))).toEqual([UNBLOCKED]);
        });

        test('GraphQL v2 still hides it (regression guard)', async () => {
            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({ operationName: null, variables: {}, query: 'query { carePlans { entry { resource { id } } } }' })
                .set(userGraphqlHeaders());
            expect(gqlV1Ids(resp)).toEqual([UNBLOCKED_UUID]);
        });

        test('the Consent is loaded once per request, not once per resolver / query (no N+1)', async () => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync');
            try {
                const resp = await gqlV1(`query {
                    carePlan { entry { resource { id } } }
                    condition { entry { resource { id } } }
                    procedure { entry { resource { id } } }
                }`);
                expect(resp.body.errors).toBeUndefined();
                expect(spy).toHaveBeenCalledTimes(1);

                spy.mockClear();
                await request.get('/4_0_0/CarePlan').set(userHeaders());
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                spy.mockRestore();
            }
        });

        test.each([
            ['GraphQL v2 with several resolvers', (r) => r.post('/4_0_0/$graphqlv2').send({
                operationName: null,
                variables: {},
                query: `query {
                    carePlans { entry { resource { id } } }
                    conditions { entry { resource { id } } }
                    procedures { entry { resource { id } } }
                }`
            }).set(userGraphqlHeaders())],
            ['$everything', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders())]
        ])('the Consent is loaded once per request: %s', async (_name, send) => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync');
            try {
                const resp = await send(request);
                expect(resp.status).toBe(200);
                // the member's own Consent may come back and name the blocked CarePlan in its
                // provision; what must not come back is the blocked resource itself
                expect(allIdValues(resp.body)).not.toEqual(expect.arrayContaining([BLOCKED_UUID]));
                expect(allIdValues(resp.body)).not.toEqual(expect.arrayContaining([BLOCKED]));
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                spy.mockRestore();
            }
        });

        test.each([
            ['REST search', (r) => r.get('/4_0_0/CarePlan').set(userHeaders()),
                (resp) => expect(resp.status).toBeGreaterThanOrEqual(500)],
            ['GraphQL v1', () => gqlV1('query { carePlan { entry { resource { id } } } }'),
                (resp) => expect(resp.body.errors).toBeDefined()]
        ])('a failed Consent lookup fails the request and returns no data: %s', async (_name, send, assertFailed) => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync')
                .mockRejectedValue(new Error('consent store unavailable'));
            try {
                const resp = await send(request);
                assertFailed(resp);
                const body = String(resp.text);
                expect(body).not.toContain(BLOCKED);
                expect(body).not.toContain(UNBLOCKED);
                // the internal error message is not sent to the caller
                expect(body).not.toContain('consent store unavailable');
            } finally {
                spy.mockRestore();
            }
        });

        // _include/_revinclude are accepted but not implemented: no search returns included resources,
        // so they are not a path around the Consent. The service-token rows prove that (a service
        // token is not filtered, so it would get the included CarePlan if includes worked). If they
        // are ever implemented these rows fail, and the included resources need the view-control
        // filter too.
        describe('_include/_revinclude aimed at the blocked CarePlan', () => {
            beforeEach(async () => {
                const security = ['access', 'owner', 'sourceAssigningAuthority'].map((tag) => ({
                    system: `https://www.icanbwell.com/${tag}`,
                    code: 'healthsystem1'
                }));
                await merge('Procedure', {
                    resourceType: 'Procedure',
                    id: 'procedure-based-on-blocked',
                    meta: { source: 'healthsystem1', security },
                    status: 'completed',
                    subject: { reference: 'Patient/patient1' },
                    basedOn: [{ reference: `CarePlan/${BLOCKED}` }]
                });
            });

            const resourcesOf = (body) => (body.entry || []).map((e) => e.resource);
            test.each([
                ['_include', '/4_0_0/Procedure?_id=procedure-based-on-blocked&_include=Procedure:based-on&_bundle=1', 'Procedure'],
                ['_revinclude', '/4_0_0/Patient?_id=patient1&_revinclude=CarePlan:subject&_bundle=1', 'Patient']
            ])('%s returns no included resources at all, even for a service token', async (_name, url, primaryType) => {
                for (const headers of [getHeaders(), userHeaders()]) {
                    const resp = await request.get(url).set(headers);
                    expect(resp.status).toBe(200);
                    const resources = resourcesOf(resp.body);
                    expect(resources.length).toBeGreaterThan(0);
                    expect(resources.map((r) => r.resourceType)).toEqual(resources.map(() => primaryType));
                    expect(allIdValues(resp.body)).not.toEqual(expect.arrayContaining([BLOCKED]));
                    expect(allIdValues(resp.body)).not.toEqual(expect.arrayContaining([BLOCKED_UUID]));
                }
            });
        });

        test('resource types the Consent does not mention are unaffected', async () => {
            const resp = await request.get('/4_0_0/Condition').set(userHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body).length).toBeGreaterThan(0);
        });

        // The mutation's Patient lookup resolves the caller's linked patients without recording the
        // Person owner; the Practitioner lookup that follows applies view control in the same
        // request and must still find the owner.
        test('GraphQL v1 updateGeneralPractitioner succeeds after an earlier linked-patient lookup', async () => {
            await merge('Practitioner', fx('Practitioner/practitioner.json'));
            const resp = await gqlV1(`mutation {
                updateGeneralPractitioner(patientId: "patient1", practitionerId: "1679033641", remove: false) {
                    id
                    generalPractitioner { ... on Practitioner { id } }
                }
            }`);
            expect(resp.body.errors).toBeUndefined();
            expect(resp.body.data.updateGeneralPractitioner.generalPractitioner).toEqual([{ id: '1679033641' }]);
        });

        test('service token (no user) still sees the blocked resource everywhere', async () => {
            const search = await request.get('/4_0_0/CarePlan').set(getHeaders());
            expect(idsOf(search.body)).toContain(BLOCKED);
            const read = await request.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(getHeaders());
            expect(read.status).toBe(200);
            const gql = await gqlV1('query { carePlan { entry { resource { id } } } }', getCustomGraphQLHeaders({
                scope: 'user/*.* access/*.*', username: 'svc', client_id: 'svc', token_use: 'access'
            }));
            expect(gqlV1Ids(gql)).toContain(BLOCKED);
        });

        test('admin token still sees the blocked resource', async () => {
            const search = await request.get('/4_0_0/CarePlan').set(getHeadersWithAdmin());
            expect(idsOf(search.body)).toContain(BLOCKED);
            const read = await request.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(getHeadersWithAdmin());
            expect(read.status).toBe(200);
        });

        test('deleting the Consent makes the resource visible again on every path', async () => {
            const del = await request.delete(`/4_0_0/Consent/${CONSENT_ID}`).set(getHeaders());
            expect(del.status).toBe(204);

            const search = await request.get('/4_0_0/CarePlan').set(userHeaders());
            expect(idsOf(search.body).sort()).toEqual([BLOCKED, UNBLOCKED]);
            const read = await request.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(userHeaders());
            expect(read.status).toBe(200);
            const gql = await gqlV1('query { carePlan { entry { resource { id } } } }');
            expect(gqlV1Ids(gql)).toContain(BLOCKED);
        });

        // Documented behavior: the consent filter is NOT applied to history/version reads. Patient-scoped
        // user tokens are rejected on those endpoints anyway (403), so nothing leaks today; this pins
        // that so that if history is ever opened to user tokens the consent has to be wired in.
        test.each([
            ['history by id', `/4_0_0/CarePlan/${BLOCKED_UUID}/_history`],
            ['type-level history', '/4_0_0/CarePlan/_history'],
            ['version read', `/4_0_0/CarePlan/${BLOCKED_UUID}/_history/1`]
        ])('history not covered by the consent filter, rejected for user tokens: %s', async (_name, url) => {
            const resp = await request.get(url).set(userHeaders());
            expect(resp.status).toBe(403);
        });
    });

    describe('non-enrolled client', () => {
        test('user token of a client that is not enrolled still sees the blocked resource', async () => {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'some-other-client';
            await seed();
            const search = await request.get('/4_0_0/CarePlan').set(userHeaders());
            expect(idsOf(search.body)).toContain(BLOCKED);
            const read = await request.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(userHeaders());
            expect(read.status).toBe(200);
            const gql = await gqlV1('query { carePlan { entry { resource { id } } } }');
            expect(gqlV1Ids(gql)).toContain(BLOCKED);
        });

        test('feature switched off entirely (no enrolled clients) changes nothing', async () => {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
            await seed();
            const search = await request.get('/4_0_0/CarePlan').set(userHeaders());
            expect(idsOf(search.body)).toContain(BLOCKED);
        });
    });

    describe('Consent status', () => {
        // only an active view-control Consent hides data, as with the other Consent lookups; the
        // lookup filters on status so it can use the {status, patient._uuid} index
        test.each(['inactive', 'draft', 'rejected', 'entered-in-error'])(
            'a view-control Consent with status %s hides nothing', async (status) => {
                const consent = deepcopy(fx('Consent/consent1.json'));
                consent.status = status;
                await seed(consent);
                const search = await request.get('/4_0_0/CarePlan').set(userHeaders());
                expect(idsOf(search.body).sort()).toEqual([BLOCKED, UNBLOCKED]);
                const everything = await request.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders());
                expect(allIdValues(everything.body)).toContain(BLOCKED_UUID);
            }
        );
    });

    describe('caller Person has no owner tag', () => {
        const httpError = (resp) => expect(resp.status).toBeGreaterThanOrEqual(400);
        const graphqlError = (resp) => expect(resp.body.errors).toBeDefined();
        const mcpError = (resp) => expect(parseMcpRpcResponse(resp).result?.isError).toBe(true);
        // $everything streams the base Patient before the Consent lookup and reports a failed
        // lookup as an OperationOutcome entry rather than an HTTP error
        const everythingError = (resp) => expect(JSON.stringify(resp.body)).toContain('OperationOutcome');
        const userToken = () => userHeaders().Authorization.replace(/^Bearer /, '');

        test.each([
            ['REST search', (r) => r.get('/4_0_0/CarePlan').set(userHeaders()), httpError],
            ['REST streaming search', (r) => r.get('/4_0_0/CarePlan?_streamResponse=1').set(userHeaders()), httpError],
            ['REST read-by-id', (r) => r.get(`/4_0_0/CarePlan/${UNBLOCKED_UUID}`).set(userHeaders()), httpError],
            ['GraphQL v1', () => gqlV1('query { carePlan { entry { resource { id } } } }'), graphqlError],
            ['GraphQL v2', (r) => r.post('/4_0_0/$graphqlv2')
                .send({ operationName: null, variables: {}, query: 'query { carePlans { entry { resource { id } } } }' })
                .set(userGraphqlHeaders()), graphqlError],
            ['$everything', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders()), everythingError],
            ['/mcp', async (r) => (await callMcpTool(r, userToken(), 'search_care_plan', {})).resp, mcpError]
        ])('a user token of an enrolled deployment fails the request instead of returning data: %s', async (_name, send, assertFailed) => {
            await seed();
            await stripPersonOwnerTag();
            const resp = await send(request);
            // raw text, not resp.body: /mcp answers with text/event-stream, which supertest leaves
            // out of resp.body, so a body-only check would pass without looking at anything
            const body = String(resp.text);
            expect(body.length).toBeGreaterThan(0);
            // no CarePlan may come back, blocked or not: the request must not succeed
            expect(body).not.toContain(BLOCKED);
            expect(body).not.toContain(UNBLOCKED);
            expect(body).not.toContain(UNBLOCKED_UUID);
            assertFailed(resp);
        });

        test('a service token is unaffected', async () => {
            await seed();
            await stripPersonOwnerTag();
            const resp = await request.get('/4_0_0/CarePlan').set(getHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body).sort()).toEqual([BLOCKED, UNBLOCKED]);
        });

        test('a user token is unaffected when no client is enrolled', async () => {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
            await seed();
            await stripPersonOwnerTag();
            const resp = await request.get('/4_0_0/CarePlan').set(userHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body)).toContain(BLOCKED);
        });
    });

    // A member whose Person does not exist yet (e.g. a newly provisioned token) has no owner to decide
    // enrollment by and nothing for a Consent to hide, so reads behave as with view control off.
    describe('caller has no Person record', () => {
        const MISSING_PERSON_PAYLOAD = {
            ...USER_PAYLOAD,
            clientFhirPersonId: '0d6b1c1e-0000-5000-8000-000000000000',
            clientFhirPatientId: '0d6b1c1e-0000-5000-8000-000000000001'
        };
        const headers = () => getHeadersWithCustomPayload(MISSING_PERSON_PAYLOAD);
        const graphqlHeaders = () => getCustomGraphQLHeaders(MISSING_PERSON_PAYLOAD);
        const httpOk = (resp) => expect(resp.status).toBe(200);
        const graphqlOk = (resp) => {
            expect(resp.status).toBe(200);
            expect(resp.body.errors).toBeUndefined();
        };
        // a successful tool call leaves isError unset
        const mcpOk = (resp) => {
            const { result } = parseMcpRpcResponse(resp);
            expect(result).toBeDefined();
            expect(result.isError).not.toBe(true);
        };

        test.each([
            ['REST search', (r) => r.get('/4_0_0/CarePlan').set(headers()), httpOk],
            ['REST streaming search', (r) => r.get('/4_0_0/CarePlan?_streamResponse=1').set(headers()), httpOk],
            ['GraphQL v1', () => gqlV1('query { carePlan { entry { resource { id } } } }', graphqlHeaders()), graphqlOk],
            ['GraphQL v2', (r) => r.post('/4_0_0/$graphqlv2')
                .send({ operationName: null, variables: {}, query: 'query { carePlans { entry { resource { id } } } }' })
                .set(graphqlHeaders()), graphqlOk],
            ['/mcp', async (r) => (await callMcpTool(
                r, headers().Authorization.replace(/^Bearer /, ''), 'search_care_plan', {}
            )).resp, mcpOk]
        ])('a user token of an enrolled deployment gets an empty result, not an error: %s', async (_name, send, assertOk) => {
            await seed();
            const resp = await send(request);
            assertOk(resp);
            // the member is linked to no Patient, so no CarePlan is theirs to see
            const body = String(resp.text);
            expect(body).not.toContain(BLOCKED);
            expect(body).not.toContain(UNBLOCKED);
            expect(body).not.toContain(UNBLOCKED_UUID);
        });
    });

    // A service calling Person/{id}/$everything on a member's behalf can opt in to that Person's
    // view-control block. Without the opt-in, service tokens are unchanged.
    describe('service-token opt-in on Person $everything', () => {
        const OPT_IN = '_applyDataViewControl=true';
        // ids come back as uuids by default and as source ids when the caller's Prefer header doesn't
        // ask for global ids, so check both forms
        const has = (resp, uuid, sourceId) => {
            const ids = allIdValues(resp.body);
            return ids.includes(uuid) || ids.includes(sourceId);
        };
        const hasBlocked = (resp) => has(resp, BLOCKED_UUID, BLOCKED);
        const hasUnblocked = (resp) => has(resp, UNBLOCKED_UUID, UNBLOCKED);
        const personEverything = (query = '', headers = getHeaders()) =>
            request.get(`/4_0_0/Person/${PERSON_ID}/$everything${query ? `?${query}` : ''}`).set(headers);

        beforeEach(async () => {
            await seed();
        });

        test('without the opt-in, a service token still gets the blocked CarePlan', async () => {
            const resp = await personEverything();
            expect(resp.status).toBe(200);
            expect(hasBlocked(resp)).toBe(true);
            expect(hasUnblocked(resp)).toBe(true);
        });

        test('with the opt-in, the URL Person\'s block applies to a service token', async () => {
            const resp = await personEverything(OPT_IN);
            expect(resp.status).toBe(200);
            expect(hasUnblocked(resp)).toBe(true);
            expect(hasBlocked(resp)).toBe(false);
        });

        test('with the opt-in, a Person whose owner is not enrolled is unchanged', async () => {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'some-other-client';
            const resp = await personEverything(OPT_IN);
            expect(resp.status).toBe(200);
            expect(hasBlocked(resp)).toBe(true);
        });

        test('the Consent is loaded once for the request', async () => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync');
            try {
                const resp = await personEverything(OPT_IN);
                expect(resp.status).toBe(200);
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                spy.mockRestore();
            }
        });

        test('a Person the token cannot see and a Person that does not exist both get the same 404', async () => {
            const otherTenant = getHeaders('user/*.read access/othertenant.read');
            const hidden = await personEverything(OPT_IN, otherTenant);
            const missing = await request
                .get(`/4_0_0/Person/00000000-0000-5000-8000-000000000000/$everything?${OPT_IN}`)
                .set(otherTenant);
            expect(hidden.status).toBe(404);
            expect(missing.status).toBe(404);
            const issueTexts = (resp) => JSON.stringify(resp.body).replace(/[0-9a-f-]{36}/g, '<id>');
            expect(issueTexts(hidden)).toEqual(issueTexts(missing));
            expect(hasUnblocked(hidden)).toBe(false);
        });

        test('more than one Person id with the opt-in is a 400, checked before visibility', async () => {
            const resp = await request
                .get(`/4_0_0/Person/${PERSON_ID},00000000-0000-5000-8000-000000000000/$everything?${OPT_IN}`)
                .set(getHeaders('user/*.read access/othertenant.read'));
            expect(resp.status).toBe(400);
            expect(resp.body.resourceType).toBe('OperationOutcome');
            expect(JSON.stringify(resp.body.issue)).toContain('one Person per request');
        });

        test('a failed Consent lookup is an HTTP error with no data', async () => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync')
                .mockRejectedValue(new Error('consent store unavailable'));
            try {
                const resp = await personEverything(OPT_IN);
                expect(resp.status).toBeGreaterThanOrEqual(500);
                expect(hasUnblocked(resp)).toBe(false);
                expect(String(resp.text)).not.toContain('consent store unavailable');
            } finally {
                spy.mockRestore();
            }
        });

        test('with the opt-in, a Person with no owner tag fails the request', async () => {
            await stripPersonOwnerTag();
            const resp = await personEverything(OPT_IN);
            expect(resp.status).toBeGreaterThanOrEqual(500);
            expect(hasUnblocked(resp)).toBe(false);
        });

        test('the opt-in is accepted under strict search handling', async () => {
            const resp = await personEverything(OPT_IN, { ...getHeaders(), Prefer: 'handling=strict' });
            expect(resp.status).toBe(200);
            expect(hasUnblocked(resp)).toBe(true);
            expect(hasBlocked(resp)).toBe(false);
        });

        // decision made while building this: the opt-in is only defined for Person $everything, so
        // asking for it elsewhere is an error rather than silently returning unfiltered data
        test('the opt-in on Patient $everything is a 400', async () => {
            const resp = await request.get(`/4_0_0/Patient/patient1/$everything?${OPT_IN}`).set(getHeaders());
            expect(resp.status).toBe(400);
        });

        // decision made while building this: member tokens are always filtered, so the opt-in
        // changes nothing for them (and its single-Person rule doesn't apply)
        test('a member token is filtered with or without the opt-in', async () => {
            const resp = await personEverything(OPT_IN, userHeaders());
            expect(resp.status).toBe(200);
            expect(hasBlocked(resp)).toBe(false);
        });
    });

    describe('mixed uuid / sourceId exclusion lists', () => {
        // Consent blocks CarePlan/care-plan-1 (by uuid) and the caller additionally excludes
        // care-plan-2 by its non-uuid source id: the merged _id:not list mixes both id forms.
        const v2Query = (notEqualsValues) => `query {
            carePlans(id: { notEquals: { values: ${JSON.stringify(notEqualsValues)} } }) { entry { resource { id } } }
        }`;
        const postV2 = (query) =>
            request.post('/4_0_0/$graphqlv2').send({ operationName: null, variables: {}, query }).set(userGraphqlHeaders());

        test('REST search: consent uuid + caller source-id _id:not are both excluded', async () => {
            await seed();
            const resp = await request.get(`/4_0_0/CarePlan?_id:not=${UNBLOCKED}`).set(userHeaders());
            expect(idsOf(resp.body)).toEqual([]);
        });

        test('GraphQL v1: consent uuid + caller source-id exclusion are both excluded', async () => {
            await seed();
            const resp = await gqlV1(`query {
                carePlan(_id: { notEquals: { value: "${UNBLOCKED}" } }) { entry { resource { id } } }
            }`);
            expect(gqlV1Ids(resp)).toEqual([]);
        });

        // Evaluation of the comment in src/mcp/mcpToolHandler.js ("v2 still uses '$and' -- the same
        // bug"): graphqlv2/dataSource.js really does build the merged list with operator '$and'
        // (verified by logging parsedArgs), but ReferenceQueryRewriter, which runs next, rebuilds every
        // _id value as a comma-joined string and QueryParameterValue's constructor forces '$or' for a
        // multi-value string. So through the real pipeline the exclusion works; the '$and' is latent
        // (it would bite only if the rewriter were skipped). This test pins the observable behavior.
        test('GraphQL v2: consent uuid + caller source-id exclusion are both excluded', async () => {
            await seed();
            const resp = await postV2(v2Query([UNBLOCKED]));
            expect(resp.body.errors).toBeUndefined();
            expect(gqlV1Ids(resp)).toEqual([]);
        });
    });
});
