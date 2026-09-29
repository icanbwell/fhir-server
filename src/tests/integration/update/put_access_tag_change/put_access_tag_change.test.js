// SEC-1580 F2: update (PUT) validated write access using only the resource as currently stored,
// then merged in the incoming body (smartMerge: false) with no second access check - letting a
// caller with legitimate write access to their own tenant's resource silently add (or remove) an
// access tag for a tenant it has no authorization for.
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

describe('SEC-1580 F2 - update cannot re-tag a resource to a tenant the caller has no access to', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('rejects a PUT that adds an access tag the caller is not authorized for (cross-tenant re-tagging)', async () => {
        const request = await createTestRequest();

        // owned by clientA, visible only to clientA
        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        // caller has legitimate write access to this resource via clientA, but attempts to also
        // tag it for clientB - a tenant it has no authorization for at all
        const resp = await request
            .put('/4_0_0/Patient/1')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(403);

        expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
        expect(resp.body.issue[0].code).toStrictEqual('forbidden');
        expect(resp.body.issue[0].details.text).toContain('access tags');

        // confirm the tag injection did not persist despite the update being rejected
        const getResp = await request
            .get('/4_0_0/Patient/1')
            .set(getHeaders())
            .expect(200);
        const accessCodes = getResp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/access')
            .map(s => s.code);
        expect(accessCodes).toStrictEqual(['clientA']);
    });

    test('rejects a PUT that removes an access tag the caller is not authorized for (silent unsharing)', async () => {
        const request = await createTestRequest();

        // shared with both clientA and clientB
        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        // caller only has clientA access, but a PUT (full replace) omitting the clientB tag would
        // silently revoke clientB's access without clientB's authorization ever being checked
        const resp = await request
            .put('/4_0_0/Patient/1')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(403);

        expect(resp.body.issue[0].details.text).toContain('access tags');
    });

    test('allows a PUT that adds an access tag the caller is authorized for (legitimate sharing)', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .put('/4_0_0/Patient/1')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders('access/clientA.* access/clientB.* user/*.*'))
            .expect(200);

        const accessCodes = resp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/access')
            .map(s => s.code);
        expect(accessCodes.sort()).toStrictEqual(['clientA', 'clientB']);
    });
});
