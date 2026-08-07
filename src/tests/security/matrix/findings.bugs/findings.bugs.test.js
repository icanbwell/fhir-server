// =============================================================================
// GAPS — three behaviors that do not yet meet the target secure state. Each test
// states the target outcome and fails until the behavior matches it. Quarantined
// from the default run (see jest.config.js) so tracked work does not block CI.
//
// Run directly:
//   npx jest src/tests/security/matrix/findings.bugs
//
// 1. FOREIGN PERSON TRAVERSAL
//    Naming another tenant's person id on a plain search runs the link traversal.
//    The per-resource tag filter still applies, so no forbidden record comes back,
//    but the caller learns which of its own readable records hang off that
//    person -- i.e. it confirms link-graph membership for someone else's person.
//    The owner check that would stop this only runs for $everything on a GET.
//
// 2. OLD VERSIONS KEEP OLD TAGS
//    Narrowing a resource's access tags shuts the caller out of the current
//    version but not of the earlier one. Reading version 1 still succeeds, so
//    revoking access by narrowing tags doesn't revoke history.
//
// 3. END USER REACHES UPSTREAM DATA WITH NO CONSENT
//    An end-user token carries `access/*.*`, so no tenant filter applies, and
//    patient-scope expansion walks the person's links into PROA and IAS records
//    with no Consent present. Needs a product decision: the user may well be
//    entitled to their own upstream data, in which case consent governs client
//    access only and this test should be deleted. Until that's settled it stays
//    here rather than being asserted either way in the main matrix.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload, createTestRequest } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('../matrixFixtures');

const sysHeaders = (scope) => ({ ...getHeaders(scope), prefer: 'global_id=false' });
const A = () => sysHeaders('user/*.read access/tenanta.*');
const WILD = () => sysHeaders('user/*.read access/*.*');
const RW_ALL = () => sysHeaders('user/*.read user/*.write access/*.*');

const REAL_END_USER_SCOPE = 'access/*.* user/*.* patient/*.*';
function endUser (masterPersonId) {
    return {
        ...getHeadersWithCustomPayload({
            scope: REAL_END_USER_SCOPE,
            username: 'matrix-end-user@example.com',
            clientFhirPersonId: masterPersonId,
            clientFhirPatientId: 'clientFhirPatient',
            bwellFhirPersonId: masterPersonId,
            bwellFhirPatientId: 'bwellFhirPatient',
            managingOrganization: F.T_A,
            token_use: 'access'
        }),
        prefer: 'global_id=false'
    };
}

function resIds (resp) {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
}

async function seed () {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(F.ALL).set(getHeaders());
    expect(resp.body.length).toBe(F.ALL.length);
    resp.body.forEach((r) => expect(r).toEqual(expect.objectContaining({ created: true })));
    return request;
}

describe('FINDING 1 — traversal of another tenant\'s person on a plain search', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: naming its OWN person returns its own records', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.mtxPersonA').set(A());
        expect(resp.status).toBe(200);
        expect(resIds(resp)).toContain('mtxObsOwnA');
    });

    // SECURE: naming a person owned by another tenant should be refused, or return
    // nothing at all. Today it runs the traversal and returns the shared record,
    // which tells tenantA that record is linked to tenantB's person.
    test('SECURE: naming another tenant\'s person returns nothing', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.mtxPersonB').set(A());
        if (resp.status === 200) {
            expect(resIds(resp)).toEqual([]);
        } else {
            expect([403, 404]).toContain(resp.status);
        }
    });

    test('SECURE: the same holds for Patient search through a foreign person', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient?_id=person.mtxPersonB').set(A());
        expect(resIds(resp)).toEqual([]);
    });
});

describe('FINDING 2 — an older version keeps the tags it was written with', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: tenantA can read the shared record before its tags are narrowed', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/mtxSharedAB').set(A());
        expect(resp.status).toBe(200);
    });

    // SECURE: narrowing the tags must revoke access to the history too, otherwise
    // removing a tenant's access leaves every prior version readable.
    test('SECURE: after narrowing the tags, the earlier version is no longer readable', async () => {
        const request = await seed();
        const narrowed = { ...F.P.SHARED_AB, meta: { source: F.T_B, security: F.sec(F.T_B, [F.T_B]) } };
        const put = await request.put('/4_0_0/Patient/mtxSharedAB').send(narrowed).set(RW_ALL());
        expect([200, 201]).toContain(put.status);

        // current version is correctly closed off
        const current = await request.get('/4_0_0/Patient/mtxSharedAB').set(A());
        expect([403, 404]).toContain(current.status);

        // the earlier version must be too
        const v1 = await request.get('/4_0_0/Patient/mtxSharedAB/_history/1').set(A());
        expect([403, 404]).toContain(v1.status);
    });

    test('SECURE: the earlier version is not reachable through _history either', async () => {
        const request = await seed();
        const narrowed = { ...F.P.SHARED_AB, meta: { source: F.T_B, security: F.sec(F.T_B, [F.T_B]) } };
        await request.put('/4_0_0/Patient/mtxSharedAB').send(narrowed).set(RW_ALL());
        const hist = await request.get('/4_0_0/Patient/mtxSharedAB/_history').set(A());
        expect(resIds(hist)).toEqual([]);
    });
});

describe('FINDING 3 — an end user reaches linked upstream data with no Consent', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: the upstream records exist and are linked to this person', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Person/mtxPersonA/$everything').set(WILD());
        expect(resp.status).toBe(200);
        expect(resIds(resp)).toContain('mtxProa');
        expect(resIds(resp)).toContain('mtxIas');
    });

    test('control: a client service account with no consent does NOT get them', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Person/mtxPersonA/$everything').set(A());
        expect(resIds(resp)).not.toContain('mtxProa');
    });

    // SECURE, on the strict reading: no Consent, no upstream data, for any caller
    // type. TODO(product): if an end user is entitled to their own upstream data
    // without a Consent, delete this block and note the rule in the plan.
    test('SECURE: an end user gets no upstream records without a Consent', async () => {
        const request = await seed();
        const resp = await request
            .get('/4_0_0/Observation?patient=Patient/person.mtxPersonA')
            .set(endUser('mtxPersonA'));
        expect(resp.status).toBe(200);
        const got = resIds(resp);
        expect(got).not.toContain('mtxObsProa');
        expect(got).not.toContain('mtxObsIas');
    });

    test('SECURE: the same holds on $everything for an end user', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Person/mtxPersonA/$everything').set(endUser('mtxPersonA'));
        const got = resIds(resp);
        expect(got).not.toContain('mtxProa');
        expect(got).not.toContain('mtxIas');
    });
});
