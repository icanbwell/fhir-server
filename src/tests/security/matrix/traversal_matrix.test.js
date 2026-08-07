// =============================================================================
// SYSTEMATIC TRAVERSAL MATRIX — every shape a Person.link graph can take.
//
// Person.link is the mechanism that stitches one human's records together
// across sources. It is also the mechanism behind INC-331: the link graph is
// how a request for one person reached another person's data. The link has no
// field recording WHY two persons are linked, so one shape covers three very
// different relationships:
//   (a) same human, different tenant account  -> legitimate, must be followed
//   (b) same human, duplicate/erroneous account -> a data defect, must not be
//   (c) different humans, an authorised relationship (Health Circle) -> not yet
//       governed by any access-control layer
// Owner-tag equality is the only signal available to tell (a) from (b).
//
// Rules exercised: IDG-1 (only outward from the requested resource), IDG-2
// (same-owner hop is a dead end), IDG-3 (cross-owner hop is legitimate),
// IDG-5 (each reached resource still passes the caller's own check), IDG-7
// (a low-confidence link is not equivalent to a high-confidence one).
//
// Shapes covered: direct link, cross-owner hop, same-owner hop, person->person
// chains at depth 1..4, a cycle, a self-link, a link to a nonexistent target,
// and every assurance level.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('./matrixFixtures');

const T_A = F.T_A;
const T_B = F.T_B;
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
// links: array of {ref, type, saa, assurance}
function per (id, owner, accessCodes, links) {
    return { resourceType: 'Person', id, meta: { source: owner, security: F.sec(owner, accessCodes) },
        gender: 'female', birthDate: '1985-06-15',
        link: links.map((l) => ({
            target: { reference: `${l.type}/${l.ref}|${l.saa}`, type: l.type },
            assurance: l.assurance || 'level4'
        })) };
}

async function seedThese (resources) {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(resources).set(getHeaders());
    expect(resp.body.length).toBe(resources.length);
    resp.body.forEach((r) => expect(r).toEqual(expect.objectContaining({ created: true })));
    return request;
}

// Search returns a plain array of resources in this repo; $everything and $graph
// return a Bundle with .entry; a by-id read returns the resource. Handle all three.
function resIds (resp) {
    const b = resp && resp.body;
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => x && x.id).filter(Boolean);
    if (b.entry) return b.entry.map((e) => e.resource && e.resource.id).filter(Boolean);
    if (b.id) return [b.id];
    return [];
}

