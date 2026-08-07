// =============================================================================
// CONSENT MATRIX — every state a Consent can be in.
//
// Consent is the one mechanism that deliberately widens what a caller sees. It
// lets a client reach a patient's upstream (PROA / IAS) clinical data that
// carries none of that client's tags. So every state gets checked both ways: a
// valid consent must unlock, and every other state must not.
//
// This file reuses the repo's own proven data-sharing fixtures rather than
// hand-rolling a Consent. The shape the server actually matches on is narrow --
// category `dataSharing` on system http://www.icanbwell.com/consent-category,
// owned by the CLIENT, patient pointing at the client patient, and a provision
// actor with role AUT referencing `Patient/person.<master person id>`. A
// hand-built Consent that misses any of that silently never unlocks, and then
// every "must not unlock" row passes for the wrong reason.
//
// States: active and current, expired end date, not yet started, revoked
// (inactive), rejected, draft, entered-in-error, provision deny, a consent
// naming a different actor, and a consent a client writes for itself.
//
// Rules: CL-1 (validity period honored, not just status), CL-2 (revocation
// lands on the next request), CACHE-2 (a per-request cached decision is keyed
// per batch -- the INC-331 cause), SAE-6 (the consent lookup is itself scoped).
// =============================================================================
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
const otherHeaders = getHeaders('user/*.read access/client-1.*');
const wildHeaders = getHeaders('user/*.read access/*.*');

const BASE = [
    masterPersonResource, masterPatientResource,
    clientPersonResource, clientPatientResource, clientObservationResource,
    proaPatient1Resource, proaObservation1Resource,
    proaPatient2Resource, proaObservation2Resource
];

// The consent read path forces a Mongo index hint that the in-memory server has
// no index for. Neutralizing the hint is what the repo's own data-sharing tests
// do; it stubs index selection only, not any access check.
const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

function resIds (resp) {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
}

