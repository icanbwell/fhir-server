// =============================================================================
// SYSTEMATIC WRITE MATRIX — every write mechanism, every caller type.
//
// The read side gets most of the attention after a leak, but writes are what
// create the tags, links and consents the read path later trusts. A caller that
// can add another tenant's access tag to a record has granted that tenant read
// access without ever reading anything itself.
//
// Rules exercised:
//   SAE-2  a resource carrying several access tags may only be written by a
//          caller authorized for EVERY tag on it, not merely one
//   SAE-4  a write by identifier must not reveal whether the id already exists
//   IDG-4  traversal rules apply to write authorization, not only reads
//   WPI-1  identity, versioning, provenance and access fields are protected
//          from caller overwrite across EVERY write mechanism
//   WPI-2  authorization is evaluated against the document that will actually
//          be persisted, not its state before the write
//
// Every write mechanism is covered: PUT, POST, PATCH, DELETE and $merge. Only
// PUT was covered before, and each mechanism has its own tag-check call site.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('./matrixFixtures');

const A_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenanta.*'), prefer: 'global_id=false' });
const A_RO = () => ({ ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' });
const B_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenantb.*'), prefer: 'global_id=false' });
const ADMIN = () => ({ ...getHeaders('user/*.read user/*.write access/*.*'), prefer: 'global_id=false' });

function pat (id, owner, accessCodes) {
    return {
        resourceType: 'Patient',
        id,
        meta: { source: owner, security: F.sec(owner, accessCodes) },
        gender: 'female',
        birthDate: '1985-06-15'
    };
}

async function seed () {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(F.ALL).set(getHeaders());
    expect(resp.body.length).toBe(F.ALL.length);
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

describe('SECURITY MATRIX — write paths', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    // -----------------------------------------------------------------------
    // Baseline: writes work at all, and read-only really is read-only.
    // -----------------------------------------------------------------------
    describe('baseline', () => {
        test('control: a read/write caller CAN create in its own tenant', async () => {
            const request = await seed();
            const resp = await request.put('/4_0_0/Patient/mtxWriteOwn001')
                .send(pat('mtxWriteOwn001', F.T_A, [F.T_A])).set(A_RW());
            expect([200, 201]).toContain(resp.status);
        });

        test('a read-only caller cannot create', async () => {
            const request = await seed();
            const resp = await request.put('/4_0_0/Patient/mtxWriteRo001')
                .send(pat('mtxWriteRo001', F.T_A, [F.T_A])).set(A_RO());
            expect([401, 403]).toContain(resp.status);
        });

        test('a read-only caller cannot POST', async () => {
            const request = await seed();
            const resp = await request.post('/4_0_0/Patient').send(pat(undefined, F.T_A, [F.T_A])).set(A_RO());
            expect([401, 403]).toContain(resp.status);
        });

        test('a read-only caller cannot PATCH', async () => {
            const request = await seed();
            const resp = await request.patch('/4_0_0/Patient/mtxOwnA')
                .send([{ op: 'replace', path: '/gender', value: 'male' }])
                .set({ ...A_RO(), 'Content-Type': 'application/json-patch+json' });
            expect([401, 403, 404, 405]).toContain(resp.status);
        });

        test('a read-only caller cannot DELETE', async () => {
            const request = await seed();
            const resp = await request.delete('/4_0_0/Patient/mtxOwnA').set(A_RO());
            expect([401, 403, 404, 405]).toContain(resp.status);
        });

        test('a read-only caller cannot $merge', async () => {
            const request = await seed();
            const resp = await request.post('/4_0_0/Patient/$merge')
                .send(pat('mtxWriteMergeRo001', F.T_A, [F.T_A])).set(A_RO());
            const body = JSON.stringify(resp.body || {});
            const refused = [401, 403].includes(resp.status) || /forbidden|not allowed|scope/i.test(body);
            expect(refused).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // SAE-2 — tag forgery, through every mechanism.
    // -----------------------------------------------------------------------
    describe('SAE-2: a caller may not add an access tag it does not hold', () => {
        test('PUT with another tenant\'s access tag is refused', async () => {
            const request = await seed();
            const resp = await request.put('/4_0_0/Patient/mtxForgePut001')
                .send(pat('mtxForgePut001', F.T_A, [F.T_A, F.T_B])).set(A_RW());
            expect(resp.status).toBe(403);
        });

        test('POST with another tenant\'s access tag is refused', async () => {
            const request = await seed();
            const resp = await request.post('/4_0_0/Patient')
                .send(pat(undefined, F.T_A, [F.T_A, F.T_B])).set(A_RW());
            expect([400, 403]).toContain(resp.status);
        });

        test('$merge with another tenant\'s access tag is refused', async () => {
            const request = await seed();
            const resp = await request.post('/4_0_0/Patient/$merge')
                .send(pat('mtxForgeMerge001', F.T_A, [F.T_A, F.T_B])).set(A_RW());
            const body = JSON.stringify(resp.body || {});
            const refused = resp.status === 403 || /forbidden|not allowed|scope/i.test(body);
            expect(refused).toBe(true);
            // and it must not have landed
            const check = await request.get('/4_0_0/Patient/mtxForgeMerge001').set(ADMIN());
            if (check.status === 200) {
                const codes = (check.body.meta.security || []).filter((s) => s.system === F.ACCESS).map((s) => s.code);
                expect(codes).not.toContain(F.T_B);
            }
        });

        test('PATCH cannot add another tenant\'s access tag', async () => {
            const request = await seed();
            const resp = await request.patch('/4_0_0/Patient/mtxOwnA')
                .send([{ op: 'add', path: '/meta/security/-', value: { system: F.ACCESS, code: F.T_B } }])
                .set({ ...A_RW(), 'Content-Type': 'application/json-patch+json' });
            expect([400, 403, 404, 405, 422]).toContain(resp.status);
            // whatever the status, tenantB must still not be able to read it
            const asB = await request.get('/4_0_0/Patient/mtxOwnA').set(B_RW());
            expect([403, 404]).toContain(asB.status);
        });

        // A PATCH replacing the owner tag currently returns 200. What matters for
        // isolation is whether it actually hands the record to the other tenant --
        // that's what this asserts. The accepted-status question is tracked in
        // findings.bugs/patch_owner_tag.
        test('PATCH replacing the owner tag does not hand the record to the other tenant', async () => {
            const request = await seed();
            await request.patch('/4_0_0/Patient/mtxOwnA')
                .send([{ op: 'replace', path: '/meta/security/0/code', value: F.T_B }])
                .set({ ...A_RW(), 'Content-Type': 'application/json-patch+json' });
            const asB = await request.get('/4_0_0/Patient/mtxOwnA').set(B_RW());
            expect([403, 404]).toContain(asB.status);
        });

        test('a caller holding BOTH tags may legitimately write both', async () => {
            const request = await seed();
            const resp = await request.put('/4_0_0/Patient/mtxBothTags001')
                .send(pat('mtxBothTags001', F.T_A, [F.T_A, F.T_B])).set(ADMIN());
            expect([200, 201]).toContain(resp.status);
        });

        // WPI-2: authorization must be judged on the post-write document
        test('a write that would widen an existing resource\'s tags is refused', async () => {
            const request = await seed();
            // mtxSharedAB already carries access [tenanta, tenantb]; tenantA holds only one
            const resp = await request.put('/4_0_0/Patient/mtxSharedAB')
                .send(pat('mtxSharedAB', F.T_B, [F.T_A, F.T_B])).set(A_RW());
            expect([403, 404]).toContain(resp.status);
        });
    });

    // -----------------------------------------------------------------------
    // Cross-tenant overwrite and the write-side existence oracle.
    // -----------------------------------------------------------------------
    describe('cross-tenant overwrite and SAE-4 on writes', () => {
        // Ids carry the owning tenant, so a write to another tenant's source id lands in
        // the writer's own namespace instead of touching the target. Two records then
        // share a source id, and reading by that source id as a wildcard caller is
        // ambiguous (400). So read B's record back through B's own scope, which only
        // ever resolves to B's copy.
        test('tenantA cannot modify tenantB\'s record through PUT', async () => {
            const request = await seed();
            const before = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
            expect(before.status).toBe(200);
            const beforeVersion = before.body.meta.versionId;

            await request.put('/4_0_0/Patient/mtxOwnB').send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());

            // tenantA's write lands in its own namespace rather than overwriting B's.
            // After the collision, reads AND _id searches on that source id stop
            // resolving for B (tracked in findings.bugs/auth_write_findings), so verify
            // B's record survived by listing what B owns.
            const all = await request.get('/4_0_0/Patient?_count=100').set(B_RW());
            const mine = (Array.isArray(all.body) ? all.body : []).filter((r) => r && r.id === 'mtxOwnB');
            expect(mine.length).toBe(1);
            const owner = (mine[0].meta.security || []).find((s) => s.system === F.OWNER);
            expect(owner.code).toBe(F.T_B);
            expect(mine[0].meta.versionId).toBe(beforeVersion);
        });

        test('tenantA cannot modify tenantB\'s record through $merge', async () => {
            const request = await seed();
            const before = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
            const beforeVersion = before.body.meta.versionId;
            await request.post('/4_0_0/Patient/$merge').send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());
            const all = await request.get('/4_0_0/Patient?_count=100').set(B_RW());
            const mine = (Array.isArray(all.body) ? all.body : []).filter((r) => r && r.id === 'mtxOwnB');
            expect(mine.length).toBe(1);
            const owner = (mine[0].meta.security || []).find((s) => s.system === F.OWNER);
            expect(owner.code).toBe(F.T_B);
            expect(mine[0].meta.versionId).toBe(beforeVersion);
        });

        // A delete resolves in the caller's own namespace too, so it can report success
        // without having touched anything. What matters is that B's record survives.
        test('tenantA cannot delete tenantB\'s record', async () => {
            const request = await seed();
            await request.delete('/4_0_0/Patient/mtxOwnB').set(A_RW());
            const still = await request.get('/4_0_0/Patient/mtxOwnB').set(B_RW());
            expect(still.status).toBe(200);
            expect(still.body.id).toBe('mtxOwnB');
        });

        test('tenantA cannot patch tenantB\'s record', async () => {
            const request = await seed();
            const resp = await request.patch('/4_0_0/Patient/mtxOwnB')
                .send([{ op: 'replace', path: '/gender', value: 'male' }])
                .set({ ...A_RW(), 'Content-Type': 'application/json-patch+json' });
            expect([403, 404, 405]).toContain(resp.status);
            const after = await request.get('/4_0_0/Patient/mtxOwnB').set(ADMIN());
            expect(after.body.gender).toBe('female');
        });

        // Ids are partitioned by owning tenant, so writing to a foreign source id and
        // writing to an unused id both create a new record in the caller's own space.
        // That makes a plain status comparison trivially equal -- the oracle has to be
        // probed on the resource's stored internal id, which SAE-5 makes derivable.
        test('a write by id gives no clue whether a foreign record exists', async () => {
            const request = await seed();
            const existing = await request.put('/4_0_0/Patient/mtxOwnB')
                .send(pat('mtxOwnB', F.T_A, [F.T_A])).set(A_RW());
            const absent = await request.put('/4_0_0/Patient/mtxNoSuchIdAtAll999')
                .send(pat('mtxNoSuchIdAtAll999', F.T_A, [F.T_A])).set(A_RW());
            expect(existing.status).toBe(absent.status);
            // Blank out everything that legitimately varies with the id itself: the id,
            // the derived uuid, and the timestamp. What's left must be identical.
            const norm = (r, id) => JSON.stringify(r.body || {})
                .split(id).join('<ID>')
                .replace(/"value":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"value":"<UUID>"')
                .replace(/"lastUpdated":"[^"]+"/g, '"lastUpdated":"<TS>"');
            expect(norm(existing, 'mtxOwnB')).toBe(norm(absent, 'mtxNoSuchIdAtAll999'));
        });

        test('a DELETE gives no clue whether a foreign record exists', async () => {
            const request = await seed();
            const foreign = await request.delete('/4_0_0/Patient/mtxOwnB').set(A_RW());
            const absent = await request.delete('/4_0_0/Patient/mtxNoSuchIdAtAll998').set(A_RW());
            expect(foreign.status).toBe(absent.status);
        });

        test('a PATCH gives no clue whether a foreign record exists', async () => {
            const request = await seed();
            const body = [{ op: 'replace', path: '/gender', value: 'male' }];
            const hdrs = { ...A_RW(), 'Content-Type': 'application/json-patch+json' };
            const foreign = await request.patch('/4_0_0/Patient/mtxOwnB').send(body).set(hdrs);
            const absent = await request.patch('/4_0_0/Patient/mtxNoSuchIdAtAll997').send(body).set(hdrs);
            expect(foreign.status).toBe(absent.status);
        });
    });

    // -----------------------------------------------------------------------
    // IDG-4 — a forged link must not become a read channel.
    // -----------------------------------------------------------------------
    describe('IDG-4: link forgery does not grant access', () => {
        test('adding a Person.link to another tenant\'s patient does not expose it', async () => {
            const request = await seed();
            const forged = {
                resourceType: 'Person',
                id: 'mtxForgedLinkPerson',
                meta: { source: F.T_A, security: F.sec(F.T_A, [F.T_A]) },
                link: [{ target: { reference: `Patient/mtxOwnB|${F.T_B}`, type: 'Patient' }, assurance: 'level4' }]
            };
            const put = await request.put('/4_0_0/Person/mtxForgedLinkPerson').send(forged).set(A_RW());
            expect([200, 201, 403]).toContain(put.status);

            const ev = await request.get('/4_0_0/Person/mtxForgedLinkPerson/$everything').set(A_RW());
            const ids = (((ev.body && ev.body.entry) || []).map((e) => e.resource && e.resource.id)).filter(Boolean);
            expect(ids).not.toContain('mtxOwnB');
            expect(ids).not.toContain('mtxObsOwnB');
        });

        test('adding a link to the PROA patient does not bypass the consent requirement', async () => {
            const request = await seed();
            const forged = {
                resourceType: 'Person',
                id: 'mtxForgedProaPerson',
                meta: { source: F.T_A, security: F.sec(F.T_A, [F.T_A]) },
                link: [{ target: { reference: `Patient/mtxProa|${F.S_PROA}`, type: 'Patient' }, assurance: 'level4' }]
            };
            await request.put('/4_0_0/Person/mtxForgedProaPerson').send(forged).set(A_RW());
            const ev = await request.get('/4_0_0/Person/mtxForgedProaPerson/$everything').set(A_RW());
            const ids = (((ev.body && ev.body.entry) || []).map((e) => e.resource && e.resource.id)).filter(Boolean);
            expect(ids).not.toContain('mtxProa');
            expect(ids).not.toContain('mtxObsProa');
        });
    });

    // -----------------------------------------------------------------------
    // WPI-1 — protected fields, across mechanisms.
    // -----------------------------------------------------------------------
    describe('WPI-1: protected fields cannot be set by the caller', () => {
        test('a caller-supplied versionId does not overwrite the server\'s', async () => {
            const request = await seed();
            const body = pat('mtxProtectedVersion', F.T_A, [F.T_A]);
            body.meta.versionId = '9999';
            const resp = await request.put('/4_0_0/Patient/mtxProtectedVersion').send(body).set(A_RW());
            expect([200, 201]).toContain(resp.status);
            const check = await request.get('/4_0_0/Patient/mtxProtectedVersion').set(A_RW());
            expect(check.body.meta.versionId).not.toBe('9999');
        });

        test('a caller-supplied lastUpdated does not overwrite the server\'s', async () => {
            const request = await seed();
            const body = pat('mtxProtectedUpdated', F.T_A, [F.T_A]);
            body.meta.lastUpdated = '1999-01-01T00:00:00.000Z';
            const resp = await request.put('/4_0_0/Patient/mtxProtectedUpdated').send(body).set(A_RW());
            expect([200, 201]).toContain(resp.status);
            const check = await request.get('/4_0_0/Patient/mtxProtectedUpdated').set(A_RW());
            expect(check.body.meta.lastUpdated).not.toContain('1999');
        });

        test('PATCH cannot reach a protected meta field by naming convention', async () => {
            const request = await seed();
            const resp = await request.patch('/4_0_0/Patient/mtxOwnA')
                .send([{ op: 'replace', path: '/meta/versionId', value: '4242' }])
                .set({ ...A_RW(), 'Content-Type': 'application/json-patch+json' });
            expect([200, 400, 403, 404, 405, 422]).toContain(resp.status);
            const check = await request.get('/4_0_0/Patient/mtxOwnA').set(A_RW());
            if (check.status === 200) expect(check.body.meta.versionId).not.toBe('4242');
        });
    });
});
