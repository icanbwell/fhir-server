/**
 * Cost of the dataConnectionViewControl Consent on member reads: p50/p95 latency for a member of an
 * enrolled client versus a non-enrolled one, on REST search, GraphQL v1 and Patient $everything
 * (fresh and from the Redis cache), plus a check that the Consent lookup's query uses an index.
 *
 * The production indexes are built after seeding (merges create collections with only _id). The
 * in-memory test database shows the relative cost of the lookup, not production latency.
 * There is no latency budget, so timings are reported, not asserted. jest.config.js ignores the
 * performance folder, so override its ignore list to run it:
 *   NODE_ENV=test node --max-old-space-size=12288 ./node_modules/.bin/jest \
 *     src/tests/integration/performance/dataViewControl --runInBand --forceExit \
 *     --testTimeout=600000 --testPathIgnorePatterns='/unit/'
 * VIEW_CONTROL_PERF_BLOCKED=<n> sets how many CarePlans the Consent hides (default 20), and
 * VIEW_CONTROL_PERF_OUT=<file> also writes the numbers as JSON. All data is synthetic.
 */
const fs = require('fs');
const deepcopy = require('deepcopy');
const { describe, beforeAll, afterAll, test, expect, jest: jestObj } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    createTestRequest,
    getHeadersWithCustomPayload,
    getCustomGraphQLHeaders,
    getTestContainer
} = require('../../common');
const { PatientDataViewControlManager } = require('../../../../utils/patientDataViewController');
const { PatientDataViewControlExclusion } = require('../../../../utils/patientDataViewControlExclusion');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const fixtures = '../../everything/person_or_patient_non_clinical/fixtures';
const fx = (p) => require(`${fixtures}/${p}`);
const PERSON_ID = '5f3ca115-8630-5e55-a97d-4d6ee26c0adc';
const PATIENT_UUID = '24a5930e-11b4-5525-b482-669174917044';
const OWNER = 'healthsystem1';

// a realistic record: the member's CarePlans, of which the Consent hides some, plus other members'
// Consents in the same collection
// VIEW_CONTROL_PERF_BLOCKED sets how many the Consent hides, to see how the cost grows
const BLOCKED_CARE_PLANS = Number(process.env.VIEW_CONTROL_PERF_BLOCKED || 20);
const CARE_PLANS = Math.max(200, BLOCKED_CARE_PLANS + 100);
const OTHER_CONSENTS = 2000;
const WARMUP = 5;
const SETUP_TIMEOUT_MS = 600000;
const ITERATIONS = 50;
const CACHE_ENV = [
    'ENABLE_REDIS',
    'ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION',
    'ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION'
];

const carePlanId = (i) => `vc-perf-care-plan-${i}`;
const carePlanUuid = (i) => generateUUIDv5(`${carePlanId(i)}|${OWNER}`);

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
const ndjsonUserHeaders = () => ({ ...getHeadersNdJson(), Authorization: userHeaders().Authorization });

