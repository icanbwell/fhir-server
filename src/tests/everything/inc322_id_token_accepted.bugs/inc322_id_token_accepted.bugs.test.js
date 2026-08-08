// ============================================================================
// FAIL-BY-DESIGN security test — SEC-1580 INC-322 (mongo-only; no ClickHouse).
// Gap: a token whose `token_use` claim is `id` rather than `access` is
// accepted and returns data. The same applies to a token with no `token_use`
// claim at all, and to a `refresh` token. Id and refresh tokens are issued
// for other purposes and often have different lifetimes than access tokens,
// so accepting them widens the set of credentials the server treats as valid.
//
// Setup: a single tenant-A-owned Patient. A normal access token can read it
// (control). An id token, a token with no token_use claim, and a refresh
// token -- all otherwise carrying the same scope -- must each be refused.
//
// Asserts the SECURE outcome; if any of the three non-access tokens are
// honored, this FAILS. *.bugs, excluded from default CI.
// ============================================================================
const { commonBeforeEach, commonAfterEach, getHeaders, getHeadersWithCustomPayload, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const ownA = {
    resourceType: 'Patient', id: 'inc322OwnA',
    meta: {
        source: 'tenanta',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'tenanta' },
            { system: 'https://www.icanbwell.com/access', code: 'tenanta' }
        ]
    },
    gender: 'female', birthDate: '1985-06-15'
};

async function seed () {
    const request = await createTestRequest();
    await request.post('/4_0_0/Person/1/$merge').send([ownA]).set(getHeaders());
    return request;
}

describe('D-INC322 (fail-by-design) — an id/refresh token is accepted as an access token', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('control: a token with token_use=access works', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/inc322OwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*', token_use: 'access' }));
        expect(resp.status).toBe(200);
    });

    test('SECURE (fails until INC-322 enforced): a token with token_use=id is refused', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/inc322OwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*', token_use: 'id' }));
        expect([401, 403]).toContain(resp.status);
    });

    test('SECURE (fails until INC-322 enforced): a token with no token_use claim at all is refused', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/inc322OwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*' }));
        expect([401, 403]).toContain(resp.status);
    });

    test('SECURE (fails until INC-322 enforced): a refresh token is refused', async () => {
        const request = await seed();
        const resp = await request.get('/4_0_0/Patient/inc322OwnA')
            .set(getHeadersWithCustomPayload({ scope: 'user/*.read access/tenanta.*', token_use: 'refresh' }));
        expect([401, 403]).toContain(resp.status);
    });
});
