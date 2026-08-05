// DCON-4844/W3: resourceValidator.validatePatientReference skipped patient-reference validation
// entirely for non-user (access-scoped) callers on array reference fields, including
// Person.link.target.reference. That's intentional for most such fields (ingestion pipelines need
// to freely maintain them), but for Person.link specifically it meant an access-scoped caller could
// link a Person they own into another tenant's Person/Patient with no ownership check on the
// target, letting graph traversal (e.g. $everything) reach into that other tenant's data.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

function personOwnedBy (id, ownerCode, linkTargetReference) {
    return {
        resourceType: 'Person',
        id,
        meta: {
            source: 'test',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: ownerCode },
                { system: 'https://www.icanbwell.com/access', code: ownerCode }
            ]
        },
        ...(linkTargetReference
            ? { link: [{ target: { reference: linkTargetReference } }] }
            : {})
    };
}

describe('DCON-4844 - $merge cannot link a Person into another tenant\'s identity graph', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('rejects an access-scoped caller linking their Person to another tenant\'s Person', async () => {
        const request = await createTestRequest();

        const createTenantA = await request
            .post('/4_0_0/Person/$merge')
            .send(personOwnedBy('person-tenant-a', 'tenant_a'))
            .set(getHeaders())
            .expect(200);
        expect(createTenantA).toHaveMergeResponse({ created: true });

        const createTenantB = await request
            .post('/4_0_0/Person/$merge')
            .send(personOwnedBy('person-tenant-b', 'tenant_b'))
            .set(getHeaders())
            .expect(200);
        expect(createTenantB).toHaveMergeResponse({ created: true });

        const linkResp = await request
            .post('/4_0_0/Person/$merge')
            .send(personOwnedBy('person-tenant-a', 'tenant_a', 'Person/person-tenant-b'))
            .set(getHeaders('access/tenant_a.* user/*.*'))
            .expect(200);

        expect(linkResp).toHaveMergeResponse({
            issue: expect.objectContaining({
                details: expect.objectContaining({
                    text: expect.stringContaining('does not have access')
                })
            })
        });

        // confirm the cross-tenant link did not persist
        const getResp = await request
            .get('/4_0_0/Person/person-tenant-a')
            .set(getHeaders())
            .expect(200);
        expect(getResp.body.link).toBeUndefined();
    });

    test('allows an access-scoped caller linking their Person to a Person in the same tenant', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/Person/$merge')
            .send(personOwnedBy('person-tenant-a-1', 'tenant_a'))
            .set(getHeaders())
            .expect(200);
        await request
            .post('/4_0_0/Person/$merge')
            .send(personOwnedBy('person-tenant-a-2', 'tenant_a'))
            .set(getHeaders())
            .expect(200);

        const linkResp = await request
            .post('/4_0_0/Person/$merge')
            .send(personOwnedBy('person-tenant-a-1', 'tenant_a', 'Person/person-tenant-a-2'))
            .set(getHeaders('access/tenant_a.* user/*.*'))
            .expect(200);
        expect(linkResp).toHaveMergeResponse({ updated: true });

        const getResp = await request
            .get('/4_0_0/Person/person-tenant-a-1')
            .set(getHeaders())
            .expect(200);
        expect(getResp.body.link[0].target.reference).toStrictEqual('Person/person-tenant-a-2');
    });
});
