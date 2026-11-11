/**
 * A Composition section that points at a resource the patient's `dataConnectionViewControl` Consent
 * hides must not show it: the whole section is removed (its narrative describes the hidden resource)
 * on every read path the block applies to. Compositions themselves are still returned.
 * Sections are matched by the entry's reference, whichever id form it uses (source id or uuid).
 * All data is synthetic.
 */
const { describe, beforeAll, afterAll, test, expect, jest: jestObj } = require('@jest/globals');
const deepcopy = require('deepcopy');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    getCustomGraphQLHeaders,
    getGraphQLHeaders,
    getHeadersNdJson,
    getTestContainer
} = require('../../common');
const { PatientDataViewControlManager } = require('../../../../utils/patientDataViewController');
const { callMcpTool, bundleFromToolResult } = require('../../mcp/mcpTestHelpers');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const fx = (p) => require(`./fixtures/${p}`);
const SEED = [
    'Person/topLevelPerson.json',
    'Person/person1.json',
    'Patient/patient1.json',
    'Patient/patient3.json',
    'CarePlan/carePlan.json',
    'CarePlan/carePlan2.json'
];
const PERSON_ID = '5f3ca115-8630-5e55-a97d-4d6ee26c0adc';
const PATIENT_UUID = '24a5930e-11b4-5525-b482-669174917044';
// consent1.json blocks CarePlan/care-plan-1 by uuid; care-plan-2 stays visible
const BLOCKED_UUID = 'f49c5e15-81b5-57a9-bade-77e9e744fb2e';
const BLOCKED_TEXT = 'VC-BLOCKED-SECTION-TEXT';
const HEALTH_SUMMARY = { system: 'http://loinc.org', code: '18776-5' };
const ENCOUNTER_SUMMARY = { system: 'http://loinc.org', code: '34133-9' };
const OWNER = 'healthsystem1';
const SECURITY = [
    { system: 'https://www.icanbwell.com/owner', code: OWNER },
    { system: 'https://www.icanbwell.com/access', code: OWNER },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: OWNER }
];
const COMPOSITION_A = 'vc-composition-a';
const COMPOSITION_B = 'vc-composition-b';
const COMPOSITION_A_UUID = generateUUIDv5(`${COMPOSITION_A}|${OWNER}`);

