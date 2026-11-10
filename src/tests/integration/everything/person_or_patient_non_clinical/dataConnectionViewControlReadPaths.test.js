/**
 * TIP-8113: the patient's `dataConnectionViewControl` Consent must hide the blocked resource on
 * every user-token read path, not only $everything / GraphQL v2 / MCP:
 *   - GraphQL v1 (/$graphql)             - REST search (bundle and streaming)
 *   - REST read-by-id (404 as if missing) - GraphQL v2 (regression guard)
 * Only user tokens of clients listed in CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL are affected.
 * All data is synthetic.
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

        test('resource types the Consent does not mention are unaffected', async () => {
            const resp = await request.get('/4_0_0/Condition').set(userHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body).length).toBeGreaterThan(0);
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

    describe('caller Person has no owner tag', () => {
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
