// SEC-1580 F2/F3: $merge's write-authorization check (WriteAllowedByScopesValidator) ran only
// against the resource as stored (or the raw incoming resource for a create), never validating
// which access tags the incoming body itself adds or removes. A smart merge only appends to
// arrays, so a tag missing from the incoming body is not a removal - it just wasn't repeated -
// which is why the check must ignore removals in that mode but still catch additions.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

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

describe('SEC-1580 F2/F3 - $merge cannot re-tag a resource to a tenant the caller has no access to', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('F3: rejects a merge-create of a resource tagged for a tenant the caller has no access to', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(200);

        expect(resp).toHaveMergeResponse({
            issue: expect.objectContaining({
                code: 'forbidden'
            })
        });
    });

    test('F2: rejects a smart merge that appends an access tag the caller has no access to', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        // caller only has clientA write access; a smart merge appending a clientB access tag
        // must still be rejected even though nothing is being "removed"
        const resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientB']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(200);

        expect(resp).toHaveMergeResponse({
            issue: expect.objectContaining({
                code: 'forbidden'
            })
        });

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

    test('allows a smart merge that appends an access tag the caller is authorized for (legitimate sharing)', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientB']))
            .set(getHeaders('access/clientA.* access/clientB.* user/*.*'))
            .expect(200);
        expect(resp).toHaveMergeResponse({ updated: true });

        // smart merge appends, so the resource should now carry both tags rather than only the
        // one repeated in the incoming body
        const getResp = await request
            .get('/4_0_0/Patient/1')
            .set(getHeaders())
            .expect(200);
        const accessCodes = getResp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/access')
            .map(s => s.code);
        expect(accessCodes.sort()).toStrictEqual(['clientA', 'clientB']);
    });

    test('F2: rejects a non-smart (full replace) merge that removes an access tag the caller has no access to', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientWithAccessCodes(['clientA', 'clientB']))
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        // caller only has clientA access; smartMerge=false is a full replace, so omitting the
        // clientB tag here is a real removal that clientB never authorized
        const resp = await request
            .post('/4_0_0/Patient/$merge?smartMerge=false')
            .send(patientWithAccessCodes(['clientA']))
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(200);

        expect(resp).toHaveMergeResponse({
            issue: expect.objectContaining({
                code: 'forbidden'
            })
        });
    });
});