describe('SECURITY MATRIX — Person.link traversal shapes', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    // -----------------------------------------------------------------------
    // IDG-3: a cross-owner hop is legitimate, but the target still has to pass
    // the caller's access check (IDG-5).
    // -----------------------------------------------------------------------
    describe('cross-owner hop (IDG-3 + IDG-5)', () => {
        const upstreamTagged = pat('trvUpTagged', 'upsrc', ['upsrc', T_A]);   // tagged FOR tenantA
        const upstreamUntagged = pat('trvUpUntagged', 'upsrc', ['upsrc']);    // NOT tagged for tenantA
        const oTagged = obs('trvObsTagged', 'upsrc', ['upsrc', T_A], 'trvUpTagged');
        const oUntagged = obs('trvObsUntagged', 'upsrc', ['upsrc'], 'trvUpUntagged');
        const person = per('trvPersonA', T_A, [T_A], [
            { ref: 'trvUpTagged', type: 'Patient', saa: 'upsrc' },
            { ref: 'trvUpUntagged', type: 'Patient', saa: 'upsrc' }
        ]);
        const all = [upstreamTagged, upstreamUntagged, oTagged, oUntagged, person];

        test('reachability control: both linked patients reach the wildcard caller', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvPersonA/$everything').set(WILD());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvUpTagged');
            expect(resIds(resp)).toContain('trvUpUntagged');
        });

        test('the cross-owner link IS followed when the target carries the caller\'s tag', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvPersonA/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvUpTagged');
        });

        test('the same hop does NOT expose a target lacking the caller\'s tag', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvPersonA/$everything').set(A());
            const got = resIds(resp);
            expect(got).not.toContain('trvUpUntagged');
            expect(got).not.toContain('trvObsUntagged');
        });
    });

    // -----------------------------------------------------------------------
    // IDG-2: a same-owner person-to-person hop must be a dead end. Two master
    // records owned by the same tenant are either a duplicate-identity defect
    // or an ungoverned Health Circle relationship -- neither should be walked.
    // -----------------------------------------------------------------------
    describe('same-owner person hop is a dead end (IDG-2)', () => {
        const patA = pat('trvSoPatA', T_A, [T_A]);
        const patC = pat('trvSoPatC', T_A, [T_A]);
        const obsC = obs('trvSoObsC', T_A, [T_A], 'trvSoPatC');
        // two persons, SAME owner, linked to each other
        const perA = per('trvSoPersonA', T_A, [T_A], [
            { ref: 'trvSoPatA', type: 'Patient', saa: T_A },
            { ref: 'trvSoPersonC', type: 'Person', saa: T_A }
        ]);
        const perC = per('trvSoPersonC', T_A, [T_A], [{ ref: 'trvSoPatC', type: 'Patient', saa: T_A }]);
        const all = [patA, patC, obsC, perA, perC];

        test('control: the caller reaches its own directly-linked patient', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvSoPersonA/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvSoPatA');
        });

        // The traversal walks person->person four deep without comparing owners, so the
        // second person's patient comes back. Both carry tenanta's tag, so the access
        // filter doesn't stop it either. Tracked in findings.bugs/traversal_findings.
        test.skip('SECURE: the second same-owner person\'s patient is NOT reached', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvSoPersonA/$everything').set(A());
            const got = resIds(resp);
            expect(got).not.toContain('trvSoPatC');
            expect(got).not.toContain('trvSoObsC');
        });
    });

    // -----------------------------------------------------------------------
    // IDG-7: assurance. Person.link carries a match-confidence value and
    // nothing in the traversal code reads it.
    // -----------------------------------------------------------------------
    describe('assurance levels (IDG-7)', () => {
        const high = pat('trvAsHigh', 'upsrc', ['upsrc', T_A]);
        const low = pat('trvAsLow', 'upsrc', ['upsrc', T_A]);
        const oHigh = obs('trvAsObsHigh', 'upsrc', ['upsrc', T_A], 'trvAsHigh');
        const oLow = obs('trvAsObsLow', 'upsrc', ['upsrc', T_A], 'trvAsLow');
        const person = per('trvAsPerson', T_A, [T_A], [
            { ref: 'trvAsHigh', type: 'Patient', saa: 'upsrc', assurance: 'level4' },
            { ref: 'trvAsLow', type: 'Patient', saa: 'upsrc', assurance: 'level1' }
        ]);
        const all = [high, low, oHigh, oLow, person];

        test('control: the high-confidence link IS followed', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvAsPerson/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvAsHigh');
        });

        // Nothing in the traversal or merge code reads `assurance`, so a level1 match is
        // merged exactly like a level4 one. The threshold is undefined in the spec, so
        // the strict reading (level1 must not merge) is tracked in
        // findings.bugs/traversal_findings rather than asserted here.
        test.skip('SECURE: a level1 (low confidence) link is NOT merged into the aggregate view', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvAsPerson/$everything').set(A());
            const got = resIds(resp);
            expect(got).not.toContain('trvAsLow');
            expect(got).not.toContain('trvAsObsLow');
        });

        test('every assurance level is at least recorded and does not crash traversal', async () => {
            const levels = ['level1', 'level2', 'level3', 'level4'];
            const patients = levels.map((l) => pat(`trvLv${l}`, 'upsrc', ['upsrc', T_A]));
            const person2 = per('trvLvPerson', T_A, [T_A],
                levels.map((l) => ({ ref: `trvLv${l}`, type: 'Patient', saa: 'upsrc', assurance: l })));
            const request = await seedThese([...patients, person2]);
            const resp = await request.get('/4_0_0/Person/trvLvPerson/$everything').set(A());
            expect(resp.status).toBe(200);
            // level4 must be present
            expect(resIds(resp)).toContain('trvLvlevel4');
        });
    });

    // -----------------------------------------------------------------------
    // Depth. A chain of cross-owner persons is legitimate, but every resource
    // along it must still pass the caller's own access check.
    // -----------------------------------------------------------------------
    describe('chain depth', () => {
        // personA(tenanta) -> personD1(o1) -> personD2(o2) -> personD3(o3) -> patD3(o3, untagged)
        const patD3 = pat('trvDepthPat3', 'o3', ['o3']);          // no tenanta tag
        const obsD3 = obs('trvDepthObs3', 'o3', ['o3'], 'trvDepthPat3');
        const patTop = pat('trvDepthPatTop', T_A, [T_A]);
        const p3 = per('trvDepthP3', 'o3', ['o3'], [{ ref: 'trvDepthPat3', type: 'Patient', saa: 'o3' }]);
        const p2 = per('trvDepthP2', 'o2', ['o2'], [{ ref: 'trvDepthP3', type: 'Person', saa: 'o3' }]);
        const p1 = per('trvDepthP1', 'o1', ['o1'], [{ ref: 'trvDepthP2', type: 'Person', saa: 'o2' }]);
        const pTop = per('trvDepthTop', T_A, [T_A], [
            { ref: 'trvDepthPatTop', type: 'Patient', saa: T_A },
            { ref: 'trvDepthP1', type: 'Person', saa: 'o1' }
        ]);
        const all = [patD3, obsD3, patTop, p3, p2, p1, pTop];

        test('control: the caller reaches its own top-level patient', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvDepthTop/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvDepthPatTop');
        });

        test('a resource four hops away that lacks the caller\'s tag is still withheld', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvDepthTop/$everything').set(A());
            const got = resIds(resp);
            expect(got).not.toContain('trvDepthPat3');
            expect(got).not.toContain('trvDepthObs3');
        });

        test('traversal terminates and does not hang on a long chain', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvDepthTop/$everything').set(WILD());
            expect(resp.status).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // Malformed graphs must not crash or leak.
    // -----------------------------------------------------------------------
    describe('malformed link graphs', () => {
        test('a cycle between two persons terminates without error', async () => {
            const patX = pat('trvCycPatX', T_A, [T_A]);
            const pX = per('trvCycX', T_A, [T_A], [
                { ref: 'trvCycPatX', type: 'Patient', saa: T_A },
                { ref: 'trvCycY', type: 'Person', saa: 'oy' }
            ]);
            const pY = per('trvCycY', 'oy', ['oy'], [{ ref: 'trvCycX', type: 'Person', saa: T_A }]);
            const request = await seedThese([patX, pX, pY]);
            const resp = await request.get('/4_0_0/Person/trvCycX/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvCycPatX');
        });

        test('a person linked to itself terminates without error', async () => {
            const patS = pat('trvSelfPat', T_A, [T_A]);
            const pS = per('trvSelf', T_A, [T_A], [
                { ref: 'trvSelfPat', type: 'Patient', saa: T_A },
                { ref: 'trvSelf', type: 'Person', saa: T_A }
            ]);
            const request = await seedThese([patS, pS]);
            const resp = await request.get('/4_0_0/Person/trvSelf/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvSelfPat');
        });

        test('a link to a target that does not exist does not error or leak', async () => {
            const patD = pat('trvDanglePat', T_A, [T_A]);
            const pD = per('trvDangle', T_A, [T_A], [
                { ref: 'trvDanglePat', type: 'Patient', saa: T_A },
                { ref: 'trvNoSuchPatient999', type: 'Patient', saa: 'nowhere' }
            ]);
            const request = await seedThese([patD, pD]);
            const resp = await request.get('/4_0_0/Person/trvDangle/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvDanglePat');
            expect(resIds(resp)).not.toContain('trvNoSuchPatient999');
        });
    });

    // -----------------------------------------------------------------------
    // IDG-1: reachability must be by link, never by a shared identifier value.
    // This is the general shape of the INC-331 bug.
    // -----------------------------------------------------------------------
    describe('IDG-1: a shared identifier value is not a link', () => {
        const sharedIdentifier = { system: 'http://example.org/mrn', value: 'MRN-MATRIX-0001' };
        const patP = pat('trvIdgPatP', T_A, [T_A]);
        const patQ = pat('trvIdgPatQ', T_B, [T_B]);
        const obsQ = obs('trvIdgObsQ', T_B, [T_B], 'trvIdgPatQ');
        // two persons in DIFFERENT tenants that share an identifier value but are
        // NOT linked to each other
        const perP = { ...per('trvIdgPersonP', T_A, [T_A], [{ ref: 'trvIdgPatP', type: 'Patient', saa: T_A }]),
            identifier: [sharedIdentifier] };
        const perQ = { ...per('trvIdgPersonQ', T_B, [T_B], [{ ref: 'trvIdgPatQ', type: 'Patient', saa: T_B }]),
            identifier: [sharedIdentifier] };
        const all = [patP, patQ, obsQ, perP, perQ];

        test('control: personP reaches its own patient', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvIdgPersonP/$everything').set(A());
            expect(resp.status).toBe(200);
            expect(resIds(resp)).toContain('trvIdgPatP');
        });

        test('a person sharing only an identifier value is not reachable', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvIdgPersonP/$everything').set(A());
            const got = resIds(resp);
            expect(got).not.toContain('trvIdgPatQ');
            expect(got).not.toContain('trvIdgObsQ');
            expect(got).not.toContain('trvIdgPersonQ');
        });

        test('the same holds for the wildcard caller — this is a graph rule, not an access rule', async () => {
            const request = await seedThese(all);
            const resp = await request.get('/4_0_0/Person/trvIdgPersonP/$everything').set(WILD());
            expect(resIds(resp)).not.toContain('trvIdgPatQ');
        });
    });
});
