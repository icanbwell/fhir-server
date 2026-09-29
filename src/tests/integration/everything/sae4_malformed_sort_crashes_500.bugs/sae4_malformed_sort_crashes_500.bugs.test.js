// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 SAE-4 (mongo-only; no ClickHouse).
// Gap: a `_sort` value of `$$$` returns a raw 500 instead of a 4xx. A crash is
// a robustness concern on its own, and a 500 is the response most likely to
// carry a stack trace, so it's the most likely place for internal detail to
// leak (the response BODY is checked here too, and passes today -- no detail
// currently appears in it, but the status code itself should not be a 500).
//
// The other malformed-parameter shapes below are included as controls: they
// already return a proper 4xx today and must keep doing so. Only `_sort=$$$`
// is the fail-by-design SECURE assertion.
//
// Asserts the SECURE outcome; if `_sort=$$$` still 500s, this FAILS. *.bugs,
// excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const ownA = {
    resourceType: 'Patient', id: 'sae4OwnA',
    meta: {
        source: 'tenanta',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'tenanta' },
            { system: 'https://www.icanbwell.com/access', code: 'tenanta' }
        ]
    },
    gender: 'female', birthDate: '1985-06-15'
};

const headersA = { ...getHeaders('user/*.read access/tenanta.*'), prefer: 'global_id=false' };

async function seed () {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send([ownA]).set(getHeaders());
    return request;
}

const CONTROL_QUERIES = [
    '/4_0_0/Patient?birthdate=not-a-date',
    '/4_0_0/Patient?_count=notanumber',
    '/4_0_0/Patient?_security=missing-separator',
    '/4_0_0/Observation?subject:Patient._id[$ne]=x',
    '/4_0_0/Patient?_lastUpdated=garbage',
    '/4_0_0/Patient?_total=nonsense'
];

describe('D-SAE4 (fail-by-design) — a malformed _sort value returns 500 instead of a 4xx', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    for (const q of CONTROL_QUERIES) {
        test(`control: ${q} already returns a client error, not 500`, async () => {
            const request = await seed();
            const resp = await request.get(q).set(headersA);
            expect(resp.status).toBeLessThan(500);
        });
    }

    test('SECURE (fails until SAE-4 enforced): /4_0_0/Patient?_sort=$$$ returns a client error, not 500', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient?_sort=$$$').set(headersA);
        expect(resp.status).toBeLessThan(500);
    });
});
