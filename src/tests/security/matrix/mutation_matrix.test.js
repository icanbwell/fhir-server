// =============================================================================
// MUTATION MATRIX — things that change who can see what, without anyone making
// a read request.
//
// Every other matrix file asks "given this data, who can read it?". This one
// asks the opposite: when the data or the config changes, does visibility
// follow immediately? A cached answer that outlives the permission it was
// computed from is a leak with no attacker involved.
//
// Rules: CACHE-1 (a cached authorised view is dropped when the tags or consent
// behind it change), CL-2 and CL-3 (revocation lands promptly, and the
// invalidation is triggered by the change itself), WPI-1 (access fields are
// protected on every write mechanism).
//
// Also covers the paths that change tags in bulk. Admin runners and background
// jobs can widen visibility across many records at once and nothing watches
// them, so a bug there is both quiet and large.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('./matrixFixtures');

const T_A = F.T_A;
const T_B = F.T_B;
const A = () => ({ ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' });
const B = () => ({ ...getHeaders('user/*.read access/tenantb.*'), prefer: 'global_id=false' });
const ADMIN = () => ({ ...getHeaders('user/*.read user/*.write access/*.*'), prefer: 'global_id=false' });

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
        link: links.map((l) => ({ target: { reference: `Patient/${l.id}|${l.saa}`, type: 'Patient' }, assurance: 'level4' })) };
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

describe('MUTATION MATRIX — visibility follows a change immediately', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    // -----------------------------------------------------------------------
    // Narrowing a tag must take effect at once, on every route.
    // -----------------------------------------------------------------------
    describe('narrowing an access tag', () => {
        const shared = pat('mutShared', T_B, [T_A, T_B]);
        const sharedObs = obs('mutSharedObs', T_B, [T_A, T_B], 'mutShared');

        test('a read served before the change is not served again afterwards', async () => {
            const request = await seedThese([shared, sharedObs]);

            const before = await request.get('/4_0_0/Patient/mutShared').set(A());
            expect(before.status).toBe(200);

            const narrowed = pat('mutShared', T_B, [T_B]);
            const put = await request.put('/4_0_0/Patient/mutShared').send(narrowed).set(ADMIN());
            expect([200, 201]).toContain(put.status);

            const after = await request.get('/4_0_0/Patient/mutShared').set(A());
            expect([403, 404]).toContain(after.status);
        });

        test('the narrowed record also disappears from search', async () => {
            const request = await seedThese([shared, sharedObs]);
            const before = await request.get('/4_0_0/Patient?_count=50').set(A());
            expect(resIds(before)).toContain('mutShared');

            await request.put('/4_0_0/Patient/mutShared').send(pat('mutShared', T_B, [T_B])).set(ADMIN());

            const after = await request.get('/4_0_0/Patient?_count=50').set(A());
            expect(resIds(after)).not.toContain('mutShared');
        });

        test('and from $everything', async () => {
            const person = per('mutPerson', T_A, [T_A], [{ id: 'mutShared', saa: T_B }]);
            const request = await seedThese([shared, sharedObs, person]);

            const before = await request.get('/4_0_0/Person/mutPerson/$everything').set(A());
            const sawIt = resIds(before).includes('mutShared');

            await request.put('/4_0_0/Patient/mutShared').send(pat('mutShared', T_B, [T_B])).set(ADMIN());

            const after = await request.get('/4_0_0/Person/mutPerson/$everything').set(A());
            expect(resIds(after)).not.toContain('mutShared');
            if (sawIt) expect(resIds(after)).not.toContain('mutSharedObs');
        });

        test('repeating the identical request does not return a stale cached view', async () => {
            const request = await seedThese([shared, sharedObs]);
            // warm whatever cache exists with several identical requests
            for (let n = 0; n < 3; n++) await request.get('/4_0_0/Patient/mutShared').set(A());
            await request.put('/4_0_0/Patient/mutShared').send(pat('mutShared', T_B, [T_B])).set(ADMIN());
            for (let n = 0; n < 3; n++) {
                const r = await request.get('/4_0_0/Patient/mutShared').set(A());
                expect([403, 404]).toContain(r.status);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Widening is the mirror image, and is a functional check: if widening
    // doesn't take effect either, then the narrowing tests above pass because
    // nothing works, not because invalidation works.
    // -----------------------------------------------------------------------
    describe('widening an access tag', () => {
        test('adding a tag makes the record visible to the new tenant', async () => {
            const request = await seedThese([pat('mutWiden', T_B, [T_B])]);
            const before = await request.get('/4_0_0/Patient/mutWiden').set(A());
            expect([403, 404]).toContain(before.status);

            await request.put('/4_0_0/Patient/mutWiden').send(pat('mutWiden', T_B, [T_A, T_B])).set(ADMIN());

            const after = await request.get('/4_0_0/Patient/mutWiden').set(A());
            expect(after.status).toBe(200);
        });
    });

    // -----------------------------------------------------------------------
    // Removing a link must close the route it opened.
    // -----------------------------------------------------------------------
    describe('removing a Person.link', () => {
        test('a patient reachable only through a removed link is no longer returned', async () => {
            const upstream = pat('mutUp', 'mutsrc', ['mutsrc', T_A]);
            const upstreamObs = obs('mutUpObs', 'mutsrc', ['mutsrc', T_A], 'mutUp');
            const ownPat = pat('mutOwn', T_A, [T_A]);
            const person = per('mutLinkPerson', T_A, [T_A], [
                { id: 'mutOwn', saa: T_A },
                { id: 'mutUp', saa: 'mutsrc' }
            ]);
            const request = await seedThese([upstream, upstreamObs, ownPat, person]);

            const before = await request.get('/4_0_0/Person/mutLinkPerson/$everything').set(A());
            expect(resIds(before)).toContain('mutUp');

            const stripped = per('mutLinkPerson', T_A, [T_A], [{ id: 'mutOwn', saa: T_A }]);
            const put = await request.put('/4_0_0/Person/mutLinkPerson').send(stripped).set(ADMIN());
            expect([200, 201]).toContain(put.status);

            const after = await request.get('/4_0_0/Person/mutLinkPerson/$everything').set(A());
            expect(resIds(after)).not.toContain('mutUp');
            expect(resIds(after)).not.toContain('mutUpObs');
            expect(resIds(after)).toContain('mutOwn');       // the rest still works
        });
    });

    // -----------------------------------------------------------------------
    // Deleting a record must not leave it readable through history or search.
    // -----------------------------------------------------------------------
    describe('deleting a record', () => {
        test('a deleted record is not returned by search or by id', async () => {
            const request = await seedThese([pat('mutDelete', T_A, [T_A])]);
            const del = await request.delete('/4_0_0/Patient/mutDelete').set(ADMIN());
            expect([200, 204, 404, 405]).toContain(del.status);
            if ([200, 204].includes(del.status)) {
                const byId = await request.get('/4_0_0/Patient/mutDelete').set(A());
                expect([404, 410]).toContain(byId.status);
                const search = await request.get('/4_0_0/Patient?_count=50').set(A());
                expect(resIds(search)).not.toContain('mutDelete');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Bulk tag changes. These run outside the request path, so a mistake here
    // is silent and affects many records at once.
    //
    // The runners are invoked as scripts rather than over HTTP, so driving them
    // needs the container wiring rather than a supertest request. The check that
    // matters is stated here so it isn't lost.
    //
    // TODO: build these through createTestContainer and run the runner class
    // directly. Blocked on nothing external -- it's work, not access.
    // -----------------------------------------------------------------------
    describe('bulk tag changes', () => {
        test('a hand-built bulk widening is still refused through the API', async () => {
            // the closest thing reachable over HTTP: a batch write that tries to widen
            // several records at once
            const request = await seedThese([
                pat('mutBulk1', T_A, [T_A]),
                pat('mutBulk2', T_A, [T_A])
            ]);
            const widened = [
                pat('mutBulk1', T_A, [T_A, T_B]),
                pat('mutBulk2', T_A, [T_A, T_B])
            ];
            const resp = await request.post('/4_0_0/Patient/$merge').send(widened)
                .set({ ...getHeaders('user/*.read user/*.write access/tenanta.*'), prefer: 'global_id=false' });
            const body = JSON.stringify(resp.body || {});
            const refused = resp.status === 403 || /forbidden|not allowed|scope/i.test(body);
            expect(refused).toBe(true);
            // and tenantB must still not see either record
            for (const id of ['mutBulk1', 'mutBulk2']) {
                const asB = await request.get(`/4_0_0/Patient/${id}`).set(B());
                expect([403, 404]).toContain(asB.status);
            }
        });

        test.skip('changeSourceAssigningAuthority runner does not widen access', () => {
            // TODO: drive the runner via createTestContainer. Seed records owned by
            // tenantA, run the authority change, then assert tenantB still cannot read
            // them and that owner/access tags are unchanged except as intended.
        });

        test.skip('fixPersonLinks runner does not create a cross-tenant link', () => {
            // TODO: as above. Seed a broken link, run the fixer, assert the repaired
            // link does not point across an owner boundary and that $everything for
            // each tenant is unchanged.
        });

        test.skip('removeDuplicatePersonLink runner does not merge two different people', () => {
            // TODO: seed two persons with identical demographics and different owners,
            // run the de-duplicator, assert neither one's patients become reachable
            // from the other.
        });
    });

    // -----------------------------------------------------------------------
    // Connection enablement. Turning a connection or the record locator on
    // changes what upstream data exists for a patient, so it changes what a
    // client can see. The switch lives in configuration and other services, not
    // in a request to this server.
    //
    // TODO(live): with a connection disabled, assert the client sees no upstream
    // records for the patient; enable it, assert the records appear only where a
    // consent permits, and that no other tenant's view changes. Needs a service
    // account plus the ability to toggle a connection in the environment.
    // -----------------------------------------------------------------------
    describe('connection and record-locator enablement', () => {
        test.skip('enabling a connection only widens the consenting client\'s view', () => {
            // see TODO(live) above
        });
    });

    // -----------------------------------------------------------------------
    // Consent changes are covered in consent_matrix. What belongs here is the
    // timing question: how long a revocation takes to land. In process there is
    // no shared cache with a TTL, so the answer is always "immediately" and the
    // test can't fail for the right reason.
    //
    // TODO(live): revoke a consent, then poll on a fixed interval and record how
    // long the data keeps coming back. Assert it stops within the agreed bound.
    // The specification says "a short, bounded time" without giving a number --
    // that number needs deciding before this can assert anything.
    // -----------------------------------------------------------------------
    describe('revocation timing', () => {
        test.skip('revoked consent stops returning data within the agreed bound', () => {
            // see TODO(live) above; also needs a decision on what the bound is
        });
    });
});
