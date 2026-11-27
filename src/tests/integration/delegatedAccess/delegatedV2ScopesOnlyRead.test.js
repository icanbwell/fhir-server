/**
 * A RelatedPerson delegated token read path with ENABLE_DELEGATED_V2_SCOPES_ONLY on.
 *
 * The flag only changes which scope tokens the delegate carries into the request. These tests
 * pin that everything a delegate could already read keeps working when the token holds v2 letter
 * scopes (search in every response mode, read by id, $everything, the Consent's sensitivity
 * filtering, the read-only operation gate), that a v1 scope is no longer honored, and that tokens
 * the flag does not cover read exactly as before. All data is synthetic.
 */
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../common');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
const { PERSON_ID, PATIENT_UUID, USER_PAYLOAD } = require('../everything/person_or_patient_non_clinical/viewControlUserFixtures');

const fixture = (path) => require(`../everything/person_or_patient_non_clinical/fixtures/${path}`);

const SENSITIVITY_SYSTEM = 'https://www.icanbwell.com/sensitivity-category';
const ACTOR_REFERENCE = 'RelatedPerson/rp-actor-a';
const LETTER_SCOPE = 'patient/*.rs access/*.rs';
const CARE_PLAN_IDS = ['care-plan-1', 'care-plan-2'];
const VISIBLE_OBSERVATION = '2354-InAgeCohort';
const HIDDEN_OBSERVATION = 'observation-mental-health';

const SEED = [
    'Person/topLevelPerson.json',
    'Person/person1.json',
    'Patient/patient1.json',
    'Patient/patient3.json',
    'CarePlan/carePlan.json',
    'CarePlan/carePlan2.json'
];

const ENV_FLAGS = {
    ENABLE_DELEGATED_ACCESS_DETECTION: 'true',
    ENABLE_SMART_V2_CRUDS_SCOPES: 'true',
    ENABLE_DELEGATED_V2_SCOPES_ONLY: 'true'
};

/**
 * @param {string} scope
 * @param {Object} [overrides]
 * @return {Object}
 */
const delegatedHeaders = (scope, overrides = {}) =>
    getHeadersWithCustomPayload({
        ...USER_PAYLOAD,
        scope,
        act: { reference: ACTOR_REFERENCE, sub: 'actor-a-sub' },
        ...overrides
    });

/**
 * A Consent letting the actor read the grantor's data, denying the mental health category. The period
 * is relative to now so the fixture never expires.
 * @return {Object}
 */
const delegatedConsent = () => {
    const consent = deepcopy(fixture('Consent/consentDelegatedActor.json'));
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    consent.provision.period = { start, end };
    consent.provision.provision = [
        {
            type: 'deny',
            securityLabel: [{ system: SENSITIVITY_SYSTEM, code: 'MENTAL_HEALTH' }]
        }
    ];
    return consent;
};

/**
 * @param {string} id
 * @param {string|undefined} sensitivityCode
 * @return {Object}
 */
const observation = (id, sensitivityCode) => {
    const resource = deepcopy(fixture('Observation/observation1.json'));
    resource.id = id;
    if (sensitivityCode) {
        resource.meta.security.push({ system: SENSITIVITY_SYSTEM, code: sensitivityCode });
    }
    return resource;
};

const idsOf = (body) =>
    (Array.isArray(body) ? body : (body.entry || []).map((e) => e.resource)).map((r) => r.id).sort();

