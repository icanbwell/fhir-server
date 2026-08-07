// =============================================================================
// CONSENT GAPS — four consent states that unlock upstream data where the target
// state is that they should not. Each test states the target outcome and fails
// until the behavior matches it. Quarantined; run directly with:
//   npx jest src/tests/security/matrix/findings.bugs
//
// 1. EXPIRED CONSENT STILL WORKS
//    A consent whose provision period ended in 2020 still unlocks. Only `status`
//    is checked, and nothing changes `status` when the period elapses, so a
//    consent with a deliberately short window never actually stops working.
//
// 2. NOT-YET-VALID CONSENT ALREADY WORKS
//    Same code path, other direction: a period starting in 2090 unlocks today.
//    A consent scheduled to begin later is live the moment it's written.
//
// 3. THE AUTHORIZING ACTOR ISN'T CHECKED
//    Repointing the provision actor (role AUT) at a completely different,
//    non-existent person leaves the consent working. So the consent is matched
//    on the patient and the owning client but not on who authorized it.
//
// 4. A CLIENT CAN GRANT ITSELF ACCESS
//    A client with write scope can create a consent naming itself as recipient
//    of upstream data, and it's honored. Combined with 3, a client that can
//    write a Consent can unlock upstream data for any patient it can name.
//
//    TODO(product): confirm who is supposed to be able to create a dataSharing
//    Consent. If clients legitimately create their own, then 3 and 4 together
//    describe the intended design and this file needs rewriting around whatever
//    check is meant to make it safe.
// =============================================================================
const masterPersonResource = require('../../../data_sharing/everything/fixtures/person/master_person.json');
const masterPatientResource = require('../../../data_sharing/everything/fixtures/patient/master_patient.json');
const clientPersonResource = require('../../../data_sharing/everything/fixtures/person/client_person.json');
const clientPatientResource = require('../../../data_sharing/everything/fixtures/patient/client_patient.json');
const clientObservationResource = require('../../../data_sharing/everything/fixtures/observation/client_observation.json');
const proaPatient1Resource = require('../../../data_sharing/everything/fixtures/patient/proa_patient_1.json');
const proaObservation1Resource = require('../../../data_sharing/everything/fixtures/observation/proa_observation_1.json');
const proaPatient2Resource = require('../../../data_sharing/everything/fixtures/patient/proa_patient_2.json');
const proaObservation2Resource = require('../../../data_sharing/everything/fixtures/observation/proa_observation_2.json');
const clientConsentGivenResource = require('../../../data_sharing/everything/fixtures/consent/client_consent_given.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');
const deepcopy = require('deepcopy');

const clientHeaders = getHeaders('user/*.read access/client.*');
const clientWriteHeaders = getHeaders('user/*.read user/*.write access/client.*');

const BASE = [
    masterPersonResource, masterPatientResource,
    clientPersonResource, clientPatientResource, clientObservationResource,
    proaPatient1Resource, proaObservation1Resource,
    proaPatient2Resource, proaObservation2Resource
];

const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

function resIds (resp) {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
}

function variant (changes) {
    const c = deepcopy(clientConsentGivenResource);
    if (changes.status !== undefined) c.status = changes.status;
    if (changes.period !== undefined) c.provision.period = changes.period;
    if (changes.actorRef !== undefined) {
        const aut = c.provision.actor.find((a) => (a.role.coding || []).some((cd) => cd.code === 'AUT'));
        if (aut) aut.reference.reference = changes.actorRef;
    }
    return c;
}

const PAST = { start: '2020-01-01T00:00:00.000Z', end: '2020-12-31T23:59:59.000Z' };
const FUTURE = { start: '2090-01-01T00:00:00.000Z', end: '2090-12-31T23:59:59.000Z' };
const CURRENT = { start: '2020-01-01T00:00:00.000Z', end: '2090-12-31T23:59:59.000Z' };

async function seed (extra = []) {
    cursorSpy.mockReturnThis();
    const request = await createTestRequest((c) => c);
    const all = [...BASE, ...extra];
    const resp = await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
    expect(resp.body.length).toBe(all.length);
    return request;
}
const everythingAsClient = (request, headers = clientHeaders) =>
    request.get(`/4_0_0/Person/${clientPersonResource.id}/$everything`).set(headers);

const PROA_IDS = [proaPatient1Resource.id, proaObservation1Resource.id];

describe('CONSENT FINDINGS', () => {
    beforeEach(async () => { await commonBeforeEach(); cursorSpy.mockReturnThis(); });
    afterEach(async () => { await commonAfterEach(); });

    // control, so a failure below can't be blamed on consent sharing being broken
    test('control: a current, valid consent unlocks the upstream records', async () => {
        const request = await seed([variant({ status: 'active', period: CURRENT })]);
        expect(resIds(await everythingAsClient(request))).toContain(proaPatient1Resource.id);
    });

    test('control: no consent means no upstream records', async () => {
        const request = await seed();
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });

    // ---- 1 ----------------------------------------------------------------
    test('SECURE: a consent whose period has ended does not unlock', async () => {
        const request = await seed([variant({ status: 'active', period: PAST })]);
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });

    // ---- 2 ----------------------------------------------------------------
    test('SECURE: a consent whose period has not started does not unlock', async () => {
        const request = await seed([variant({ status: 'active', period: FUTURE })]);
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });

    // ---- 3 ----------------------------------------------------------------
    test('SECURE: a consent naming a different authorizing actor does not unlock', async () => {
        const request = await seed([variant({
            status: 'active', period: CURRENT,
            actorRef: 'Patient/person.00000000-0000-4000-8000-000000000000'
        })]);
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });

    // ---- 4 ----------------------------------------------------------------
    test('SECURE: a client cannot unlock upstream data with a consent it wrote itself', async () => {
        const request = await seed();
        const selfGrant = variant({ status: 'active', period: CURRENT });
        selfGrant.id = 'consFindingSelfGrant';
        const put = await request.put('/4_0_0/Consent/consFindingSelfGrant')
            .send(selfGrant).set(clientWriteHeaders);

        if ([200, 201].includes(put.status)) {
            const got = resIds(await everythingAsClient(request));
            for (const id of PROA_IDS) expect(got).not.toContain(id);
        } else {
            expect([400, 403, 422]).toContain(put.status);
        }
    });

    test('SECURE: and the same consent written by the client does not unlock a second patient', async () => {
        const request = await seed();
        const selfGrant = variant({ status: 'active', period: CURRENT });
        selfGrant.id = 'consFindingSelfGrant2';
        selfGrant.patient = { reference: `Patient/${proaPatient2Resource.id}` };
        const put = await request.put('/4_0_0/Consent/consFindingSelfGrant2')
            .send(selfGrant).set(clientWriteHeaders);
        if ([200, 201].includes(put.status)) {
            const got = resIds(await everythingAsClient(request));
            expect(got).not.toContain(proaPatient2Resource.id);
            expect(got).not.toContain(proaObservation2Resource.id);
        } else {
            expect([400, 403, 422]).toContain(put.status);
        }
    });
});
