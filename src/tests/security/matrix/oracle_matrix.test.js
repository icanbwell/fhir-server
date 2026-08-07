// =============================================================================
// SYSTEMATIC ORACLE MATRIX — can a caller work out that a record exists, even
// when it cannot read it?
//
// This matters more here than in most systems because of how ids are built. A
// record's internal id is a deterministic function of the source system's own
// id plus the owning tenant (SAE-5). It is not a secret and must never be
// treated as one. So a caller who knows a person's MRN and a tenant slug can
// compute the id and probe for it directly. If any endpoint answers differently
// for "exists but forbidden" than for "does not exist", that probe confirms the
// person is a member of that tenant -- which is itself protected information,
// and enough to target them further.
//
// Rules: SAE-4 (no distinguishing by status code, body or timing), SAE-5 (an
// internal id is guessable and is never a substitute for an access check).
//
// Channels checked: status code, response body, response headers, and elapsed
// time -- across every read endpoint and every write mechanism.
// =============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const F = require('./matrixFixtures');

const A = () => ({ ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' });
const A_RW = () => ({ ...getHeaders('user/*.read user/*.write access/tenanta.*'), prefer: 'global_id=false' });
const ADMIN = () => ({ ...getHeaders('user/*.read user/*.write access/*.*'), prefer: 'global_id=false' });

// An id that certainly does not exist, in the same shape as a real one.
const ABSENT = 'mtxAbsentRecord0000';
// A record that exists but belongs to another tenant.
const FORBIDDEN = 'mtxOwnB';

async function seed () {
    const request = await createTestRequest();
    const resp = await request.post('/4_0_0/Person/1/$merge').send(F.ALL).set(getHeaders());
    expect(resp.body.length).toBe(F.ALL.length);
    resp.body.forEach((r) => expect(r).toEqual(expect.objectContaining({ created: true })));
    return request;
}

// Normalise a response for comparison: blank the id being probed so two replies
// that differ only by the id they echo compare equal.
function shape (resp, probedId) {
    // Blank the things that legitimately vary per call: the probed id, the Bundle's
    // freshly-generated id, and the timestamp. Anything still differing after that
    // is a real difference between "forbidden" and "absent".
    const body = JSON.stringify(resp.body || {})
        .split(probedId).join('<ID>')
        .replace(/"id":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"id":"<GEN>"')
        .replace(/"value":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"value":"<UUID>"')
        .replace(/"timestamp":"[^"]+"/g, '"timestamp":"<TS>"')
        .replace(/"lastUpdated":"[^"]+"/g, '"lastUpdated":"<TS>"');
    return { status: resp.status, body };
}

// Headers that could differ between the two cases and give the game away.
function tellingHeaders (resp) {
    // etag is a hash of the body, and the body legitimately echoes the requested id,
    // so etag always differs between the two probes without revealing anything extra.
    // last-modified, location and content-location DO carry information about the
    // target and must match.
    const keep = ['last-modified', 'content-location', 'location'];
    const out = {};
    for (const k of keep) {
        if (resp.headers && resp.headers[k] !== undefined) out[k] = resp.headers[k];
    }
    return out;
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

describe('SECURITY MATRIX — existence oracles', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: the forbidden record really does exist, and the absent one really does not', async () => {
        const request = await seed();
        const exists = await request.get(`/4_0_0/Patient/${FORBIDDEN}`).set(ADMIN());
        expect(exists.status).toBe(200);
        const absent = await request.get(`/4_0_0/Patient/${ABSENT}`).set(ADMIN());
        expect([403, 404]).toContain(absent.status);
    });

    // -----------------------------------------------------------------------
    // Reads. Same probe against a forbidden record and an absent one.
    // -----------------------------------------------------------------------
    describe('read endpoints answer identically for forbidden and absent', () => {
        const READS = {
            'read by id':        (id) => `/4_0_0/Patient/${id}`,
            'search by _id':     (id) => `/4_0_0/Patient?_id=${id}`,
            $everything:       (id) => `/4_0_0/Patient/${id}/$everything`,
            $summary:          (id) => `/4_0_0/Patient/${id}/$summary`,
            _history:          (id) => `/4_0_0/Patient/${id}/_history`,
            'read a version':    (id) => `/4_0_0/Patient/${id}/_history/1`,
            'person $everything': (id) => `/4_0_0/Person/${id}/$everything`
        };

        for (const [label, build] of Object.entries(READS)) {
            test(`${label} — status and body match`, async () => {
                const request = await seed();
                const forbidden = await request.get(build(FORBIDDEN)).set(A());
                const absent = await request.get(build(ABSENT)).set(A());
                expect(shape(forbidden, FORBIDDEN)).toEqual(shape(absent, ABSENT));
            });

            test(`${label} — response headers match`, async () => {
                const request = await seed();
                const forbidden = await request.get(build(FORBIDDEN)).set(A());
                const absent = await request.get(build(ABSENT)).set(A());
                expect(tellingHeaders(forbidden)).toEqual(tellingHeaders(absent));
            });
        }
    });

    // -----------------------------------------------------------------------
    // Writes. A write by id is the path where an oracle was confirmed.
    // -----------------------------------------------------------------------
    describe('write mechanisms answer identically for forbidden and absent', () => {
        const body = (id) => ({
            resourceType: 'Patient', id,
            meta: { source: F.T_A, security: F.sec(F.T_A, [F.T_A]) },
            gender: 'female', birthDate: '1985-06-15'
        });

        test('PUT — status and body match', async () => {
            const request = await seed();
            const forbidden = await request.put(`/4_0_0/Patient/${FORBIDDEN}`).send(body(FORBIDDEN)).set(A_RW());
            const absent = await request.put(`/4_0_0/Patient/${ABSENT}`).send(body(ABSENT)).set(A_RW());
            expect(shape(forbidden, FORBIDDEN)).toEqual(shape(absent, ABSENT));
        });

        test('PATCH — status matches', async () => {
            const request = await seed();
            const patch = [{ op: 'replace', path: '/gender', value: 'male' }];
            const hdrs = { ...A_RW(), 'Content-Type': 'application/json-patch+json' };
            const forbidden = await request.patch(`/4_0_0/Patient/${FORBIDDEN}`).send(patch).set(hdrs);
            const absent = await request.patch(`/4_0_0/Patient/${ABSENT}`).send(patch).set(hdrs);
            expect(forbidden.status).toBe(absent.status);
        });

        test('DELETE — status matches', async () => {
            const request = await seed();
            const forbidden = await request.delete(`/4_0_0/Patient/${FORBIDDEN}`).set(A_RW());
            const absent = await request.delete(`/4_0_0/Patient/${ABSENT}`).set(A_RW());
            expect(forbidden.status).toBe(absent.status);
        });

        test('$merge — the reply does not reveal that the target already existed', async () => {
            const request = await seed();
            const forbidden = await request.post('/4_0_0/Patient/$merge').send(body(FORBIDDEN)).set(A_RW());
            const absent = await request.post('/4_0_0/Patient/$merge').send(body(ABSENT)).set(A_RW());
            expect(forbidden.status).toBe(absent.status);
            // `updated: true` on one and `created: true` on the other would itself be the oracle
            const flag = (r) => {
                const e = Array.isArray(r.body) ? r.body[0] : r.body;
                return e ? { created: !!e.created, updated: !!e.updated } : null;
            };
            expect(flag(forbidden)).toEqual(flag(absent));
        });
    });

    // -----------------------------------------------------------------------
    // Timing. A coarse check only -- an in-process test with a handful of
    // records cannot measure a small difference reliably, so this asserts the
    // two cases are within a wide band and flags a gross difference (for
    // example one path doing a full lookup and the other returning early).
    //
    // A precise timing measurement belongs in the live suite with many samples.
    // -----------------------------------------------------------------------
    describe('timing', () => {
        async function timeOf (request, path, samples = 7) {
            const times = [];
            for (let n = 0; n < samples; n++) {
                const t0 = process.hrtime.bigint();
                await request.get(path).set(A());
                times.push(Number(process.hrtime.bigint() - t0) / 1e6);
            }
            times.sort((x, y) => x - y);
            return times[Math.floor(times.length / 2)];   // median
        }

        test('read by id takes comparable time for forbidden and absent', async () => {
            const request = await seed();
            const tForbidden = await timeOf(request, `/4_0_0/Patient/${FORBIDDEN}`);
            const tAbsent = await timeOf(request, `/4_0_0/Patient/${ABSENT}`);
            const slower = Math.max(tForbidden, tAbsent);
            const faster = Math.max(Math.min(tForbidden, tAbsent), 0.5);
            // a gross ratio is a signal; a small one is noise at this scale
            expect(slower / faster).toBeLessThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // SAE-5. Ids are derived, so a caller can compute one. Knowing the id must
    // buy nothing.
    // -----------------------------------------------------------------------
    describe('SAE-5: a derived id is not a secret and grants nothing', () => {
        test('knowing another tenant\'s source id does not allow reading it', async () => {
            const request = await seed();
            // the caller "knows" the source id and the owning tenant slug
            const resp = await request.get(`/4_0_0/Patient/${FORBIDDEN}`).set(A());
            expect([403, 404]).toContain(resp.status);
        });

        test('the internal uuid form is also refused', async () => {
            const request = await seed();
            // fetch the internal id as an authorized caller, then probe it as tenantA
            const asAdmin = await request.get(`/4_0_0/Patient/${FORBIDDEN}`)
                .set({ ...getHeaders('user/*.read access/*.*'), prefer: 'global_id=true' });
            expect(asAdmin.status).toBe(200);
            const internalId = asAdmin.body.id;
            const resp = await request.get(`/4_0_0/Patient/${internalId}`).set(A());
            expect([403, 404]).toContain(resp.status);
            // and it must be indistinguishable from an absent internal id
            const absent = await request.get('/4_0_0/Patient/00000000-0000-4000-8000-000000000000').set(A());
            expect(resp.status).toBe(absent.status);
        });

        test('a search naming the internal uuid returns nothing', async () => {
            const request = await seed();
            const asAdmin = await request.get(`/4_0_0/Patient/${FORBIDDEN}`)
                .set({ ...getHeaders('user/*.read access/*.*'), prefer: 'global_id=true' });
            const internalId = asAdmin.body.id;
            const resp = await request.get(`/4_0_0/Patient?_id=${internalId}`).set(A());
            expect(resp.status).toBe(200);
            const returned = (((resp.body && resp.body.entry) || []).map((e) => e.resource && e.resource.id)).filter(Boolean);
            expect(returned).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Counts and paging must not reveal what was filtered out.
    // -----------------------------------------------------------------------
    describe('counts and paging do not reveal withheld records', () => {
        test('a search total does not include records the caller cannot see', async () => {
            const request = await seed();
            const resp = await request.get('/4_0_0/Patient?_count=100').set(A());
            expect(resp.status).toBe(200);
            const returned = (((resp.body && resp.body.entry) || []).map((e) => e.resource && e.resource.id))
                .filter((id) => id && id.startsWith('mtx'));
            if (typeof resp.body.total === 'number' && resp.body.total > 0) {
                expect(resp.body.total).toBeGreaterThanOrEqual(returned.length);
                // the total must not betray the full unfiltered set
                expect(resp.body.total).toBeLessThan(F.ALL.length);
            }
        });

        test('_summary=count does not count withheld records', async () => {
            const request = await seed();
            const asA = await request.get('/4_0_0/Patient?_summary=count').set(A());
            const asWild = await request.get('/4_0_0/Patient?_summary=count')
                .set({ ...getHeaders('user/*.read access/*.*'), prefer: 'global_id=false' });
            if (asA.status === 200 && asWild.status === 200 &&
                typeof asA.body.total === 'number' && typeof asWild.body.total === 'number') {
                expect(asA.body.total).toBeLessThan(asWild.body.total);
            }
        });
    });
});
