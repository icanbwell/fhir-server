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
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');
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

const { PERSON_ID, USER_PAYLOAD, userHeaders, userGraphqlHeaders } = require('./viewControlUserFixtures');

const fx = (p) => require(`./fixtures/${p}`);
// enables delegated-access detection for the delegated actor tests
class DelegatedAccessConfigManager extends ConfigManager {
    get enableDelegatedAccessDetection() {
        return true;
    }
}
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
// uuid of CarePlan/care-plan-1 (the resource consent1.json blocks)
const BLOCKED_UUID = 'f49c5e15-81b5-57a9-bade-77e9e744fb2e';
// resource.id as returned by search / GraphQL is the source id
const BLOCKED = 'care-plan-1';
const UNBLOCKED = 'care-plan-2';
// GraphQL v2 returns uuids as resource ids
const UNBLOCKED_UUID = '98edd83a-bb70-547b-8f36-7f243658152f';
const CONSENT_ID = '6c599219-4242-5cad-89bb-80f7c0b4aa3f';


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
                // the user's own Consent may come back and name the blocked CarePlan in its
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
            // the stream has started when the lookup fails, so the status is already 200: the failure
            // shows as an error OperationOutcome entry and no CarePlan is sent
            ['live $everything', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders()),
                (resp) => {
                    const outcomes = (resp.body.entry || [])
                        .map((e) => e.resource)
                        .filter((r) => r?.resourceType === 'OperationOutcome');
                    expect(outcomes).toHaveLength(1);
                    expect(outcomes[0].issue[0].severity).toBe('error');
                    expect(allIdValues(resp.body)).not.toContain(BLOCKED_UUID);
                    expect(allIdValues(resp.body)).not.toContain(UNBLOCKED_UUID);
                }],
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

    // GraphQL v1 mutations look up the resource they change; that lookup must not find what the
    // user's Consent hides, or the mutation would change it and return it.
    describe('GraphQL v1 mutation on a resource the Consent hides', () => {
        const UPDATE_GP = `mutation {
            updateGeneralPractitioner(patientId: "patient1", practitionerId: "1679033641", remove: false) {
                id
                generalPractitioner { ... on Practitioner { id } }
            }
        }`;

        test('updateGeneralPractitioner does not find, change or return the hidden Patient', async () => {
            await seed(consentBlocking(['Patient/patient1']));
            await merge('Practitioner', fx('Practitioner/practitioner.json'));

            const resp = await gqlV1(UPDATE_GP);

            expect(resp.body.errors?.[0]?.message).toBe('Patient not found patient1');
            expect(resp.body.data?.updateGeneralPractitioner ?? null).toBeNull();
            const patient = await request.get('/4_0_0/Patient/patient1').set(getHeaders());
            expect(patient.status).toBe(200);
            expect(patient.body.generalPractitioner).toBeUndefined();
        });

        test('updateGeneralPractitioner still changes a Patient the Consent does not hide', async () => {
            await seed(consentBlocking([`CarePlan/${BLOCKED_UUID}`]));
            await merge('Practitioner', fx('Practitioner/practitioner.json'));

            const resp = await gqlV1(UPDATE_GP);

            expect(resp.body.errors).toBeUndefined();
            expect(resp.body.data.updateGeneralPractitioner.generalPractitioner).toEqual([{ id: '1679033641' }]);
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
        const userToken = () => userHeaders().Authorization.replace(/^Bearer /, '');

        // A Person without an owner tag (bad data) can't be shown to be outside the enrolled clients,
        // so it is treated as enrolled: the user's Consent is applied and the read still succeeds.
        // by default the blocked CarePlan must not appear anywhere in the raw text. Two paths differ: a
        // 404 names the id that was asked for, and $everything returns the user's own Consent, which
        // names the blocked resource, so those two check the returned resources' ids instead.
        const noBlockedText = (resp) => {
            expect(String(resp.text)).not.toContain(BLOCKED);
            expect(String(resp.text)).not.toContain(BLOCKED_UUID);
        };
        test.each([
            ['REST search', (r) => r.get('/4_0_0/CarePlan').set(userHeaders()), noBlockedText],
            ['REST streaming search', (r) => r.get('/4_0_0/CarePlan?_streamResponse=1').set(userHeaders()), noBlockedText],
            ['REST read-by-id of a blocked resource',
                (r) => r.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(userHeaders()),
                (resp) => expect(resp.status).toBe(404)],
            ['GraphQL v1', () => gqlV1('query { carePlan { entry { resource { id } } } }'), noBlockedText],
            ['GraphQL v2', (r) => r.post('/4_0_0/$graphqlv2')
                .send({ operationName: null, variables: {}, query: 'query { carePlans { entry { resource { id } } } }' })
                .set(userGraphqlHeaders()), noBlockedText],
            ['$everything', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders()),
                (resp) => {
                    expect(allIdValues(resp.body)).not.toContain(BLOCKED_UUID);
                    expect(allIdValues(resp.body)).toContain(UNBLOCKED_UUID);
                }],
            ['/mcp', async (r) => (await callMcpTool(r, userToken(), 'search_care_plan', {})).resp, noBlockedText]
        ])('a user token of an enrolled deployment is filtered, not failed: %s', async (_name, send, assertFiltered) => {
            await seed();
            await stripPersonOwnerTag();
            const resp = await send(request);
            // raw text, not resp.body: /mcp answers with text/event-stream, which supertest leaves
            // out of resp.body, so a body-only check would pass without looking at anything
            expect(String(resp.text).length).toBeGreaterThan(0);
            expect(resp.status).toBeLessThan(500);
            assertFiltered(resp);
        });

        test('REST search still returns the unblocked CarePlan', async () => {
            await seed();
            await stripPersonOwnerTag();
            const resp = await request.get('/4_0_0/CarePlan').set(userHeaders());
            expect(resp.status).toBe(200);
            expect(idsOf(resp.body)).toContain(UNBLOCKED);
            expect(idsOf(resp.body)).not.toContain(BLOCKED);
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

    // A user whose Person does not exist yet (e.g. a newly provisioned token) has no owner to decide
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
            // the user is linked to no Patient, so no CarePlan is theirs to see
            const body = String(resp.text);
            expect(body).not.toContain(BLOCKED);
            expect(body).not.toContain(UNBLOCKED);
            expect(body).not.toContain(UNBLOCKED_UUID);
        });
    });

    describe('caller has no Person record but an active Consent names that Person', () => {
        const MISSING_PERSON_ID = '0d6b1c1e-0000-5000-8000-000000000000';
        const headers = () => getHeadersWithCustomPayload({
            ...USER_PAYLOAD,
            clientFhirPersonId: MISSING_PERSON_ID,
            clientFhirPatientId: '0d6b1c1e-0000-5000-8000-000000000001'
        });

        // Pins today's behavior: the lookup does not search the Consent for a Person it cannot find, and
        // with default config the user's patient scope holds only the proxy id, so nothing is returned.
        test('REST search returns nothing and runs no Consent search', async () => {
            const consent = consentBlocking([`CarePlan/${BLOCKED_UUID}`]);
            consent.patient = { reference: `Patient/person.${MISSING_PERSON_ID}` };
            consent.id = '0d6b1c1e-0000-5000-8000-000000000002';
            await seed();
            await merge('Consent', consent);
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync');
            try {
                const resp = await request.get('/4_0_0/CarePlan').set(headers());
                expect(resp.status).toBe(200);
                expect(idsOf(resp.body)).toEqual([]);
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('delegated actor reading for an enrolled owner', () => {
        // test databases have no custom indexes, so the delegated-access Consent query's index hint fails
        let hintSpy;
        beforeEach(() => {
            hintSpy = jestObj.spyOn(DatabaseCursor.prototype, 'hint').mockReturnThis();
        });
        afterEach(() => {
            hintSpy.mockRestore();
        });
        const delegatedHeaders = () => getHeadersWithCustomPayload({
            ...USER_PAYLOAD,
            scope: 'patient/*.read access/*.read',
            act: { reference: 'RelatedPerson/rp-actor-a', sub: 'actor-a-sub' }
        });

        // The Consent lookup runs as a system read: it must not apply the delegated-access filter, which
        // would narrow what the lookup can find.
        test.each([
            ['default (array) response', '/4_0_0/CarePlan'],
            ['bundle response', '/4_0_0/CarePlan?_bundle=1'],
            ['streaming response', '/4_0_0/CarePlan?_streamResponse=1']
        ])('REST search hides the blocked resource and keeps the unblocked one: %s', async (_name, url) => {
            request = await createTestRequest((c) => {
                c.register('configManager', () => new DelegatedAccessConfigManager());
                return c;
            });
            for (const p of SEED) {
                await merge(p.split('/')[0], fx(p));
            }
            await merge('Consent', fx('Consent/consent1.json'));
            await merge('Consent', fx('Consent/consentDelegatedActor.json'));

            const resp = await request.get(url).set(delegatedHeaders());

            expect(resp.status).toBe(200);
            expect(idsOf(resp.body)).toEqual([UNBLOCKED]);
        });
    });

    describe('delegated Organization actor reading for an enrolled owner', () => {
        const CONNECTION_TYPE_SYSTEM = 'https://www.icanbwell.com/connectionType';
        const CONNECTION_TYPE = 'treatment';
        const ORG_ID = '1f0e9d8c-7b6a-4954-8321-0fedcba98765';
        const ENTITLEMENT_CONSENT_ID = '6c2f4a1e-3b5d-5e7f-9a1b-2c3d4e5f6a7b';
        let savedAllowedOperations;

        // Org-level grant named in the token's entitlements: it has no `patient`, and its connectionType
        // label is what narrows an Organization actor to resources tagged with that connection type.
        const entitlementConsent = () => ({
            resourceType: 'Consent',
            id: ENTITLEMENT_CONSENT_ID,
            meta: {
                source: 'test',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' }
                ]
            },
            status: 'active',
            scope: {
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'treatment' }]
            },
            category: [
                { coding: [{ system: 'http://www.icanbwell.com/consent-category', code: 'dataSharing' }] }
            ],
            performer: [{ reference: `Organization/${ORG_ID}` }],
            provision: {
                type: 'permit',
                period: { start: '2025-01-01T00:00:00.000Z' },
                actor: [
                    {
                        role: {
                            coding: [
                                {
                                    system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                                    code: 'IRCP'
                                }
                            ]
                        },
                        reference: { reference: `Organization/${ORG_ID}` }
                    }
                ],
                purpose: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }],
                securityLabel: [{ system: CONNECTION_TYPE_SYSTEM, code: CONNECTION_TYPE }]
            }
        });
        const orgActorHeaders = () =>
            getHeadersWithCustomPayload({
                ...USER_PAYLOAD,
                scope: 'patient/*.read access/*.read',
                act: { reference: `Organization/${ORG_ID}`, sub: 'org-actor-sub' },
                entitlements: [`Consent/${ENTITLEMENT_CONSENT_ID}`]
            });
        // the care plans carry the connection type, so only the view-control Consent can hide one
        const withConnectionType = (carePlan) => {
            const tagged = deepcopy(carePlan);
            tagged.meta.security.push({ system: CONNECTION_TYPE_SYSTEM, code: CONNECTION_TYPE });
            return tagged;
        };

        beforeEach(() => {
            savedAllowedOperations = process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS;
            process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS = 'CarePlan:search';
        });
        afterEach(() => {
            if (savedAllowedOperations === undefined) {
                delete process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS;
            } else {
                process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS = savedAllowedOperations;
            }
        });

        // The view-control Consent has no connectionType tag. If the lookup ran under the Organization
        // actor's connection-type narrowing it would not find that Consent, and the blocked resource
        // would be returned. The non-enrolled row shows the care plans do pass the narrowing, so the
        // enrolled row hides the blocked one only because the Consent was found.
        test.each([
            ['enrolled client hides the blocked resource', 'healthsystem1', [UNBLOCKED]],
            ['non-enrolled client sees both resources', 'some-other-client', [BLOCKED, UNBLOCKED].sort()]
        ])('REST search: %s', async (_name, enrolledClients, expectedIds) => {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = enrolledClients;
            request = await createTestRequest((c) => {
                c.register('configManager', () => new DelegatedAccessConfigManager());
                return c;
            });
            for (const p of SEED) {
                const resource = p.startsWith('CarePlan/') ? withConnectionType(fx(p)) : fx(p);
                await merge(p.split('/')[0], resource);
            }
            await merge('Consent', fx('Consent/consent1.json'));
            await merge('Consent', entitlementConsent());

            const resp = await request.get('/4_0_0/CarePlan?_bundle=1').set(orgActorHeaders());

            expect(resp.status).toBe(200);
            expect(idsOf(resp.body).sort()).toEqual(expectedIds);
        });

        // The Consent hides DocumentReference doc-ref-1 (attachment Binary/binary1) and Binary binary2. The
        // DocumentReference has no connectionType tag, so if the read that finds it ran under the
        // Organization actor's connection-type narrowing it would not be found, and binary1 would be
        // returned. The Binaries carry the connection type, so the non-enrolled row shows they pass the
        // narrowing, and the enrolled row hides them only because the hidden DocumentReference was found.
        test.each([
            ['enrolled client hides the Binary of the hidden DocumentReference', 'healthsystem1', []],
            ['non-enrolled client sees both Binaries', 'some-other-client', ['binary1', 'binary2']]
        ])('REST Binary search: %s', async (_name, enrolledClients, expectedIds) => {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = enrolledClients;
            process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS = 'Binary:search';
            request = await createTestRequest((c) => {
                c.register('configManager', () => new DelegatedAccessConfigManager());
                return c;
            });
            for (const p of [
                'Person/topLevelPerson.json',
                'Person/person1.json',
                'Patient/patient1.json',
                'DocumentReference/documentReference1.json'
            ]) {
                await merge(p.split('/')[0], fx(p));
            }
            for (const p of ['Binary/binary1.json', 'Binary/binary2.json']) {
                await merge('Binary', withConnectionType(fx(p)));
            }
            await merge('Consent', fx('Consent/consent1.json'));
            await merge('Consent', entitlementConsent());

            const resp = await request.get('/4_0_0/Binary?_bundle=1').set(orgActorHeaders());

            expect(resp.status).toBe(200);
            expect(idsOf(resp.body).sort()).toEqual(expectedIds);
        });
    });

    // $summary is built on the same graph as $graph, so both are covered by the filter on the graph's
    // link queries: the start resource, a reverse link and a forward link.
    describe('$graph and $summary', () => {
        const PATIENT_UUID = '24a5930e-11b4-5525-b482-669174917044';
        const graphDefinition = (start, link) => ({
            resourceType: 'GraphDefinition', id: 'g', name: 'g', status: 'active', start, link
        });
        const reverseCarePlanGraph = graphDefinition('Patient', [
            { target: [{ type: 'CarePlan', params: 'patient={ref}' }] }
        ]);
        const forwardPatientGraph = graphDefinition('CarePlan', [
            { path: 'subject', target: [{ type: 'Patient' }] }
        ]);
        const postGraph = (r, url, body, headers) => r.post(url).set(headers).send(body);
        // $graph answers with source ids and $summary with uuids, so a resource counts as returned
        // under either
        const carePlanIds = (resp) => allIdValues(resp.body).filter((id) => [
            BLOCKED, UNBLOCKED, BLOCKED_UUID, UNBLOCKED_UUID
        ].includes(id));
        const returns = (resp, ...ids) => ids.some((id) => allIdValues(resp.body).includes(id));

        test.each([
            ['$graph reverse link', (r, h) => postGraph(r, `/4_0_0/Patient/${PATIENT_UUID}/$graph`, reverseCarePlanGraph, h)],
            ['$summary', (r, h) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$summary`).set(h)]
        ])('%s hides the blocked CarePlan from a user token but not from a service token', async (_name, send) => {
            await seed();

            const user = await send(request, userHeaders());
            expect(user.status).toBe(200);
            expect(returns(user, BLOCKED, BLOCKED_UUID)).toBe(false);
            expect(returns(user, UNBLOCKED, UNBLOCKED_UUID)).toBe(true);

            const service = await send(request, getHeaders());
            expect(service.status).toBe(200);
            expect(returns(service, BLOCKED, BLOCKED_UUID)).toBe(true);
        });

        test('$graph started on the blocked CarePlan returns nothing to a user token', async () => {
            await seed();
            const simple = graphDefinition('CarePlan', [{ path: 'subject', target: [{ type: 'Patient' }] }]);
            const user = await postGraph(request, `/4_0_0/CarePlan/${BLOCKED_UUID}/$graph`, simple, userHeaders());
            expect(returns(user, BLOCKED, BLOCKED_UUID)).toBe(false);

            const service = await postGraph(request, `/4_0_0/CarePlan/${BLOCKED_UUID}/$graph`, simple, getHeaders());
            expect(returns(service, BLOCKED, BLOCKED_UUID)).toBe(true);
        });

        test('$graph forward link does not return a Patient the Consent hides', async () => {
            await seed(consentBlocking([`Patient/${PATIENT_UUID}`]));
            const user = await postGraph(request, `/4_0_0/CarePlan/${UNBLOCKED_UUID}/$graph`, forwardPatientGraph, userHeaders());
            expect(returns(user, 'patient1', PATIENT_UUID)).toBe(false);

            const service = await postGraph(request, `/4_0_0/CarePlan/${UNBLOCKED_UUID}/$graph`, forwardPatientGraph, getHeaders());
            expect(returns(service, 'patient1', PATIENT_UUID)).toBe(true);
        });

        test.each([
            ['$graph', (r) => postGraph(r, `/4_0_0/Patient/${PATIENT_UUID}/$graph`, reverseCarePlanGraph, userHeaders())],
            ['$summary', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$summary`).set(userHeaders())]
        ])('a failed Consent lookup returns no data: %s', async (_name, send) => {
            await seed();
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync')
                .mockRejectedValue(new Error('consent store unavailable'));
            try {
                const resp = await send(request);
                expect(carePlanIds(resp)).toEqual([]);
                expect(String(resp.text)).not.toContain('consent store unavailable');
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('saving a Consent invalidates the cached $summary', () => {
        const CACHE_ENV = [
            'ENABLE_REDIS',
            'ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION',
            'ENABLE_REDIS_CACHE_READ_FOR_SUMMARY_OPERATION'
        ];
        let savedCacheEnv;
        beforeEach(() => {
            savedCacheEnv = CACHE_ENV.map((name) => process.env[name]);
            CACHE_ENV.forEach((name) => { process.env[name] = '1'; });
        });
        afterEach(() => {
            CACHE_ENV.forEach((name, i) => {
                if (savedCacheEnv[i] === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = savedCacheEnv[i];
                }
            });
        });

        test('the next read is rebuilt under the new Consent', async () => {
            await seed();
            const summary = () => request.get(`/4_0_0/Patient/person.${PERSON_ID}/$summary`).set(userHeaders());
            const returns = (resp, ...ids) => ids.some((id) => allIdValues(resp.body).includes(id));

            const miss = await summary();
            expect(miss.headers).toHaveProperty('x-cache', 'Miss');
            expect(returns(miss, BLOCKED, BLOCKED_UUID)).toBe(false);
            expect(returns(miss, UNBLOCKED, UNBLOCKED_UUID)).toBe(true);
            expect((await summary()).headers).toHaveProperty('x-cache', 'Hit');

            // the Consent now hides the other CarePlan instead; a PUT replaces provision.data, where
            // $merge would add to it
            const changed = consentBlocking([`CarePlan/${UNBLOCKED_UUID}`]);
            const put = await request.put(`/4_0_0/Consent/${changed.id}`).send(changed).set(getHeaders());
            expect(put.status).toBeLessThan(300);

            // the invalidation runs after the response is sent: poll until the cache is rebuilt
            let rebuilt;
            for (let attempt = 0; attempt < 50; attempt++) {
                rebuilt = await summary();
                if (rebuilt.headers['x-cache'] === 'Miss') {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            expect(rebuilt.headers).toHaveProperty('x-cache', 'Miss');
            expect(returns(rebuilt, BLOCKED, BLOCKED_UUID)).toBe(true);
            expect(returns(rebuilt, UNBLOCKED, UNBLOCKED_UUID)).toBe(false);
        });

        // e.g. the generation bump after a Consent save failed, so the stale entry is still served
        test('a cache hit drops resources the Consent now hides, even if they were cached', async () => {
            await seed();
            const summary = () => request.get(`/4_0_0/Patient/person.${PERSON_ID}/$summary`).set(userHeaders());
            const returns = (resp, ...ids) => ids.some((id) => allIdValues(resp.body).includes(id));

            // the entry is cached while the Consent hides nothing
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync')
                .mockResolvedValue({
                    viewControlResourceToExcludeMap: {}, viewControlConsentQueries: [], viewControlConsentQueryOptions: []
                });
            try {
                const miss = await summary();
                expect(miss.headers).toHaveProperty('x-cache', 'Miss');
                expect(returns(miss, BLOCKED, BLOCKED_UUID)).toBe(true);
            } finally {
                spy.mockRestore();
            }

            const hit = await summary();
            expect(hit.headers).toHaveProperty('x-cache', 'Hit');
            expect(returns(hit, BLOCKED, BLOCKED_UUID)).toBe(false);
            expect(returns(hit, UNBLOCKED, UNBLOCKED_UUID)).toBe(true);
        });
    });

    // A service calling Person/{id}/$everything on a user's behalf can opt in to that Person's
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

        // The caller reads the Person and its CarePlans through an access tag of its own, but its scopes
        // don't include the Person's owner (the enrolled client that wrote the Consent). The Consent is
        // looked up under the view-control lookup scope, so the block still applies.
        test('with the opt-in, a caller whose scopes do not cover the Person\'s owner still gets the block', async () => {
            const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
            const accessTag = { system: 'https://www.icanbwell.com/access', code: 'othertenant' };
            for (const collection of ['Person_4_0_0', 'Patient_4_0_0', 'CarePlan_4_0_0']) {
                await db.collection(collection).updateMany({}, { $push: { 'meta.security': accessTag } });
            }
            const headers = getHeaders('user/*.read access/othertenant.read');

            const withOptIn = await personEverything(OPT_IN, headers);
            const withoutOptIn = await personEverything('', headers);

            expect(withoutOptIn.status).toBe(200);
            expect(hasBlocked(withoutOptIn)).toBe(true);
            expect(withOptIn.status).toBe(200);
            expect(hasUnblocked(withOptIn)).toBe(true);
            expect(hasBlocked(withOptIn)).toBe(false);
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

        test.each([['yes'], ['on'], ['']])('a malformed value (%p) is a 400, not an unfiltered record', async (value) => {
            const resp = await personEverything(`_applyDataViewControl=${value}`);
            expect(resp.status).toBe(400);
            expect(hasBlocked(resp)).toBe(false);
            expect(hasUnblocked(resp)).toBe(false);
        });

        test('a repeated parameter is a 400, not an unfiltered record', async () => {
            const resp = await personEverything(`${OPT_IN}&${OPT_IN}`);
            expect(resp.status).toBe(400);
            expect(hasUnblocked(resp)).toBe(false);
        });

        test.each([['false'], ['0']])('the value %p is accepted and applies nothing', async (value) => {
            const resp = await personEverything(`_applyDataViewControl=${value}`);
            expect(resp.status).toBe(200);
            expect(hasBlocked(resp)).toBe(true);
        });

        test('the opt-in on DELETE $everything is a 400 and deletes nothing', async () => {
            const resp = await request.delete(`/4_0_0/Person/${PERSON_ID}/$everything?${OPT_IN}`).set(getHeaders());
            expect(resp.status).toBe(400);
            expect(hasUnblocked(await personEverything())).toBe(true);
        });

        describe('with the $everything cache on', () => {
            const CACHE_ENV = [
                'ENABLE_REDIS',
                'ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION',
                'ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION'
            ];
            let savedCacheEnv;
            beforeEach(() => {
                savedCacheEnv = CACHE_ENV.map((name) => process.env[name]);
                CACHE_ENV.forEach((name) => { process.env[name] = '1'; });
                getTestContainer().redisClient.streams.clear();
            });
            afterEach(() => {
                CACHE_ENV.forEach((name, i) => {
                    if (savedCacheEnv[i] === undefined) {
                        delete process.env[name];
                    } else {
                        process.env[name] = savedCacheEnv[i];
                    }
                });
            });

            const cachedKeys = () => [...getTestContainer().redisClient.streams.keys()];
            const userEverything = () => personEverything('', userHeaders());

            test('an opt-in read is never served from, nor stored in, the cache that a user read filled', async () => {
                const userMiss = await userEverything();
                expect(userMiss.headers).toHaveProperty('x-cache', 'Miss');
                expect((await userEverything()).headers).toHaveProperty('x-cache', 'Hit');
                const keysAfterUser = cachedKeys();
                expect(keysAfterUser).toHaveLength(1);

                const optIn = await personEverything(OPT_IN);
                expect(optIn.status).toBe(200);
                expect(optIn.headers['x-cache']).not.toBe('Hit');
                expect(hasBlocked(optIn)).toBe(false);
                expect(hasUnblocked(optIn)).toBe(true);
                // nothing new was stored, and the user's entry was not replaced
                expect(cachedKeys()).toEqual(keysAfterUser);

                // and a service read without the opt-in still gets the full record, not the user's cache
                const plain = await personEverything();
                expect(plain.headers['x-cache']).not.toBe('Hit');
                expect(hasBlocked(plain)).toBe(true);
            });

            test('a user read after an opt-in read is a miss, so the opt-in stored nothing for it to hit', async () => {
                const optIn = await personEverything(OPT_IN);
                expect(optIn.status).toBe(200);
                expect(cachedKeys()).toHaveLength(0);

                const userFirst = await userEverything();
                expect(userFirst.headers).toHaveProperty('x-cache', 'Miss');
                expect(hasBlocked(userFirst)).toBe(false);
            });
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

        // the opt-in is only defined for Person $everything, so asking for it elsewhere is an error
        // rather than silently returning unfiltered data
        test('the opt-in on Patient $everything is a 400', async () => {
            const resp = await request.get(`/4_0_0/Patient/patient1/$everything?${OPT_IN}`).set(getHeaders());
            expect(resp.status).toBe(400);
        });

        // user tokens are always filtered, so the opt-in changes nothing for them (and its
        // single-Person rule doesn't apply)
        test('a user token is filtered with or without the opt-in', async () => {
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

    // The $everything cache holds entries from before the request-specific filtering, so a replay must
    // apply the caller's current Consent, and each user needs an entry of their own.
    describe('$everything Redis cache', () => {
        const REDIS_FLAGS = [
            'ENABLE_REDIS',
            'ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION',
            'ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION'
        ];
        // uuid of Person/person-with-common-patient, a second user linked to the same Patient as person1
        const OTHER_PERSON_ID = '65810a24-e90c-55b6-8b32-44bb9aa18c44';
        const otherUserHeaders = () => getHeadersWithCustomPayload({ ...USER_PAYLOAD, clientFhirPersonId: OTHER_PERSON_ID });
        const EVERYTHING = '/4_0_0/Patient/patient1/$everything';
        let savedRedisFlags;

        const showsBlocked = (body) => {
            const ids = allIdValues(body);
            return ids.includes(BLOCKED) || ids.includes(BLOCKED_UUID);
        };
        const showsUnblocked = (body) => {
            const ids = allIdValues(body);
            return ids.includes(UNBLOCKED) || ids.includes(UNBLOCKED_UUID);
        };
        const cacheKeysFor = (personId) =>
            Array.from(getTestContainer().redisClient.streams.keys()).filter((k) => k.endsWith(`:Person:${personId}`));

        beforeEach(async () => {
            savedRedisFlags = Object.fromEntries(REDIS_FLAGS.map((f) => [f, process.env[f]]));
            REDIS_FLAGS.forEach((f) => {
                process.env[f] = '1';
            });
            request = await createTestRequest();
            // the mock Redis outlives a test; start without entries from an earlier one
            getTestContainer().redisClient.streams.clear();
            for (const p of [...SEED, 'Person/personWithCommonPatient.json']) {
                await merge(p.split('/')[0], fx(p));
            }
        });

        afterEach(() => {
            for (const [flag, value] of Object.entries(savedRedisFlags)) {
                if (value === undefined) {
                    delete process.env[flag];
                } else {
                    process.env[flag] = value;
                }
            }
        });

        test('a replayed entry cached before the Consent existed no longer shows the blocked resource', async () => {
            const warm = await request.get(EVERYTHING).set(userHeaders());
            expect(warm.status).toBe(200);
            expect(warm.headers).toHaveProperty('x-cache', 'Miss');
            expect(showsBlocked(warm.body)).toBe(true);
            const [cacheKey] = cacheKeysFor(PERSON_ID);
            expect(cacheKeysFor(PERSON_ID)).toHaveLength(1);
            const staleEntries = deepcopy(getTestContainer().redisClient.streams.get(cacheKey));

            await merge('Consent', fx('Consent/consent1.json'));
            // The Consent write bumps the cache generation, which changes the key. Replay the old
            // entry as if that bump had not reached it (it failed, or the entry outlived it): find the key
            // the next request reads and put the old entry there.
            getTestContainer().redisClient.streams.clear();
            const rebuilt = await request.get(EVERYTHING).set(userHeaders());
            expect(rebuilt.headers).toHaveProperty('x-cache', 'Miss');
            const [currentKey] = cacheKeysFor(PERSON_ID);
            expect(cacheKeysFor(PERSON_ID)).toHaveLength(1);
            getTestContainer().redisClient.streams.set(currentKey, staleEntries);

            const replay = await request.get(EVERYTHING).set(userHeaders());
            expect(replay.status).toBe(200);
            expect(replay.headers).toHaveProperty('x-cache', 'Hit');
            expect(showsBlocked(replay.body)).toBe(false);
            expect(showsUnblocked(replay.body)).toBe(true);
        });

        test('two users linked to the same Patient get their own cache entry and their own Consent', async () => {
            await merge('Consent', fx('Consent/consent1.json'));

            // the user whose Consent blocks the CarePlan goes first, so a shared entry would hold the
            // filtered result and be replayed to the other user
            const blocked = await request.get(EVERYTHING).set(userHeaders());
            expect(blocked.headers).toHaveProperty('x-cache', 'Miss');
            expect(showsBlocked(blocked.body)).toBe(false);
            expect(showsUnblocked(blocked.body)).toBe(true);

            const other = await request.get(EVERYTHING).set(otherUserHeaders());
            expect(other.headers).toHaveProperty('x-cache', 'Miss');
            expect(showsBlocked(other.body)).toBe(true);

            expect(cacheKeysFor(PERSON_ID)).toHaveLength(1);
            expect(cacheKeysFor(OTHER_PERSON_ID)).toHaveLength(1);

            const blockedAgain = await request.get(EVERYTHING).set(userHeaders());
            expect(blockedAgain.headers).toHaveProperty('x-cache', 'Hit');
            expect(showsBlocked(blockedAgain.body)).toBe(false);
            const otherAgain = await request.get(EVERYTHING).set(otherUserHeaders());
            expect(otherAgain.headers).toHaveProperty('x-cache', 'Hit');
            expect(showsBlocked(otherAgain.body)).toBe(true);
        });
    });
});
