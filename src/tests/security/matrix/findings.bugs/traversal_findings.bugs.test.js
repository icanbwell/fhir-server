// =============================================================================
// TRAVERSAL GAPS — two link-graph behaviors that widen results beyond the target
// state. Each test states the target outcome and fails until the behavior matches
// it. Quarantined; run directly with:
//   npx jest src/tests/security/matrix/findings.bugs
//
// 1. SAME-OWNER PERSON HOP IS FOLLOWED
//    Two Person records owned by the same tenant, linked to each other, are
//    walked as if they were the same human. The traversal goes person to person
//    four deep and never compares owners. Because both records carry that
//    tenant's tag, the access filter doesn't stop it either -- so one person's
//    patients show up under another's aggregate view.
//
//    A same-owner link means one of two things, and neither should be walked: a
//    duplicate-identity data defect, or a Health Circle relationship that no
//    access-control layer governs yet. Owner equality is the only signal
//    available to tell those apart from a legitimate cross-tenant link.
//
// 2. LINK CONFIDENCE IS IGNORED
//    Person.link carries an `assurance` value recording how confident the
//    identity match was. Nothing reads it. A level1 match -- the weakest -- is
//    merged into the aggregate view exactly like a level4 one, so a bad match
//    attaches someone else's records with no signal that it was a guess.
//
//    TODO(product): the spec doesn't define the threshold. These tests use the
//    strictest reading, that level1 must not merge. Once a threshold is agreed,
//    change the level constants here to match it.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('../matrixFixtures');

const T_A = F.T_A;
const A = () => ({ ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' });
const WILD = () => ({ ...getHeaders('user/*.read access/*.*'), prefer: 'global_id=false' });

function pat (id, owner, accessCodes) {
    return { resourceType: 'Patient', id, meta: { source: owner, security: F.sec(owner, accessCodes) },
        gender: 'female', birthDate: '1985-06-15' };
}
function obs (id, owner, accessCodes, patientId) {
    return { resourceType: 'Observation', id, meta: { source: owner, security: F.sec(owner, accessCodes) },
        status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] },
        subject: { reference: `Patient/${patientId}|${owner}` } };
}
function per (id, owner, accessCodes, links) {
    return { resourceType: 'Person', id, meta: { source: owner, security: F.sec(owner, accessCodes) },
        gender: 'female', birthDate: '1985-06-15',
        link: links.map((l) => ({
            target: { reference: `${l.type}/${l.ref}|${l.saa}`, type: l.type },
            assurance: l.assurance || 'level4'
        })) };
}
function resIds (resp) {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
}
async function seedThese (resources) {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(resources).set(getHeaders());
    expect(resp.body.length).toBe(resources.length);
    resp.body.forEach((r) => expect(r).toEqual(expect.objectContaining({ created: true })));
    return request;
}

describe('FINDING — a same-owner person hop is followed', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    const patA = pat('trvfSoPatA', T_A, [T_A]);
    const patC = pat('trvfSoPatC', T_A, [T_A]);
    const obsC = obs('trvfSoObsC', T_A, [T_A], 'trvfSoPatC');
    const perA = per('trvfSoPersonA', T_A, [T_A], [
        { ref: 'trvfSoPatA', type: 'Patient', saa: T_A },
        { ref: 'trvfSoPersonC', type: 'Person', saa: T_A }
    ]);
    const perC = per('trvfSoPersonC', T_A, [T_A], [{ ref: 'trvfSoPatC', type: 'Patient', saa: T_A }]);
    const all = [patA, patC, obsC, perA, perC];

    test('control: the caller reaches its own directly-linked patient', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Person/trvfSoPersonA/$everything').set(A());
        expect(resp.status).toBe(200);
        expect(resIds(resp)).toContain('trvfSoPatA');
    });

    test('control: the second person\'s patient exists and is reachable through its own person', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Person/trvfSoPersonC/$everything').set(A());
        expect(resIds(resp)).toContain('trvfSoPatC');
    });

    test('SECURE: the second same-owner person\'s patient is not reached from the first', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Person/trvfSoPersonA/$everything').set(A());
        const got = resIds(resp);
        expect(got).not.toContain('trvfSoPatC');
        expect(got).not.toContain('trvfSoObsC');
    });

    test('SECURE: it is not reached through the proxy-patient route either', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Observation?patient=Patient/person.trvfSoPersonA').set(A());
        expect(resIds(resp)).not.toContain('trvfSoObsC');
    });

    test('SECURE: a chain of three same-owner persons does not accumulate patients', async () => {
        const patD = pat('trvfSoPatD', T_A, [T_A]);
        const perD = per('trvfSoPersonD', T_A, [T_A], [{ ref: 'trvfSoPatD', type: 'Patient', saa: T_A }]);
        const perCChain = per('trvfSoPersonC', T_A, [T_A], [
            { ref: 'trvfSoPatC', type: 'Patient', saa: T_A },
            { ref: 'trvfSoPersonD', type: 'Person', saa: T_A }
        ]);
        const request = await seedThese([patA, patC, obsC, patD, perA, perCChain, perD]);
        const resp = await request.get('/4_0_0/Person/trvfSoPersonA/$everything').set(A());
        const got = resIds(resp);
        expect(got).not.toContain('trvfSoPatC');
        expect(got).not.toContain('trvfSoPatD');
    });
});