const section = (id, reference, extra = {}) => ({ id, title: id, entry: [{ reference }], ...extra });
const composition = (id, type, sections) => ({
    resourceType: 'Composition',
    id,
    meta: { source: 'test', security: SECURITY },
    status: 'final',
    type: { coding: [type] },
    subject: { reference: 'Patient/patient1' },
    date: '2026-11-01',
    author: [{ display: 'test' }],
    title: id,
    section: sections
});
// A health summary with one section per care plan, and a group of nested sections.
const COMPOSITIONS = [
    composition(COMPOSITION_A, HEALTH_SUMMARY, [
        section('vc-section-blocked', 'CarePlan/care-plan-1', {
            text: { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${BLOCKED_TEXT}</div>` }
        }),
        section('vc-section-unblocked', 'CarePlan/care-plan-2'),
        section('vc-section-group', 'CarePlan/care-plan-2', {
            section: [
                section('vc-section-group-blocked', `CarePlan/${BLOCKED_UUID}`),
                section('vc-section-group-unblocked', 'CarePlan/care-plan-2')
            ]
        })
    ]),
    // an encounter summary whose only section is blocked
    composition(COMPOSITION_B, ENCOUNTER_SUMMARY, [section('vc-section-b-blocked', 'CarePlan/care-plan-1')])
];
const ALL_SECTIONS = [
    'vc-section-b-blocked',
    'vc-section-blocked',
    'vc-section-group',
    'vc-section-group-blocked',
    'vc-section-group-unblocked',
    'vc-section-unblocked'
];
const VISIBLE_SECTIONS = ['vc-section-group', 'vc-section-group-unblocked', 'vc-section-unblocked'];

const USER_PAYLOAD = {
    scope: 'patient/*.* user/*.* access/*.*',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: PERSON_ID,
    clientFhirPatientId: PATIENT_UUID,
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access'
};
const userHeaders = () => getHeadersWithCustomPayload(USER_PAYLOAD);
const userToken = () => userHeaders().Authorization.replace(/^Bearer /, '');

/** the sorted, distinct section ids anywhere in a body (only Composition sections use this prefix) */
function sectionIdsIn(body) {
    const ids = new Set();
    const walk = (node) => {
        if (Array.isArray(node)) {
            node.forEach(walk);
        } else if (node && typeof node === 'object') {
            if (typeof node.id === 'string' && node.id.startsWith('vc-section-')) {
                ids.add(node.id);
            }
            Object.values(node).forEach(walk);
        }
    };
    walk(body);
    return [...ids].sort();
}

const V1_QUERY = `query { composition(patient: { value: "Patient/${PATIENT_UUID}" }) {
    entry { resource { id section { id text { div } section { id } } } } } }`;
const V2_QUERY = `query { compositions(patient: { value: "Patient/${PATIENT_UUID}" }) {
    entry { resource { id section { id text { div } section { id } } } } } }`;
const graphql = (path, query, headers) => (r) =>
    r.post(path).send({ operationName: null, variables: {}, query }).set(headers);

describe('dataConnectionViewControl Consent on Composition sections', () => {
    let savedEnrolled;
    let request;

    const merge = async (type, resource) => {
        const resp = await request.post(`/4_0_0/${type}/1/$merge`).send(resource).set(getHeaders());
        expect(resp.status).toBe(200);
        expect(JSON.stringify(resp.body)).not.toContain('"issue"');
    };

    beforeAll(async () => {
        savedEnrolled = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = OWNER;
        await commonBeforeEach();
        request = await createTestRequest();
        for (const p of SEED) {
            await merge(p.split('/')[0], fx(p));
        }
        for (const c of COMPOSITIONS) {
            await merge('Composition', deepcopy(c));
        }
        await merge('Consent', fx('Consent/consent1.json'));
    });

    afterAll(async () => {
        if (savedEnrolled === undefined) {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        } else {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = savedEnrolled;
        }
        await commonAfterEach();
    });

    const restSearch = `/4_0_0/Composition?patient=Patient/${PATIENT_UUID}`;

    test.each([
        ['REST search', (r) => r.get(restSearch).set(userHeaders())],
        ['REST search with _bundle', (r) => r.get(`${restSearch}&_bundle=1`).set(userHeaders())],
        ['REST streaming search', (r) => r.get(`${restSearch}&_streamResponse=1`).set(userHeaders())],
        ['REST ndjson search', (r) => r.get(restSearch)
            .set({ ...getHeadersNdJson(), Authorization: userHeaders().Authorization })],
        ['REST search with _elements=section', (r) => r.get(`${restSearch}&_elements=section`).set(userHeaders())],
        ['REST read-by-id', (r) => r.get(`/4_0_0/Composition/${COMPOSITION_A_UUID}`).set(userHeaders())],
        ['GraphQL v1 composition(patient)', graphql('/$graphql', V1_QUERY, getCustomGraphQLHeaders(USER_PAYLOAD))],
        ['GraphQL v2 compositions(patient)', graphql('/4_0_0/$graphqlv2', V2_QUERY, getCustomGraphQLHeaders(USER_PAYLOAD))],
        ['Patient $everything', (r) => r.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`).set(userHeaders())],
        ['Patient $everything streamed', (r) => r.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`)
            .set({ ...getHeadersNdJson(), Authorization: userHeaders().Authorization })],
        ['Person $everything', (r) => r.get(`/4_0_0/Person/${PERSON_ID}/$everything`).set(userHeaders())],
        ['a service token opting in on Person $everything', (r) =>
            r.get(`/4_0_0/Person/${PERSON_ID}/$everything?_applyDataViewControl=true`).set(getHeaders())]
    ])('%s removes the sections that reference the blocked CarePlan', async (_name, send) => {
        const resp = await send(request);
        expect(resp.status).toBe(200);
        const body = resp.body && Object.keys(resp.body).length ? resp.body : String(resp.text);
        // Composition B's only section is blocked, so the visible sections are all Composition A's
        expect(sectionIdsIn(parse(body))).toEqual(VISIBLE_SECTIONS);
        expect(JSON.stringify(body)).not.toContain(BLOCKED_TEXT);
    });

    test('the /mcp Composition tool removes the sections that reference the blocked CarePlan', async () => {
        const { resp, rpc } = await callMcpTool(request, userToken(), 'search_composition', {
            patient: `Patient/${PATIENT_UUID}`
        });
        expect(resp.status).toBe(200);
        const bundle = bundleFromToolResult(rpc);
        expect(bundle.entry).toHaveLength(2);
        expect(sectionIdsIn(bundle)).toEqual(VISIBLE_SECTIONS);
        expect(resp.text).not.toContain(BLOCKED_TEXT);
    });

    test('a Composition whose only section is blocked is still returned, without sections', async () => {
        const resp = await request.get(`${restSearch}&type=${ENCOUNTER_SUMMARY.system}|${ENCOUNTER_SUMMARY.code}`)
            .set(userHeaders());
        expect(resp.status).toBe(200);
        expect(resp.body).toHaveLength(1);
        expect(resp.body[0].id).toBe(COMPOSITION_B);
        expect(resp.body[0]).not.toHaveProperty('section');
    });

    test.each([
        ['REST search with a service token', (r) => r.get(restSearch).set(getHeaders())],
        ['GraphQL v1 with a service token', graphql('/$graphql', V1_QUERY, getGraphQLHeaders())],
        ['Person $everything with a service token, without the opt-in', (r) =>
            r.get(`/4_0_0/Person/${PERSON_ID}/$everything`).set(getHeaders())]
    ])('%s still returns every section', async (_name, send) => {
        const resp = await send(request);
        expect(resp.status).toBe(200);
        expect(sectionIdsIn(resp.body)).toEqual(ALL_SECTIONS);
    });

    describe('$everything served from the Redis cache', () => {
        const CACHE_ENV = [
            'ENABLE_REDIS',
            'ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION',
            'ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION'
        ];
        let savedCacheEnv;
        // the cache is only used for streamed member reads with a single id
        const memberEverything = () => request.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`)
            .set({ ...getHeadersNdJson(), Authorization: userHeaders().Authorization });

        beforeAll(() => {
            savedCacheEnv = CACHE_ENV.map((name) => process.env[name]);
            CACHE_ENV.forEach((name) => { process.env[name] = '1'; });
        });

        afterAll(() => {
            CACHE_ENV.forEach((name, i) => {
                if (savedCacheEnv[i] === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = savedCacheEnv[i];
                }
            });
            getTestContainer().redisClient.streams.clear();
        });

        test('a cache hit removes the sections that reference the blocked CarePlan', async () => {
            const miss = await memberEverything();
            expect(miss.status).toBe(200);
            expect(miss.headers).toHaveProperty('x-cache', 'Miss');
            expect(getTestContainer().redisClient.streams.size).toBeGreaterThan(0);

            const hit = await memberEverything();
            expect(hit.status).toBe(200);
            expect(hit.headers).toHaveProperty('x-cache', 'Hit');
            expect(sectionIdsIn(parse(hit.text))).toEqual(VISIBLE_SECTIONS);
            expect(hit.text).not.toContain(BLOCKED_TEXT);
        });

        test('a cache hit whose Consent lookup fails returns no clinical data', async () => {
            await memberEverything();
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync')
                .mockRejectedValue(new Error('consent store unavailable'));
            try {
                const resp = await memberEverything();
                expect(resp.text).toContain('OperationOutcome');
                expect(resp.text).not.toContain('"resourceType":"Composition"');
                expect(resp.text).not.toContain('"resourceType":"CarePlan"');
                expect(resp.text).not.toContain('consent store unavailable');
            } finally {
                spy.mockRestore();
            }
            // the failed request leaves no partial cache entry behind to replay
            const next = await memberEverything();
            expect(next.headers).toHaveProperty('x-cache', 'Miss');
            expect(sectionIdsIn(parse(next.text))).toEqual(VISIBLE_SECTIONS);
        });
    });
});

/** ndjson and streamed responses arrive as text; parse them into an array of resources */
function parse(body) {
    if (typeof body !== 'string') {
        return body;
    }
    const trimmed = body.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            // ndjson: one resource per line
        }
    }
    return trimmed.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