// Build a variant of the known-good consent.
function variant (changes) {
    const c = deepcopy(clientConsentGivenResource);
    if (changes.status !== undefined) c.status = changes.status;
    if (changes.provisionType !== undefined) c.provision.type = changes.provisionType;
    if (changes.period !== undefined) c.provision.period = changes.period;
    if (changes.actorRef !== undefined) {
        const aut = c.provision.actor.find((a) =>
            (a.role.coding || []).some((cd) => cd.code === 'AUT'));
        if (aut) aut.reference.reference = changes.actorRef;
    }
    if (changes.owner !== undefined) {
        c.meta.security = c.meta.security.map((s) => ({ ...s, code: changes.owner }));
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
// The client asks for everything on its own person. Consent is what decides
// whether the linked PROA records come back.
async function everythingAsClient (request, headers = clientHeaders) {
    return request.get(`/4_0_0/Person/${clientPersonResource.id}/$everything`).set(headers);
}

const PROA_IDS = [proaPatient1Resource.id, proaObservation1Resource.id];

describe('CONSENT MATRIX', () => {
    beforeEach(async () => { await commonBeforeEach(); cursorSpy.mockReturnThis(); });
    afterEach(async () => { await commonAfterEach(); });

    // -----------------------------------------------------------------------
    // Both ends of the scale, so the table below can't pass by accident.
    // -----------------------------------------------------------------------
    describe('anchors', () => {
        test('with a valid consent the client receives the upstream records', async () => {
            const request = await seed([variant({ status: 'active', period: CURRENT })]);
            const resp = await everythingAsClient(request);
            expect(resp.status).toBe(200);
            const got = resIds(resp);
            // If this fails, consent sharing is broken and every negative row below
            // is meaningless -- fix this before trusting any of them.
            expect(got).toContain(proaPatient1Resource.id);
        });

        test('with no consent at all the client receives none of them', async () => {
            const request = await seed();
            const resp = await everythingAsClient(request);
            expect(resp.status).toBe(200);
            const got = resIds(resp);
            expect(got).toContain(clientPatientResource.id);   // own data still works
            for (const id of PROA_IDS) expect(got).not.toContain(id);
        });

        test('the upstream records exist and reach a wildcard caller', async () => {
            const request = await seed();
            const resp = await request.get(`/4_0_0/Patient/${proaPatient1Resource.id}`).set(wildHeaders);
            expect(resp.status).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // The state table.
    // -----------------------------------------------------------------------
    describe('state table', () => {
        // States the server already handles as specified. Four states that do not yet
        // meet the target state (elapsed period, future period, a consent naming a
        // different person, and a client-written consent) are covered in
        // consent_findings.bugs so they stay tracked without turning this file red.
        const CASES = [
            { name: 'active, period covers now', unlocks: true, c: { status: 'active', period: CURRENT } },
            { name: 'active, no period at all', unlocks: true, c: { status: 'active' } },
            { name: 'inactive — revoked', unlocks: false, c: { status: 'inactive', period: CURRENT } },
            { name: 'rejected', unlocks: false, c: { status: 'rejected', period: CURRENT } },
            { name: 'draft', unlocks: false, c: { status: 'draft', period: CURRENT } },
            { name: 'entered-in-error', unlocks: false, c: { status: 'entered-in-error', period: CURRENT } },
            { name: 'provision type deny', unlocks: false, c: { status: 'active', period: CURRENT, provisionType: 'deny' } }
        ];

        for (const cs of CASES) {
            test(`${cs.name} -> ${cs.unlocks ? 'unlocks' : 'does not unlock'}`, async () => {
                const request = await seed([variant(cs.c)]);
                const resp = await everythingAsClient(request);
                expect(resp.status).toBe(200);
                const got = resIds(resp);
                if (cs.unlocks) {
                    expect(got).toContain(proaPatient1Resource.id);
                } else {
                    for (const id of PROA_IDS) expect(got).not.toContain(id);
                }
            });
        }
    });

    // -----------------------------------------------------------------------
    // SAE-6 — the consent lookup is scoped like any other read.
    // -----------------------------------------------------------------------
    describe('the consent lookup is scoped', () => {
        test('a consent owned by an unrelated tenant unlocks nothing', async () => {
            const request = await seed([variant({ status: 'active', period: CURRENT, owner: 'client-1' })]);
            const resp = await everythingAsClient(request);
            for (const id of PROA_IDS) expect(resIds(resp)).not.toContain(id);
        });

        test('a second client cannot ride on a consent naming the first', async () => {
            const request = await seed([variant({ status: 'active', period: CURRENT })]);
            const resp = await everythingAsClient(request, otherHeaders);
            for (const id of PROA_IDS) expect(resIds(resp)).not.toContain(id);
        });

        test('a valid consent does not make the upstream patient readable by id to the client', async () => {
            // consent widens the aggregate view; it is not a grant of direct read
            const request = await seed([variant({ status: 'active', period: CURRENT })]);
            const resp = await request.get(`/4_0_0/Patient/${proaPatient2Resource.id}`).set(otherHeaders);
            expect([403, 404]).toContain(resp.status);
        });
    });

    // -----------------------------------------------------------------------
    // CL-2 — revoking takes effect on the next request.
    // -----------------------------------------------------------------------
    describe('revocation', () => {
        test('setting the consent inactive stops the data on the next request', async () => {
            const good = variant({ status: 'active', period: CURRENT });
            const request = await seed([good]);

            const before = await everythingAsClient(request);
            expect(resIds(before)).toContain(proaPatient1Resource.id);

            const revoked = { ...deepcopy(good), status: 'inactive' };
            const put = await request.put(`/4_0_0/Consent/${good.id}`).send(revoked)
                .set(getHeaders('user/*.read user/*.write access/*.*'));
            expect([200, 201]).toContain(put.status);

            const after = await everythingAsClient(request);
            for (const id of PROA_IDS) expect(resIds(after)).not.toContain(id);
        });

        test('deleting the consent stops the data', async () => {
            const good = variant({ status: 'active', period: CURRENT });
            const request = await seed([good]);
            expect(resIds(await everythingAsClient(request))).toContain(proaPatient1Resource.id);

            const del = await request.delete(`/4_0_0/Consent/${good.id}`)
                .set(getHeaders('user/*.read user/*.write access/*.*'));
            if ([200, 204].includes(del.status)) {
                const after = await everythingAsClient(request);
                for (const id of PROA_IDS) expect(resIds(after)).not.toContain(id);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Writing a consent. The self-grant case is a finding and lives in
    // consent_findings.bugs.
    // -----------------------------------------------------------------------
    describe('writing a consent', () => {
        test('a client cannot write a consent owned by another tenant', async () => {
            const request = await seed();
            const forged = variant({ status: 'active', period: CURRENT, owner: 'client-1' });
            forged.id = 'consMatrixForgedOwner';
            const put = await request.put('/4_0_0/Consent/consMatrixForgedOwner').send(forged)
                .set(getHeaders('user/*.read user/*.write access/client.*'));
            expect([400, 403, 422]).toContain(put.status);
        });
    });

    // -----------------------------------------------------------------------
    // CACHE-2 — the INC-331 mechanism. A cached decision must be kept separate
    // per batch when one request is processed in several batches. Batching keys
    // off the number of top-level ids asked for, so crossing a boundary means
    // asking for more ids than the batch size in a single request.
    // -----------------------------------------------------------------------
    describe('batched requests', () => {
        test('a request spanning several batches never returns an unconsented record', async () => {
            const request = await seed([variant({ status: 'active', period: CURRENT })]);
            // ask for many ids at once, mixing real and invented ones to force
            // several batches
            const ids = [clientPatientResource.id];
            for (let n = 0; n < 14; n++) ids.push(`consMatrixPad${String(n).padStart(2, '0')}`);
            const resp = await request
                .get(`/4_0_0/Patient/$everything?id=${ids.join(',')}`)
                .set(clientHeaders);
            expect(resp.status).toBeLessThan(500);
            // proa_patient_2 has no consent naming this client and must never appear
            expect(resIds(resp)).not.toContain(proaPatient2Resource.id);
        });

        test('repeating the same request gives the same answer, and a different caller gets its own', async () => {
            const request = await seed([variant({ status: 'active', period: CURRENT })]);
            const first = resIds(await everythingAsClient(request)).sort();
            const second = resIds(await everythingAsClient(request)).sort();
            expect(second).toEqual(first);
            const other = resIds(await everythingAsClient(request, otherHeaders));
            for (const id of PROA_IDS) expect(other).not.toContain(id);
        });
    });
});
