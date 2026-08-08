// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 SAE-6 (mongo-only; no ClickHouse).
// Gap: a client holding write scope creates a Consent naming itself as
// recipient of upstream data, and the consent is honored. Nothing checks
// whether the writer is an appropriate party to grant this kind of consent.
//
// Combined with CL-1 (the authorizing actor also isn't validated -- see the
// sec-1580/cl1-consent-actor-not-checked PR), a client able to write a
// Consent could unlock upstream data for any patient it can name.
//
// Reuses the existing data_sharing/everything fixtures (master/client
// person+patient, two PROA patient+observation pairs, and the
// client_consent_given.json template) already committed on main.
//
// Asserts the SECURE outcome; if a self-written consent still unlocks data,
// this FAILS. *.bugs, excluded from default CI.
// ============================================================================
const masterPersonResource = require('../../data_sharing/everything/fixtures/person/master_person.json');
const masterPatientResource = require('../../data_sharing/everything/fixtures/patient/master_patient.json');
const clientPersonResource = require('../../data_sharing/everything/fixtures/person/client_person.json');
const clientPatientResource = require('../../data_sharing/everything/fixtures/patient/client_patient.json');
const clientObservationResource = require('../../data_sharing/everything/fixtures/observation/client_observation.json');
const proaPatient1Resource = require('../../data_sharing/everything/fixtures/patient/proa_patient_1.json');
const proaObservation1Resource = require('../../data_sharing/everything/fixtures/observation/proa_observation_1.json');
const proaPatient2Resource = require('../../data_sharing/everything/fixtures/patient/proa_patient_2.json');
const proaObservation2Resource = require('../../data_sharing/everything/fixtures/observation/proa_observation_2.json');
const clientConsentGivenResource = require('../../data_sharing/everything/fixtures/consent/client_consent_given.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
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
    return c;
}

const CURRENT = { start: '2020-01-01T00:00:00.000Z', end: '2090-12-31T23:59:59.000Z' };

async function seed () {
    cursorSpy.mockReturnThis();
    const request = await createTestRequest((c) => c);
    const resp = await request.post('/4_0_0/Person/1/$merge').send(BASE).set(getHeaders());
    expect(resp.body.length).toBe(BASE.length);
    return request;
}
const everythingAsClient = (request) =>
    request.get(`/4_0_0/Person/${clientPersonResource.id}/$everything`).set(clientHeaders);

const PROA_IDS = [proaPatient1Resource.id, proaObservation1Resource.id];

describe('D-SAE6 (fail-by-design) — a client can grant itself consent', () => {
    beforeEach(async () => { await commonBeforeEach(); cursorSpy.mockReturnThis(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: no consent means no upstream records', async () => {
        const request = await seed();
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });

    test('SECURE (fails until SAE-6 enforced): a client cannot unlock upstream data with a consent it wrote itself', async () => {
        const request = await seed();
        const selfGrant = variant({ status: 'active', period: CURRENT });
        selfGrant.id = 'sae6SelfGrant';
        const put = await request.put('/4_0_0/Consent/sae6SelfGrant')
            .send(selfGrant).set(clientWriteHeaders);

        if ([200, 201].includes(put.status)) {
            const got = resIds(await everythingAsClient(request));
            for (const id of PROA_IDS) expect(got).not.toContain(id);
        } else {
            expect([400, 403, 422]).toContain(put.status);
        }
    });

    test('SECURE (fails until SAE-6 enforced): and the same consent written by the client does not unlock a second patient', async () => {
        const request = await seed();
        const selfGrant = variant({ status: 'active', period: CURRENT });
        selfGrant.id = 'sae6SelfGrant2';
        selfGrant.patient = { reference: `Patient/${proaPatient2Resource.id}` };
        const put = await request.put('/4_0_0/Consent/sae6SelfGrant2')
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
