/**
 * The patient's `dataConnectionViewControl` Consent must hide the blocked resource on every
 * user-token REST read path:
 *   - REST search (bundle and streaming)
 *   - REST read-by-id (404 as if missing) and $everything
 * Every path loads the Consent once per request and filters, rather than fails, when the caller's
 * Person has no owner tag. Only user tokens of clients listed in CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL are
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
    getTestContainer
} = require('../../common');

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

describe('dataConnectionViewControl Consent on REST search/read and $everything', () => {
    let savedEnrolled;
    let request;

    const merge = async (type, resource) => {
        const resp = await request.post(`/4_0_0/${type}/1/$merge`).send(resource).set(getHeaders());
        expect(resp.status).toBe(200);
    };
    // REST search answers with a bare array of resources unless _bundle=1 is passed
    const idsOf = (body) =>
        Array.isArray(body) ? body.map((r) => r.id) : (body.entry || []).map((e) => e.resource.id);
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

        test('the Consent is loaded once per request (no N+1)', async () => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentForPersonAsync');
            try {
                await request.get('/4_0_0/CarePlan').set(userHeaders());
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                spy.mockRestore();
            }
        });

        test.each([
            ['$everything', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders())]
        ])('the Consent is loaded once per request: %s', async (_name, send) => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentForPersonAsync');
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
                }]
        ])('a failed Consent lookup fails the request and returns no data: %s', async (_name, send, assertFailed) => {
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentForPersonAsync')
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

        test('service token (no user) still sees the blocked resource everywhere', async () => {
            const search = await request.get('/4_0_0/CarePlan').set(getHeaders());
            expect(idsOf(search.body)).toContain(BLOCKED);
            const read = await request.get(`/4_0_0/CarePlan/${BLOCKED_UUID}`).set(getHeaders());
            expect(read.status).toBe(200);
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
            ['$everything', (r) => r.get(`/4_0_0/Patient/person.${PERSON_ID}/$everything`).set(userHeaders()),
                (resp) => {
                    expect(allIdValues(resp.body)).not.toContain(BLOCKED_UUID);
                    expect(allIdValues(resp.body)).toContain(UNBLOCKED_UUID);
                }]
        ])('a user token of an enrolled deployment is filtered, not failed: %s', async (_name, send, assertFiltered) => {
            await seed();
            await stripPersonOwnerTag();
            const resp = await send(request);
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
        const httpOk = (resp) => expect(resp.status).toBe(200);

        test.each([
            ['REST search', (r) => r.get('/4_0_0/CarePlan').set(headers()), httpOk],
            ['REST streaming search', (r) => r.get('/4_0_0/CarePlan?_streamResponse=1').set(headers()), httpOk]
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
            const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentForPersonAsync');
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
    });

    describe('mixed uuid / sourceId exclusion lists', () => {
        // Consent blocks CarePlan/care-plan-1 (by uuid) and the caller additionally excludes
        // care-plan-2 by its non-uuid source id: the merged _id:not list mixes both id forms.
        test('REST search: consent uuid + caller source-id _id:not are both excluded', async () => {
            await seed();
            const resp = await request.get(`/4_0_0/CarePlan?_id:not=${UNBLOCKED}`).set(userHeaders());
            expect(idsOf(resp.body)).toEqual([]);
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
            // put the old entry back, whatever the Consent write did to the cache
            getTestContainer().redisClient.streams.set(cacheKey, staleEntries);

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
