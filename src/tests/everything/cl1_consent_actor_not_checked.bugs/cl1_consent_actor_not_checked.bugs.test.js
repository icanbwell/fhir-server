// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 CL-1 (mongo-only; no ClickHouse).
// Gap: a Consent is matched on patient and owning client, but not on who
// authorized it. Repointing the provision actor (role AUT) at a completely
// different, non-existent person leaves the consent functional -- the
// authorizing party is never validated.
//
// Reuses the existing data_sharing/everything fixtures (master/client
// person+patient, PROA patient+observation, and the client_consent_given.json
// template) already committed on main.
//
// Asserts the SECURE outcome; if the consent still unlocks despite a bogus
// actor, this FAILS. *.bugs, excluded from default CI.
// ============================================================================
const masterPersonResource = require('../../data_sharing/everything/fixtures/person/master_person.json');
const masterPatientResource = require('../../data_sharing/everything/fixtures/patient/master_patient.json');
const clientPersonResource = require('../../data_sharing/everything/fixtures/person/client_person.json');
const clientPatientResource = require('../../data_sharing/everything/fixtures/patient/client_patient.json');
const clientObservationResource = require('../../data_sharing/everything/fixtures/observation/client_observation.json');
const proaPatient1Resource = require('../../data_sharing/everything/fixtures/patient/proa_patient_1.json');
const proaObservation1Resource = require('../../data_sharing/everything/fixtures/observation/proa_observation_1.json');
const clientConsentGivenResource = require('../../data_sharing/everything/fixtures/consent/client_consent_given.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');
const deepcopy = require('deepcopy');

const clientHeaders = getHeaders('user/*.read access/client.*');

const BASE = [
    masterPersonResource, masterPatientResource,
    clientPersonResource, clientPatientResource, clientObservationResource,
    proaPatient1Resource, proaObservation1Resource
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

const CURRENT = { start: '2020-01-01T00:00:00.000Z', end: '2090-12-31T23:59:59.000Z' };

async function seed (extra = []) {
    cursorSpy.mockReturnThis();
    const request = await createTestRequest((c) => c);
    const all = [...BASE, ...extra];
    const resp = await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
    expect(resp.body.length).toBe(all.length);
    return request;
}
const everythingAsClient = (request) =>
    request.get(`/4_0_0/Person/${clientPersonResource.id}/$everything`).set(clientHeaders);

const PROA_IDS = [proaPatient1Resource.id, proaObservation1Resource.id];

describe('D-CL1 (fail-by-design) — consent authorizing actor is not validated', () => {
    beforeEach(async () => { await commonBeforeEach(); cursorSpy.mockReturnThis(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: a current, valid consent unlocks the upstream records', async () => {
        const request = await seed([variant({ status: 'active', period: CURRENT })]);
        expect(resIds(await everythingAsClient(request))).toContain(proaPatient1Resource.id);
    });

    test('control: no consent means no upstream records', async () => {
        const request = await seed();
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });

    test('SECURE (fails until CL-1 enforced): a consent naming a different authorizing actor does not unlock', async () => {
        const request = await seed([variant({
            status: 'active', period: CURRENT,
            actorRef: 'Patient/person.00000000-0000-4000-8000-000000000000'
        })]);
        const got = resIds(await everythingAsClient(request));
        for (const id of PROA_IDS) expect(got).not.toContain(id);
    });
});
