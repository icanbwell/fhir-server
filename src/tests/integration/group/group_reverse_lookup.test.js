/**
 * `GET /Group?member=X` reverse lookup for extended Groups
 *
 * FHIR's standard `member` search parameter on Group only ever matched the inline `member[]`
 * array. Once a Group is "extended" its roster lives entirely in GroupMember_4_0_0 -- there is
 * no inline array left to search -- so without this feature's SearchManager.constructQueryAsync
 * hook, the search silently returns nothing for such a Group.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getHeaders, getHeadersJsonPatch } = require('../common');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

function defaultMeta(accessCode = 'test-access') {
    return {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: accessCode }
        ]
    };
}

describe('Group member reverse lookup', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    async function createGroup(overrides = {}, headers = getHeaders()) {
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                meta: defaultMeta(),
                ...overrides
            })
            .set(headers);
        expect(response.status).toBe(201);
        return response.body;
    }

    async function getCollection(name) {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    /**
     * Puts a Group into the extended (Mongo-native) regime the same way
     * group_member_patch_write.test.js does -- a raw write of the internal marker field, never
     * via meta.tag (see mongoGroupExtendedTag.js).
     */
    async function markGroupExtended(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne(
            { id: groupId },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
    }

    /** Adds a member to an extended Group via the real PATCH write path. */
    async function addExtendedMember(groupId, reference, headers = getHeadersJsonPatch()) {
        const patchResp = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference } } }])
            .set(headers);
        expect(patchResp.status).toBe(200);
        return patchResp.body;
    }

    async function searchByMember(reference, headers = getHeaders()) {
        return await request
            .get(`/4_0_0/Group?member=${encodeURIComponent(reference)}`)
            .set(headers);
    }

    /**
     * `STREAM_RESPONSE=1` (set globally in jest/setEnvVars.js) plus no `_bundle=1` on the
     * request means the search endpoint returns a bare array of resources, not a Bundle with
     * `entry` -- handle both shapes so this test doesn't depend on that global toggle.
     */
    function idsOf(body) {
        const resources = Array.isArray(body) ? body : (body.entry || []).map((e) => e.resource);
        return resources.map((r) => r.id);
    }

    test('embedded Group: search still matches the inline member[] array (regression check)', async () => {
        const created = await createGroup({
            member: [{ entity: { reference: 'Patient/embedded-member-1' } }]
        });

        const searchResp = await searchByMember('Patient/embedded-member-1');

        expect(searchResp.status).toBe(200);
        expect(idsOf(searchResp.body)).toEqual([created.id]);
    });

    test('extended Group: reverse lookup finds it even though member[] is gone from the document', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);
        await addExtendedMember(created.id, 'Patient/extended-lookup-1');

        // Confirm the Group document itself really has no member[] to search against.
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        const storedGroup = await groupCollection.findOne({ id: created.id });
        expect(storedGroup.member).toBeUndefined();

        const searchResp = await searchByMember('Patient/extended-lookup-1');

        expect(searchResp.status).toBe(200);
        expect(idsOf(searchResp.body)).toEqual([created.id]);
    });

    test('feature flag off: an extended Group with a matching GroupMember_4_0_0 row is not found', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);
        await addExtendedMember(created.id, 'Patient/flag-off-member');

        const saved = process.env.ENABLE_EXTENDED_GROUP;
        delete process.env.ENABLE_EXTENDED_GROUP;
        try {
            const searchResp = await searchByMember('Patient/flag-off-member');
            expect(searchResp.status).toBe(200);
            expect(idsOf(searchResp.body)).not.toContain(created.id);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = saved;
        }
    });

    test('mixed: same member reference in both an embedded and an extended Group returns both, no duplicates', async () => {
        const embedded = await createGroup({
            member: [{ entity: { reference: 'Patient/shared-member' } }]
        });
        const extended = await createGroup();
        await markGroupExtended(extended.id);
        await addExtendedMember(extended.id, 'Patient/shared-member');

        const searchResp = await searchByMember('Patient/shared-member');

        expect(searchResp.status).toBe(200);
        const ids = idsOf(searchResp.body);
        expect(new Set(ids)).toEqual(new Set([embedded.id, extended.id]));
        expect(ids).toHaveLength(2);
    });

    test('mixed: two extended Groups, member present in only one', async () => {
        const withMember = await createGroup();
        await markGroupExtended(withMember.id);
        await addExtendedMember(withMember.id, 'Patient/only-in-one');

        const withoutMember = await createGroup();
        await markGroupExtended(withoutMember.id);
        await addExtendedMember(withoutMember.id, 'Patient/some-other-member');

        const searchResp = await searchByMember('Patient/only-in-one');

        expect(searchResp.status).toBe(200);
        expect(idsOf(searchResp.body)).toEqual([withMember.id]);
    });

    test('tenant isolation: an extended Group matching the member is excluded when the caller lacks tenant access', async () => {
        // Created/extended with full-access headers (matching this repo's other cross-tenant
        // test convention, e.g. merge_person_link_cross_tenant.test.js) -- only the *search*
        // calls below use tenant-restricted scopes, which is what this test is actually verifying.
        const created = await createGroup({ meta: defaultMeta('tenant-a') });
        await markGroupExtended(created.id);
        await addExtendedMember(created.id, 'Patient/cross-tenant-member');

        const tenantAHeaders = getHeaders('user/*.read access/tenant-a.*');
        const tenantBHeaders = getHeaders('user/*.read access/tenant-b.*');

        const sameTenantSearch = await searchByMember('Patient/cross-tenant-member', tenantAHeaders);
        expect(sameTenantSearch.status).toBe(200);
        expect(idsOf(sameTenantSearch.body)).toEqual([created.id]);

        const otherTenantSearch = await searchByMember('Patient/cross-tenant-member', tenantBHeaders);
        expect(otherTenantSearch.status).toBe(200);
        expect(idsOf(otherTenantSearch.body)).not.toContain(created.id);
    });

    test('inactive member still matches (FHIR member search has no active-only semantics)', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);

        const patchResp = await request
            .patch(`/4_0_0/Group/${created.id}`)
            .send([{
                op: 'add',
                path: '/member/-',
                value: { entity: { reference: 'Patient/inactive-member' }, inactive: true }
            }])
            .set(getHeadersJsonPatch());
        expect(patchResp.status).toBe(200);

        const searchResp = await searchByMember('Patient/inactive-member');

        expect(searchResp.status).toBe(200);
        expect(idsOf(searchResp.body)).toEqual([created.id]);
    });

    test('no match in either regime returns an empty bundle, not an error', async () => {
        await createGroup({ member: [{ entity: { reference: 'Patient/unrelated' } }] });
        const extended = await createGroup();
        await markGroupExtended(extended.id);
        await addExtendedMember(extended.id, 'Patient/also-unrelated');

        const searchResp = await searchByMember('Patient/never-a-member');

        expect(searchResp.status).toBe(200);
        expect(idsOf(searchResp.body)).toEqual([]);
    });

    test('bare-id reference (no sourceAssigningAuthority) resolves against member.entity._sourceId on GroupMember_4_0_0', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);
        await addExtendedMember(created.id, 'Patient/bare-id-member');

        const searchResp = await searchByMember('Patient/bare-id-member');

        expect(searchResp.status).toBe(200);
        expect(idsOf(searchResp.body)).toEqual([created.id]);
    });
});
