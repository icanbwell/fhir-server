// SEC-1580 F2/F3: patch, like update, validated write access only against the resource as
// currently stored. A JSON patch that adds (or removes) a meta.security access tag needs the same
// "every changed tag must be one the caller is authorized for" check as update/create/merge.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

function patientOwnedByClientAWithAccess (accessCodes) {
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

const addClientBAccessTagPatch = [
    {
        op: 'add',
        path: '/meta/security/-',
        value: { system: 'https://www.icanbwell.com/access', code: 'clientB' }
    }
];

describe('SEC-1580 F2 - patch cannot re-tag a resource to a tenant the caller has no access to', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('rejects a patch that adds an access tag the caller is not authorized for', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientOwnedByClientAWithAccess(['clientA']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .patch('/4_0_0/Patient/1')
            .send(addClientBAccessTagPatch)
            .set(getHeadersJsonPatch('access/clientA.* user/*.*'))
            .expect(403);

        expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
        expect(resp.body.issue[0].details.text).toContain('access tags');

        // confirm the tag injection did not persist
        const getResp = await request
            .get('/4_0_0/Patient/1')
            .set(getHeaders())
            .expect(200);
        const accessCodes = getResp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/access')
            .map(s => s.code);
        expect(accessCodes).toStrictEqual(['clientA']);
    });

    test('allows a patch that adds an access tag the caller is authorized for', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientOwnedByClientAWithAccess(['clientA']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .patch('/4_0_0/Patient/1')
            .send(addClientBAccessTagPatch)
            .set(getHeadersJsonPatch('access/clientA.* access/clientB.* user/*.*'))
            .expect(200);

        const accessCodes = resp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/access')
            .map(s => s.code);
        expect(accessCodes.sort()).toStrictEqual(['clientA', 'clientB']);
    });
});
