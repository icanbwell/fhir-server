/**
 * `GET /Group?member=X` reverse lookup for extended Groups
 *
 * FHIR's standard `member` search parameter on Group only ever matched the inline `member[]`
 * array. Once a Group is "extended" its roster lives entirely in GroupMember_4_0_0 -- there is
 * no inline array left to search -- so GroupMemberQueryRewriter widens every member condition
 * with `OR _uuid in <extended Groups whose GroupMember rows match it>`.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersJsonPatch,
    getGraphQLHeaders,
    getHeadersWithCustomPayload,
    getHeadersWithAdmin
} = require('../common');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');
const { GroupMemberQueryRewriter } = require('../../../queryRewriters/rewriters/groupMemberQueryRewriter');
const { OPERATIONS: { READ } } = require('../../../constants');
const { ConfigManager } = require('../../../utils/configManager');

const debugExtendedGroup = require('./fixtures/reverse_lookup_debug/Group/extendedGroup.json');
const debugAddMemberPatch = require('./fixtures/reverse_lookup_debug/patch/addMember.json');
const expectedSearchByMember = require('./fixtures/reverse_lookup_debug/expected/searchByMember.json');

class NonStreamingConfigManager extends ConfigManager {
    get streamResponse () {
        return false;
    }
}

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

    test('GroupMemberQueryRewriter is registered as a READ query rewriter', () => {
        const { queryRewriterManager } = getTestContainer();

        expect(queryRewriterManager.operationSpecificQueryRewriters[`${READ}`]
            .some((rewriter) => rewriter instanceof GroupMemberQueryRewriter)).toBe(true);
    });

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

    test('other search params still apply to the extended Group branch', async () => {
        const created = await createGroup();
        await markGroupExtended(created.id);
        await addExtendedMember(created.id, 'Patient/extended-with-type');

        const matchingType = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent('Patient/extended-with-type')}&type=person`)
            .set(getHeaders());
        expect(matchingType.status).toBe(200);
        expect(idsOf(matchingType.body)).toEqual([created.id]);

        const otherType = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent('Patient/extended-with-type')}&type=animal`)
            .set(getHeaders());
        expect(otherType.status).toBe(200);
        expect(idsOf(otherType.body)).toEqual([]);
    });

    test('chained member:Patient.identifier finds both an embedded and an extended Group', async () => {
        const identifierSystem = 'http://test-system.com/patient-id';
        const identifierValue = 'CHAINED-REVERSE-LOOKUP-001';
        const patientResponse = await request
            .put('/4_0_0/Patient/chained-reverse-lookup-patient')
            .send({
                resourceType: 'Patient',
                id: 'chained-reverse-lookup-patient',
                identifier: [{ system: identifierSystem, value: identifierValue }],
                meta: {
                    source: 'http://test-system.com/Patient',
                    security: defaultMeta().security
                }
            })
            .set(getHeaders());
        expect([200, 201]).toContain(patientResponse.status);

        const reference = 'Patient/chained-reverse-lookup-patient';
        const embedded = await createGroup({ member: [{ entity: { reference } }] });
        const extended = await createGroup();
        await markGroupExtended(extended.id);
        await addExtendedMember(extended.id, reference);

        const searchResp = await request
            .get(`/4_0_0/Group?member:Patient.identifier=${encodeURIComponent(`${identifierSystem}|${identifierValue}`)}`)
            .set(getHeaders());

        expect(searchResp.status).toBe(200);
        const ids = idsOf(searchResp.body);
        expect(new Set(ids)).toEqual(new Set([embedded.id, extended.id]));
        expect(ids).toHaveLength(2);
    });

    test('member:not excludes an extended Group holding the member, keeps one that does not', async () => {
        const holding = await createGroup();
        await markGroupExtended(holding.id);
        await addExtendedMember(holding.id, 'Patient/not-target');
        const other = await createGroup();
        await markGroupExtended(other.id);
        await addExtendedMember(other.id, 'Patient/not-someone-else');

        const searchResp = await request
            .get(`/4_0_0/Group?member:not=${encodeURIComponent('Patient/not-target')}`)
            .set(getHeaders());

        expect(searchResp.status).toBe(200);
        const ids = idsOf(searchResp.body);
        expect(ids).not.toContain(holding.id);
        expect(ids).toContain(other.id);
    });

    test('member=X with member:not=Y excludes an extended Group holding both, keeps one holding only X', async () => {
        const holdingBoth = await createGroup();
        await markGroupExtended(holdingBoth.id);
        await addExtendedMember(holdingBoth.id, 'Patient/combo-x');
        await addExtendedMember(holdingBoth.id, 'Patient/combo-y');
        const holdingOnlyX = await createGroup();
        await markGroupExtended(holdingOnlyX.id);
        await addExtendedMember(holdingOnlyX.id, 'Patient/combo-x');
        const embeddedBoth = await createGroup({
            member: [
                { entity: { reference: 'Patient/combo-x' } },
                { entity: { reference: 'Patient/combo-y' } }
            ]
        });

        const searchResp = await request
            .get(`/4_0_0/Group?member=${encodeURIComponent('Patient/combo-x')}` +
                `&member:not=${encodeURIComponent('Patient/combo-y')}`)
            .set(getHeaders());

        expect(searchResp.status).toBe(200);
        const ids = idsOf(searchResp.body);
        expect(ids).toContain(holdingOnlyX.id);
        expect(ids).not.toContain(holdingBoth.id);
        expect(ids).not.toContain(embeddedBoth.id);
    });

    test('patient scope parity: an extended Group containing the caller\'s patient is visible, others are not', async () => {
        const meta = { source: 'http://test-system.com/Patient', security: defaultMeta().security };
        const patientResp = await request.put('/4_0_0/Patient/scope-patient')
            .send({ resourceType: 'Patient', id: 'scope-patient', meta })
            .set(getHeaders());
        expect(patientResp.status).toBeLessThan(300);
        const personResp = await request.put('/4_0_0/Person/scope-person')
            .send({
                resourceType: 'Person',
                id: 'scope-person',
                meta: { ...meta, source: 'http://test-system.com/Person' },
                link: [{ target: { reference: 'Patient/scope-patient' } }]
            })
            .set(getHeaders());
        expect(personResp.status).toBeLessThan(300);

        const clientDb = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const personUuid = (await clientDb.collection('Person_4_0_0').findOne({ id: 'scope-person' }))._uuid;
        const patientUuid = (await clientDb.collection('Patient_4_0_0').findOne({ id: 'scope-patient' }))._uuid;

        const embedded = await createGroup({ member: [{ entity: { reference: 'Patient/scope-patient' } }] });
        const extendedOwn = await createGroup();
        await markGroupExtended(extendedOwn.id);
        await addExtendedMember(extendedOwn.id, 'Patient/scope-patient');
        const extendedOther = await createGroup();
        await markGroupExtended(extendedOther.id);
        await addExtendedMember(extendedOther.id, 'Patient/scope-other-patient');

        const searchResp = await request
            .get('/4_0_0/Group')
            .set(getHeadersWithCustomPayload({
                scope: 'patient/*.read user/*.read access/*.*',
                username: 'patient-scope-user',
                client_id: 'client',
                clientFhirPersonId: personUuid,
                clientFhirPatientId: patientUuid,
                bwellFhirPersonId: personUuid,
                bwellFhirPatientId: patientUuid,
                token_use: 'access'
            }));

        expect(searchResp.status).toBe(200);
        const ids = idsOf(searchResp.body);
        expect(new Set(ids)).toEqual(new Set([embedded.id, extendedOwn.id]));
        expect(ids).not.toContain(extendedOther.id);
    });

    describe.each([
        ['GraphQL', '/$graphql', 'group'],
        ['GraphQL v2', '/4_0_0/$graphqlv2', 'groups']
    ])('%s groups(member:)', (_name, endpoint, queryField) => {
        async function graphqlSearchByMember(reference) {
            const response = await request
                .post(endpoint)
                .send({
                    operationName: null,
                    variables: { reference },
                    query: `query ($reference: String) { ${queryField}(member: { value: $reference }) { entry { resource { id } } } }`
                })
                .set(getGraphQLHeaders());
            expect(response.status).toBe(200);
            expect(response.body.errors).toBeUndefined();
            return (response.body.data[queryField].entry || []).map((e) => e.resource.id);
        }

        test('returns both the embedded and the extended Group for the same member', async () => {
            const reference = `Patient/graphql-member-${endpoint.endsWith('v2') ? 'v2' : 'v1'}`;
            const embedded = await createGroup({ member: [{ entity: { reference } }] });
            const extended = await createGroup();
            await markGroupExtended(extended.id);
            await addExtendedMember(extended.id, reference);

            const ids = await graphqlSearchByMember(reference);

            expect(new Set(ids)).toEqual(new Set([embedded.id, extended.id]));
            expect(ids).toHaveLength(2);
        });

        test('does not return the extended Group when the feature flag is off', async () => {
            const reference = `Patient/graphql-flag-off-${endpoint.endsWith('v2') ? 'v2' : 'v1'}`;
            const embedded = await createGroup({ member: [{ entity: { reference } }] });
            const extended = await createGroup();
            await markGroupExtended(extended.id);
            await addExtendedMember(extended.id, reference);

            const saved = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                expect(await graphqlSearchByMember(reference)).toEqual([embedded.id]);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = saved;
            }
        });
    });

    /**
     * `_debug` / `_explain` metadata. GroupMemberQueryRewriter runs a GroupMember_4_0_0 lookup of
     * its own; like the queries of $everything it is listed in every debug tag of the bundle
     * (query, queryCollection, queryOptions, queryFields, queryDatabase, queryExplain,
     * queryExplainSimple), pipe-joined after the Group query. Inputs and expected bundles are JSON
     * fixtures, see fixtures/reverse_lookup_debug.
     */
    describe('_debug / _explain metadata', () => {
        const MEMBER_REFERENCE = 'Patient/dcon5532-member-1';
        const searchUrl = (flag) => `/4_0_0/Group?member=${encodeURIComponent(MEMBER_REFERENCE)}&_bundle=1&${flag}`;
        const debugHeaders = () => ({ ...getHeadersWithAdmin(), prefer: 'global_id=false' });

        beforeAll(async () => {
            // PUT keeps the fixture id, so the Group _uuid (and the queries built from it) are deterministic
            const putResp = await request
                .put(`/4_0_0/Group/${debugExtendedGroup.id}`)
                .send(deepcopy(debugExtendedGroup))
                .set(getHeaders());
            expect(putResp.status).toBeLessThan(300);
            await markGroupExtended(debugExtendedGroup.id);
            const patchResp = await request
                .patch(`/4_0_0/Group/${debugExtendedGroup.id}`)
                .send(deepcopy(debugAddMemberPatch))
                .set(getHeadersJsonPatch());
            expect(patchResp.status).toBe(200);
        });

        test('_debug on a streaming search lists the GroupMember lookup in the debug tags', async () => {
            const resp = await request.get(searchUrl('_debug=1')).set(debugHeaders());

            const expected = deepcopy(expectedSearchByMember);
            // query first: it strips the query display from both sides, then the rest of the bundle is compared
            expect(resp).toHaveMongoQuery(expected);
            expect(resp).toHaveResponse(expected);
        });

        test('_debug on a non-streaming search lists the GroupMember lookup in the debug tags', async () => {
            const nonStreamingRequest = await createTestRequest((c) => {
                c.register('configManager', () => new NonStreamingConfigManager());
                return c;
            });

            const resp = await nonStreamingRequest.get(searchUrl('_debug=1')).set(debugHeaders());

            const expected = deepcopy(expectedSearchByMember);
            expect(resp).toHaveMongoQuery(expected);
            expect(resp).toHaveResponse(expected);
        });

        test('_explain lists the GroupMember lookup in the debug tags and explains it in the same pass', async () => {
            const resp = await request.get(searchUrl('_explain=1')).set(debugHeaders());

            // read the plans first: toHaveResponse strips the (dynamic) explain display from the response
            const explainTag = resp.body.meta.tag.find((t) => t.system === 'https://www.icanbwell.com/queryExplain');
            expect(JSON.parse(explainTag.display)).toHaveLength(2);

            // _explain returns the same tags as _debug but runs no search, so no entries
            const expected = deepcopy(expectedSearchByMember);
            expected.entry = [];
            expect(resp).toHaveMongoQuery(expected);
            expect(resp).toHaveResponse(expected);
        });

        test('without _debug or _explain the bundle carries no query tags', async () => {
            const resp = await request
                .get(`/4_0_0/Group?member=${encodeURIComponent(MEMBER_REFERENCE)}&_bundle=1`)
                .set(debugHeaders());

            expect(resp.status).toBe(200);
            const tags = (resp.body.meta && resp.body.meta.tag) || [];
            expect(tags.filter((t) => t.system.startsWith('https://www.icanbwell.com/query'))).toEqual([]);
        });
    });
});