describe('FINDING — link confidence (assurance) is ignored', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    const high = pat('trvfAsHigh', 'upsrcf', ['upsrcf', T_A]);
    const low = pat('trvfAsLow', 'upsrcf', ['upsrcf', T_A]);
    const oHigh = obs('trvfAsObsHigh', 'upsrcf', ['upsrcf', T_A], 'trvfAsHigh');
    const oLow = obs('trvfAsObsLow', 'upsrcf', ['upsrcf', T_A], 'trvfAsLow');
    const person = per('trvfAsPerson', T_A, [T_A], [
        { ref: 'trvfAsHigh', type: 'Patient', saa: 'upsrcf', assurance: 'level4' },
        { ref: 'trvfAsLow', type: 'Patient', saa: 'upsrcf', assurance: 'level1' }
    ]);
    const all = [high, low, oHigh, oLow, person];

    test('control: the high-confidence link is followed', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Person/trvfAsPerson/$everything').set(A());
        expect(resp.status).toBe(200);
        expect(resIds(resp)).toContain('trvfAsHigh');
    });

    test('control: both linked records exist and reach a wildcard caller', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Person/trvfAsPerson/$everything').set(WILD());
        expect(resIds(resp)).toContain('trvfAsLow');
    });

    test('SECURE: a level1 link is not merged into the aggregate view', async () => {
        const request = await seedThese(all);
        const resp = await request.get('/4_0_0/Person/trvfAsPerson/$everything').set(A());
        const got = resIds(resp);
        expect(got).not.toContain('trvfAsLow');
        expect(got).not.toContain('trvfAsObsLow');
    });

    test('SECURE: a level2 link is not merged either', async () => {
        const l2 = pat('trvfAsL2', 'upsrcf', ['upsrcf', T_A]);
        const p = per('trvfAsPerson2', T_A, [T_A], [
            { ref: 'trvfAsHigh', type: 'Patient', saa: 'upsrcf', assurance: 'level4' },
            { ref: 'trvfAsL2', type: 'Patient', saa: 'upsrcf', assurance: 'level2' }
        ]);
        const request = await seedThese([high, oHigh, l2, p]);
        const resp = await request.get('/4_0_0/Person/trvfAsPerson2/$everything').set(A());
        expect(resIds(resp)).not.toContain('trvfAsL2');
    });

    test('SECURE: a link with no assurance value at all is not treated as high confidence', async () => {
        const noAss = pat('trvfAsNone', 'upsrcf', ['upsrcf', T_A]);
        const p = {
            resourceType: 'Person', id: 'trvfAsPerson3',
            meta: { source: T_A, security: F.sec(T_A, [T_A]) },
            link: [
                { target: { reference: `Patient/trvfAsHigh|upsrcf`, type: 'Patient' }, assurance: 'level4' },
                { target: { reference: `Patient/trvfAsNone|upsrcf`, type: 'Patient' } }
            ]
        };
        const request = await seedThese([high, oHigh, noAss, p]);
        const resp = await request.get('/4_0_0/Person/trvfAsPerson3/$everything').set(A());
        expect(resIds(resp)).not.toContain('trvfAsNone');
    });
});
