// SEC-1580 F3: the write check on a resource only requires ONE access tag to match the caller's
// scopes, so without a separate check on the set of access tags themselves, a caller authorized
// for only one tenant could create a resource tagged for multiple tenants at once - sharing it
// with a tenant whose authorization was never checked.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

/**
 * @param {string[]} accessCodes
 */
function patientWithAccessCodes (accessCodes) {
    return {
        resourceType: 'Patient',
        id: '1',
        meta: {
            source: 'test',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'clientA' },
                ...accessCodes.map(code => ({ system: 'https://www.icanbwell.com/access', code }))
            ]
        }
    };
}

describe('SEC-1580 F3 - create with access tag the caller has no access to', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('rejects create of a resource tagged for a tenant the caller is not authorized for', async () => {
        const request = await createTestRequest();

        // caller is only authorized for clientA, but the resource being created also carries an
        // access tag for clientB. The pre-existing write check passes on the clientA overlap
        // alone (there is no "old" resource yet, and clientA is a legitimate owner+access match),
        // so without the new check this would silently create a resource visible to clientB too.
        const resp = await request
            .post('/4_0_0/Patient/')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(403);

        expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
        expect(resp.body.issue[0].code).toStrictEqual('forbidden');
        expect(resp.body.issue[0].details.text).toContain('access tags');
    });

    test('allows create of a resource whose access tags the caller is authorized for all of', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/Patient/')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders('access/clientA.* access/clientB.* user/*.*'))
            .expect(201);

        expect(resp.body.resourceType).toStrictEqual('Patient');
    });

    test('allows create of a resource with a single access tag the caller is authorized for', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/Patient/')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(201);

        expect(resp.body.resourceType).toStrictEqual('Patient');
    });
});