describe('delegated RelatedPerson reads with enableDelegatedV2ScopesOnly on', () => {
    let savedEnv;
    let hintSpy;
    let request;

    const merge = async (type, resource) => {
        const resp = await request.post(`/4_0_0/${type}/1/$merge`).send(resource).set(getHeaders());
        expect(resp.status).toBe(200);
    };

    beforeAll(async () => {
        savedEnv = Object.fromEntries(Object.keys(ENV_FLAGS).map((key) => [key, process.env[key]]));
        Object.assign(process.env, ENV_FLAGS);
        await commonBeforeEach();
        request = await createTestRequest();
        for (const path of SEED) {
            await merge(path.split('/')[0], fixture(path));
        }
        await merge('Observation', observation(VISIBLE_OBSERVATION));
        await merge('Observation', observation(HIDDEN_OBSERVATION, 'MENTAL_HEALTH'));
        await merge('Consent', delegatedConsent());
    });

    afterAll(async () => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        await commonAfterEach();
    });

    // test databases have no custom indexes, so the delegated-access Consent query's index hint fails
    beforeEach(() => {
        hintSpy = jest.spyOn(DatabaseCursor.prototype, 'hint').mockReturnThis();
    });

    afterEach(() => {
        hintSpy.mockRestore();
    });

    test.each([
        ['default (array) response', '/4_0_0/CarePlan'],
        ['bundle response', '/4_0_0/CarePlan?_bundle=1'],
        ['streaming response', '/4_0_0/CarePlan?_streamResponse=1']
    ])('search returns the patient resources with letter scopes: %s', async (_name, url) => {
        const resp = await request.get(url).set(delegatedHeaders(LETTER_SCOPE));

        expect(resp.status).toBe(200);
        expect(idsOf(resp.body)).toEqual(CARE_PLAN_IDS);
    });

    test.each([
        ['search', '/4_0_0/Observation', [VISIBLE_OBSERVATION]],
        ['bundle search', '/4_0_0/Observation?_bundle=1', [VISIBLE_OBSERVATION]],
        ['search by explicit _id', `/4_0_0/Observation?_id=${HIDDEN_OBSERVATION}`, []]
    ])('the Consent still hides the denied sensitivity category: %s', async (_name, url, expectedIds) => {
        const resp = await request.get(url).set(delegatedHeaders(LETTER_SCOPE));

        expect(resp.status).toBe(200);
        expect(idsOf(resp.body)).toEqual(expectedIds);
    });

    test.each([
        ['an unhidden CarePlan', '/4_0_0/CarePlan/care-plan-1', 200],
        ['an unhidden Observation', `/4_0_0/Observation/${VISIBLE_OBSERVATION}`, 200],
        ['an Observation the Consent hides', `/4_0_0/Observation/${HIDDEN_OBSERVATION}`, 404]
    ])('read by id with letter scopes: %s', async (_name, url, status) => {
        const resp = await request.get(url).set(delegatedHeaders(LETTER_SCOPE));

        expect(resp.status).toBe(status);
    });

    test('Patient $everything still returns the patient data with one of the two Observations', async () => {
        const resp = await request
            .get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`)
            .set(delegatedHeaders(LETTER_SCOPE));

        expect(resp.status).toBe(200);
        const resourceTypes = resp.body.entry.map((e) => e.resource.resourceType).sort();
        expect(resourceTypes).toEqual(['CarePlan', 'CarePlan', 'Observation', 'Patient', 'Person']);
        const returnedObservation = resp.body.entry.find((e) => e.resource.resourceType === 'Observation').resource;
        expect(returnedObservation.meta.security.map((tag) => tag.code)).not.toContain('MENTAL_HEALTH');
    });

    test.each([
        ['a create', (r) => r.post('/4_0_0/CarePlan/1/$merge').send(fixture('CarePlan/carePlan.json'))],
        ['a type history', (r) => r.get('/4_0_0/CarePlan/_history')],
        ['an instance history', (r) => r.get('/4_0_0/CarePlan/care-plan-1/_history')]
    ])('the read-only gate still refuses %s even with every letter', async (_name, send) => {
        const resp = await send(request).set(delegatedHeaders('patient/*.cruds access/*.cruds'));

        expect(resp.status).toBe(403);
    });

    test.each([
        ['patient/CarePlan.rs is granted as a letter', 'patient/*.read patient/CarePlan.rs access/*.rs access/*.read', '/4_0_0/CarePlan', 200],
        ['v1 patient/*.read does not open another resource type', 'patient/*.read patient/CarePlan.rs access/*.rs access/*.read', '/4_0_0/Observation', 403]
    ])('a v1 scope next to letters is not honored: %s', async (_name, scope, url, status) => {
        const resp = await request.get(url).set(delegatedHeaders(scope));

        expect(resp.status).toBe(status);
    });

    test.each([
        ['patient/*.read access/*.read'],
        ['patient/*.* access/*.*'],
        ['patient/*.write access/*.read']
    ])('a delegate presenting only v1 scopes is refused at login: %s', async (scope) => {
        const resp = await request.get('/4_0_0/CarePlan').set(delegatedHeaders(scope));

        expect(resp.status).toBe(401);
    });

    describe('tokens the flag does not cover', () => {
        test('a delegate keeps reading with v1 scopes once the flag is off', async () => {
            process.env.ENABLE_DELEGATED_V2_SCOPES_ONLY = 'false';
            try {
                const resp = await request
                    .get('/4_0_0/CarePlan')
                    .set(delegatedHeaders('patient/*.read access/*.read'));

                expect(resp.status).toBe(200);
                expect(idsOf(resp.body)).toEqual(CARE_PLAN_IDS);
            } finally {
                process.env.ENABLE_DELEGATED_V2_SCOPES_ONLY = 'true';
            }
        });

        test('a user token without a delegated actor keeps reading with v1 scopes', async () => {
            const resp = await request.get('/4_0_0/CarePlan').set(
                getHeadersWithCustomPayload({
                    ...USER_PAYLOAD,
                    scope: 'patient/*.read access/*.read',
                    clientFhirPersonId: PERSON_ID
                })
            );

            expect(resp.status).toBe(200);
            expect(idsOf(resp.body)).toEqual(CARE_PLAN_IDS);
        });
    });
});