const PATHS = [
    ['REST CarePlan search', (r) => r.get('/4_0_0/CarePlan?_count=500').set(userHeaders())],
    ['GraphQL v1 carePlan', (r) => r.post('/$graphql')
        .send({ operationName: null, variables: {}, query: 'query { carePlan(_count: 500) { entry { resource { id } } } }' })
        .set(getCustomGraphQLHeaders(USER_PAYLOAD))],
    ['Patient $everything', (r) => r.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`).set(userHeaders())]
];

function percentile(sortedMs, p) {
    return sortedMs[Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)];
}

const elapsedMs = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const summarize = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted.length ? { p50: percentile(sorted, 50), p95: percentile(sorted, 95) } : null;
};

/**
 * Times the requests, and separately the Consent lookup inside them (the wrapper's load: walking the
 * Person and searching the Consent), so the PR can tell the lookup from the filtered query.
 */
async function timeAsync(send) {
    for (let i = 0; i < WARMUP; i++) {
        expect((await send()).status).toBe(200);
    }
    const lookupSamples = [];
    const original = PatientDataViewControlExclusion.prototype.loadAsync;
    const spy = jestObj.spyOn(PatientDataViewControlExclusion.prototype, 'loadAsync')
        .mockImplementation(async function (...args) {
            const start = process.hrtime.bigint();
            try {
                return await original.apply(this, args);
            } finally {
                lookupSamples.push(elapsedMs(start));
            }
        });
    const samples = [];
    try {
        for (let i = 0; i < ITERATIONS; i++) {
            const start = process.hrtime.bigint();
            const resp = await send();
            samples.push(elapsedMs(start));
            expect(resp.status).toBe(200);
        }
    } finally {
        spy.mockRestore();
    }
    const lookup = summarize(lookupSamples);
    return { ...summarize(samples), lookupP50: lookup?.p50 ?? 0, lookups: lookupSamples.length };
}

describe('dataConnectionViewControl performance', () => {
    let request;
    let savedEnrolled;
    const results = [];

    const merge = async (type, body) => {
        const resp = await request.post(`/4_0_0/${type}/1/$merge`).send(body).set(getHeaders());
        expect(resp.status).toBe(200);
    };
    const setEnrolled = (enrolled) => {
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = enrolled ? OWNER : 'some-other-client';
    };

    beforeAll(async () => {
        savedEnrolled = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        await commonBeforeEach();
        request = await createTestRequest();
        for (const p of ['Person/topLevelPerson.json', 'Person/person1.json', 'Patient/patient1.json']) {
            await merge(p.split('/')[0], fx(p));
        }
        const template = fx('CarePlan/carePlan.json');
        await merge('CarePlan', Array.from({ length: CARE_PLANS }, (_, i) => ({
            ...deepcopy(template), id: carePlanId(i)
        })));
        const consent = deepcopy(fx('Consent/consent1.json'));
        consent.provision.data = Array.from({ length: BLOCKED_CARE_PLANS }, (_, i) => ({
            id: `data-${i}`, meaning: 'instance', reference: { reference: `CarePlan/${carePlanUuid(i)}` }
        }));
        await merge('Consent', consent);
        // other members' view-control Consents: the lookup has to find this member's among them
        const others = Array.from({ length: OTHER_CONSENTS }, (_, i) => {
            const other = deepcopy(consent);
            other.id = `vc-perf-other-consent-${i}`;
            other.provision.data = consent.provision.data.slice(0, 1);
            other.patient = { reference: `Patient/person.${generateUUIDv5(`vc-perf-other-person-${i}`)}` };
            return other;
        });
        for (let i = 0; i < others.length; i += 500) {
            await merge('Consent', others.slice(i, i + 500));
        }
        // $merge creates collections with only the _id index; build the production indexes
        // (customIndexes.js) so the query plans and timings resemble production
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        for (const { name } of await db.listCollections().toArray()) {
            await container.indexManager.indexCollectionAsync({ collectionName: name, db });
        }
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        const table = results.map((r) => `${r.path.padEnd(32)} ${r.enrolled ? 'enrolled    ' : 'not enrolled'}  ` +
            `p50 ${r.p50.toFixed(1).padStart(7)} ms  p95 ${r.p95.toFixed(1).padStart(7)} ms  ` +
            `lookup p50 ${r.lookupP50.toFixed(1).padStart(6)} ms (${r.lookups} lookups)`).join('\n');
        process.stdout.write(`\ndataConnectionViewControl latency (${ITERATIONS} requests each, ` +
            `${BLOCKED_CARE_PLANS} of ${CARE_PLANS} CarePlans blocked)\n${table}\n`);
        if (process.env.VIEW_CONTROL_PERF_OUT) {
            fs.writeFileSync(process.env.VIEW_CONTROL_PERF_OUT, JSON.stringify({
                blocked: BLOCKED_CARE_PLANS, carePlans: CARE_PLANS, otherConsents: OTHER_CONSENTS, results
            }, null, 2));
        }
        if (savedEnrolled === undefined) {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        } else {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = savedEnrolled;
        }
        await commonAfterEach();
    });

    test('the Consent lookup query uses an index, not a collection scan', async () => {
        setEnrolled(true);
        const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync');
        try {
            expect((await request.get('/4_0_0/CarePlan').set(userHeaders())).status).toBe(200);
            const { viewControlConsentQueries } = await spy.mock.results[0].value;
            expect(viewControlConsentQueries).toHaveLength(1);
            const { query, collectionName } = viewControlConsentQueries[0];
            const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
            const plan = JSON.stringify(
                (await db.collection(collectionName).find(query).explain('queryPlanner')).queryPlanner.winningPlan
            );
            process.stdout.write(`\nConsent lookup on ${collectionName}: ${JSON.stringify(query)}\nwinning plan: ${plan}\n`);
            expect(plan).toContain('IXSCAN');
            expect(plan).not.toContain('COLLSCAN');
        } finally {
            spy.mockRestore();
        }
    });

    test.each(PATHS.flatMap(([path, send]) => [[path, send, true], [path, send, false]]))(
        '%s, enrolled: %s', async (path, send, enrolled) => {
            setEnrolled(enrolled);
            if (enrolled) {
                // sanity: the block is in effect, so the numbers measure the filtered read
                const ids = JSON.stringify((await PATHS[0][1](request)).body);
                expect(ids).not.toContain(carePlanId(0));
                expect(ids).toContain(carePlanId(BLOCKED_CARE_PLANS));
            }
            results.push({ path, enrolled, ...(await timeAsync(() => send(request))) });
        }
    );

    describe('Patient $everything from the Redis cache', () => {
        let savedCacheEnv;
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
        });

        test.each([[true], [false]])('enrolled: %s', async (enrolled) => {
            setEnrolled(enrolled);
            getTestContainer().redisClient.streams.clear();
            const send = () => request.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`).set(ndjsonUserHeaders());
            expect((await send()).headers).toHaveProperty('x-cache', 'Miss');
            expect((await send()).headers).toHaveProperty('x-cache', 'Hit');
            results.push({ path: 'Patient $everything (cache hit)', enrolled, ...(await timeAsync(send)) });
        });
    });
});
