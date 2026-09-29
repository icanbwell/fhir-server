// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 IDG-5 (mongo-only; no ClickHouse).
// Gap: naming another tenant's person id as the `patient=Patient/person.<id>` proxy
// on a plain search runs the link traversal. The per-resource access-tag filter
// still applies, so no record the caller couldn't otherwise read comes back --
// but the caller learns which of its own readable records hang off that foreign
// person, i.e. it confirms link-graph membership for a person it doesn't own.
// The owner check that would stop this today only runs for $everything on a GET.
//
// Setup: personA (tenant A) links to its own patient. personB (tenant B) links to
// a SHARED_AB patient -- owned by tenant B but tagged so tenant A can also read it
// directly (a normal, legitimate sharing arrangement). Tenant A can read that
// shared Observation on its own merits; the bug is that naming personB confirms
// it's linked to personB specifically, which tenant A has no right to know.
//
// Asserts the SECURE outcome; if the foreign-person hop is followed, the shared
// record is returned and this FAILS. *.bugs, excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const ta = () => [
    { system: 'https://www.icanbwell.com/owner', code: 'tenanta' },
    { system: 'https://www.icanbwell.com/access', code: 'tenanta' }
];
const sharedAB = () => [
    { system: 'https://www.icanbwell.com/owner', code: 'tenantb' },
    { system: 'https://www.icanbwell.com/access', code: 'tenanta' },
    { system: 'https://www.icanbwell.com/access', code: 'tenantb' }
];
const tb = () => [
    { system: 'https://www.icanbwell.com/owner', code: 'tenantb' },
    { system: 'https://www.icanbwell.com/access', code: 'tenantb' }
];

const personA = {
    resourceType: 'Person', id: 'idg5PersonA', meta: { source: 'tenanta', security: ta() },
    link: [{ target: { reference: 'Patient/idg5OwnA', type: 'Patient' }, assurance: 'level4' }]
};
const ownA = { resourceType: 'Patient', id: 'idg5OwnA', meta: { source: 'tenanta', security: ta() }, gender: 'female', birthDate: '1985-06-15' };
const obsOwnA = {
    resourceType: 'Observation', id: 'idg5ObsOwnA', meta: { source: 'tenanta', security: ta() },
    status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] },
    subject: { reference: 'Patient/idg5OwnA' }
};

const personB = {
    resourceType: 'Person', id: 'idg5PersonB', meta: { source: 'tenantb', security: tb() },
    link: [{ target: { reference: 'Patient/idg5SharedAB', type: 'Patient' }, assurance: 'level4' }]
};
const sharedABPatient = { resourceType: 'Patient', id: 'idg5SharedAB', meta: { source: 'tenantb', security: sharedAB() }, gender: 'female', birthDate: '1985-06-15' };
const obsSharedAB = {
    resourceType: 'Observation', id: 'idg5ObsSharedAB', meta: { source: 'tenantb', security: sharedAB() },
    status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] },
    subject: { reference: 'Patient/idg5SharedAB' }
};

const all = [personA, ownA, obsOwnA, personB, sharedABPatient, obsSharedAB];
const headersA = { ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' };
const ids = (resp) => {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
};

describe('D-IDG5 (fail-by-design) — naming a foreign person must not confirm link-graph membership', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: naming its OWN person returns its own records', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.idg5PersonA').set(headersA);
        expect(ids(resp)).toContain('idg5ObsOwnA');
    });

    test('SECURE (fails until IDG-5 enforced): naming another tenant\'s person returns nothing', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.idg5PersonB').set(headersA);
        if (resp.status === 200) {
            expect(ids(resp)).toEqual([]);
        } else {
            expect([403, 404]).toContain(resp.status);
        }
    });

    test('SECURE (fails until IDG-5 enforced): the same holds for Patient search through a foreign person', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Person/1/$merge').send(all).set(getHeaders());
        const resp = await request.get('/4_0_0/Patient?_id=person.idg5PersonB').set(headersA);
        expect(ids(resp)).toEqual([]);
    });
});
