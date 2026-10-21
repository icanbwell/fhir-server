/**
 * GraphQL Group.member for extended Groups (DCON-5911)
 *
 * An extended Group keeps its roster in GroupMember_4_0_0. GraphQL cannot stream, so:
 * - wherever an extended Group appears, Group.member(_offset, _count) serves a bounded page of the
 *   roster, read from Mongo with sort/skip/limit;
 * - GRAPHQL_GROUP_MEMBER_MAX_COUNT is the page size when _count is omitted and the cap on _count;
 * - one request reads at most one extended Group roster page; every further extended member field
 *   in that request gets too-costly;
 * - embedded Groups keep resolving member from the document.
 *
 * Members are identified by period.start (a year per row) so the assertions don't depend on the
 * referenced entities existing; row i has _uuid `row-<i padded>` and period.start `2000 + i`.
 */
const fs = require('fs');
const path = require('path');
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getGraphQLHeaders,
    getGraphQLHeadersWithAdmin
} = require('../common');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');
const { GROUP_MEMBER_COLLECTION_NAME } = require('../../../constants');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';
// GRAPHQL_GROUP_MEMBER_MAX_COUNT for this file (default 50000), small so the limits need few rows
const GRAPHQL_GROUP_MEMBER_MAX_COUNT = 50;
const ROSTER_SIZE = 105;
// larger than one page, so a query without _count has to stop at the maximum page size
const OVERSIZED_ROSTER_SIZE = GRAPHQL_GROUP_MEMBER_MAX_COUNT + 5;

const yearOf = (index) => String(2000 + index);

function defaultMeta(accessCode = 'test-access', owner = 'test-owner') {
    return {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: owner },
            { system: 'https://www.icanbwell.com/access', code: accessCode }
        ]
    };
}

/**
 * v1 queries Group as `group(id: [String])`, v2 as `groups(id: SearchString)`; both return a
 * bundle of `entry { resource }`. `idArg` is the already-formatted argument text for that version.
 */
const VERSIONS = [
    {
        name: 'GraphQL v1',
        endpoint: '/$graphql',
        field: 'group',
        singleId: (id) => `id: ["${id}"]`,
        twoIds: (a, b) => `id: ["${a}", "${b}"]`
    },
    {
        name: 'GraphQL v2',
        endpoint: '/4_0_0/$graphqlv2',
        field: 'groups',
        singleId: (id) => `id: { value: "${id}" }`,
        twoIds: (a, b) => `id: { values: ["${a}", "${b}"] }`
    }
];

describe('GraphQL Group.member (extended storage)', () => {
    let request;
    let originalEnableExtendedGroup;
    let originalMaxCount;

    beforeAll(async () => {
        originalEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        originalMaxCount = process.env.GRAPHQL_GROUP_MEMBER_MAX_COUNT;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        process.env.GRAPHQL_GROUP_MEMBER_MAX_COUNT = String(GRAPHQL_GROUP_MEMBER_MAX_COUNT);
        await commonBeforeEach();
        request = await createTestRequest();
    });

    afterAll(async () => {
        await commonAfterEach();
        process.env.ENABLE_EXTENDED_GROUP = originalEnableExtendedGroup;
        if (originalMaxCount === undefined) {
            delete process.env.GRAPHQL_GROUP_MEMBER_MAX_COUNT;
        } else {
            process.env.GRAPHQL_GROUP_MEMBER_MAX_COUNT = originalMaxCount;
        }
    });

    /** List queries return every Group in the database, so start them from an empty one. */
    async function clearGroups() {
        await (await getCollection(GROUP_COLLECTION_NAME)).deleteMany({});
        await (await getCollection(GROUP_MEMBER_COLLECTION_NAME)).deleteMany({});
    }

    async function getCollection(name) {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    async function createGroup(overrides = {}) {
        const response = await request
            .post('/4_0_0/Group')
            .send({ resourceType: 'Group', type: 'person', actual: true, meta: defaultMeta(), ...overrides })
            .set(getHeaders());
        expect(response.status).toBe(201);
        return response.body;
    }

    /**
     * Creates a Group, marks it extended (raw write, as promotion does) and seeds roster rows.
     * With an `id`, the Group is written through $merge so the same id can exist under several owners.
     */
    async function createExtendedGroupWithRoster(size, accessCode = 'test-access', { id, owner } = {}) {
        let created;
        if (id) {
            const merged = await request
                .post('/4_0_0/Group/$merge')
                .send([{ resourceType: 'Group', id, type: 'person', actual: true, meta: defaultMeta(accessCode, owner) }])
                .set(getHeaders());
            expect(merged.status).toBe(200);
            created = { id };
        } else {
            created = await createGroup({ meta: defaultMeta(accessCode) });
        }
        const groups = await getCollection(GROUP_COLLECTION_NAME);
        const groupFilter = owner ? { id, _sourceAssigningAuthority: owner } : { id: created.id };
        await groups.updateOne(groupFilter, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
        const stored = await groups.findOne(groupFilter);
        const rows = Array.from({ length: size }, (_unused, i) => ({
            id: `row-${String(i).padStart(4, '0')}`,
            _uuid: `row-${String(i).padStart(4, '0')}`,
            meta: { versionId: '1', lastUpdated: new Date(), security: defaultMeta(accessCode).security },
            _sourceAssigningAuthority: 'test-authority',
            groupUuid: stored._uuid,
            groupVersionId: 1,
            member: { entity: { reference: `Patient/roster-${i}` }, period: { start: yearOf(i) } }
        }));
        await (await getCollection(GROUP_MEMBER_COLLECTION_NAME)).insertMany(rows);
        return created;
    }

    async function graphqlAllowingErrors(version, query, headers = getGraphQLHeaders(), variables = {}) {
        const response = await request
            .post(version.endpoint)
            .send({ operationName: null, variables, query })
            .set(headers);
        expect(response.status).toBe(200);
        return response;
    }

    async function graphql(version, query, headers = getGraphQLHeaders(), variables = {}) {
        const response = await graphqlAllowingErrors(version, query, headers, variables);
        expect(response.body.errors).toBeUndefined();
        return response;
    }

    const ONE_READ_MESSAGE = 'Only one extended Group member page can be read per GraphQL request';

    /** Asserts the response carries exactly `count` one-read-per-request too-costly errors. */
    function expectOneReadErrors(response, count) {
        expect(response.body.errors).toHaveLength(count);
        response.body.errors.forEach((e) => expect(e.message).toBe(ONE_READ_MESSAGE));
    }

    const entriesOf = (version, response) => response.body.data[version.field].entry || [];
    const startsOf = (resource) => (resource.member || []).map((m) => m.period.start);

    describe.each(VERSIONS)('$name', (version) => {
        const memberQuery = (idArg, memberArgs = '') =>
            `query { ${version.field}(${idArg}) { entry { resource { id member${memberArgs} { period { start } } } } } }`;

        test('single id without paging args returns one maximum-size page in _uuid order', async () => {
            const group = await createExtendedGroupWithRoster(OVERSIZED_ROSTER_SIZE);

            const response = await graphql(version, memberQuery(version.singleId(group.id)));

            const [entry] = entriesOf(version, response);
            expect(entry.resource.id).toBe(group.id);
            const starts = startsOf(entry.resource);
            expect(starts).toHaveLength(GRAPHQL_GROUP_MEMBER_MAX_COUNT);
            expect(starts[0]).toBe(yearOf(0));
            expect(starts[starts.length - 1]).toBe(yearOf(GRAPHQL_GROUP_MEMBER_MAX_COUNT - 1));
        });

        test('_count above the maximum is capped at the maximum page size', async () => {
            const group = await createExtendedGroupWithRoster(OVERSIZED_ROSTER_SIZE);

            const response = await graphql(
                version,
                `query { ${version.field}(${version.singleId(group.id)}, _debug: true) {
                    meta { tag { system display } }
                    entry { resource { member(_count: 5000000) { period { start } } } }
                } }`,
                getGraphQLHeadersWithAdmin()
            );

            expect(startsOf(entriesOf(version, response)[0].resource)).toHaveLength(GRAPHQL_GROUP_MEMBER_MAX_COUNT);
            const queries = response.body.data[version.field].meta.tag
                .filter((t) => t.system === 'https://www.icanbwell.com/query').map((t) => t.display).join(' ');
            expect(queries).toContain(`.limit(${GRAPHQL_GROUP_MEMBER_MAX_COUNT})`);
        });

        test('_offset/_count pages are stable, disjoint and together cover the whole roster', async () => {
            const group = await createExtendedGroupWithRoster(ROSTER_SIZE);

            const first = await graphql(version, memberQuery(version.singleId(group.id), '(_offset: 10, _count: 3)'));
            expect(startsOf(entriesOf(version, first)[0].resource)).toEqual([yearOf(10), yearOf(11), yearOf(12)]);

            const collected = [];
            for (let offset = 0; offset < ROSTER_SIZE; offset += 40) {
                const page = await graphql(
                    version,
                    memberQuery(version.singleId(group.id), `(_offset: ${offset}, _count: 40)`)
                );
                collected.push(...startsOf(entriesOf(version, page)[0].resource));
            }
            expect(collected).toEqual(Array.from({ length: ROSTER_SIZE }, (_unused, i) => yearOf(i)));
        });

        test('an _offset past the end returns an empty page', async () => {
            const group = await createExtendedGroupWithRoster(3);

            const response = await graphql(version, memberQuery(version.singleId(group.id), '(_offset: 50, _count: 10)'));

            expect(entriesOf(version, response)[0].resource.member).toEqual([]);
        });

        test('_debug lists the bounded GroupMember_4_0_0 page query in the response meta', async () => {
            const group = await createExtendedGroupWithRoster(ROSTER_SIZE);

            const response = await graphql(
                version,
                `query { ${version.field}(${version.singleId(group.id)}, _debug: true) {
                    meta { tag { system display code } }
                    entry { resource { member(_offset: 2, _count: 3) { period { start } } } }
                } }`,
                getGraphQLHeadersWithAdmin()
            );

            const tags = response.body.data[version.field].meta.tag;
            const queries = tags.filter((t) => t.system === 'https://www.icanbwell.com/query')
                .map((t) => t.display).join(' ');
            expect(queries).toContain('db.GroupMember_4_0_0.find');
            expect(queries).toContain('.limit(3)');
            expect(queries).toContain('.skip(2)');
        });

        test('a list query pages each extended Group and returns the inline list for an embedded one', async () => {
            await clearGroups();
            const extended = await createExtendedGroupWithRoster(3);
            const embedded = await createGroup({
                member: [{ entity: { reference: 'Patient/embedded-1' }, period: { start: '1999' } }]
            });

            const response = await graphql(
                version,
                `query { ${version.field} { entry { resource { id member { period { start } } } } } }`
            );

            const byId = Object.fromEntries(entriesOf(version, response).map((e) => [e.resource.id, e.resource]));
            expect(startsOf(byId[extended.id])).toEqual([yearOf(0), yearOf(1), yearOf(2)]);
            expect(startsOf(byId[embedded.id])).toEqual(['1999']);
        });

        test('a list query with several extended Groups: only the first gets its page, the rest too-costly', async () => {
            await clearGroups();
            await createExtendedGroupWithRoster(3);
            await createExtendedGroupWithRoster(3);
            await createExtendedGroupWithRoster(3);

            const response = await graphqlAllowingErrors(
                version,
                `query { ${version.field} { entry { resource { member(_count: 10) { period { start } } } } } }`
            );

            const entries = entriesOf(version, response);
            expect(entries).toHaveLength(3);
            expect(entries.filter((e) => Array.isArray(e.resource.member))).toHaveLength(1);
            expect(entries.filter((e) => e.resource.member === null)).toHaveLength(2);
            expectOneReadErrors(response, 2);
        });

        test('a list query without member selected reads no roster and gets no error', async () => {
            await clearGroups();
            await createExtendedGroupWithRoster(3);
            await createExtendedGroupWithRoster(3);

            const response = await graphql(version, `query { ${version.field} { entry { resource { id } } } }`);

            expect(entriesOf(version, response)).toHaveLength(2);
        });

        test('_debug from a caller without admin scope gets no GroupMember query', async () => {
            const group = await createExtendedGroupWithRoster(3);

            const response = await graphql(
                version,
                `query { ${version.field}(${version.singleId(group.id)}, _debug: true) {
                    meta { tag { system display code } }
                    entry { resource { member { period { start } } } }
                } }`
            );

            const tags = (response.body.data[version.field].meta || {}).tag || [];
            expect(tags.filter((t) => (t.display || '').includes('GroupMember_4_0_0'))).toEqual([]);
            expect(startsOf(entriesOf(version, response)[0].resource)).toHaveLength(3);
        });

        test('aliases on entry/resource/member are accepted', async () => {
            const group = await createExtendedGroupWithRoster(3);

            const response = await graphql(
                version,
                `query { g: ${version.field}(${version.singleId(group.id)}) { e: entry { r: resource { m: member { period { start } } } } } }`
            );

            expect(response.body.data.g.e[0].r.m.map((x) => x.period.start)).toEqual([yearOf(0), yearOf(1), yearOf(2)]);
        });

        test('a multi-id query: the first extended Group gets its page, the second too-costly', async () => {
            const a = await createExtendedGroupWithRoster(3);
            const b = await createExtendedGroupWithRoster(3);

            const response = await graphqlAllowingErrors(version, memberQuery(version.twoIds(a.id, b.id)));

            const entries = entriesOf(version, response);
            expect(entries).toHaveLength(2);
            expect(entries.filter((e) => Array.isArray(e.resource.member))).toHaveLength(1);
            expectOneReadErrors(response, 1);
        });

        test('embedded Groups next to an extended one are served and do not use up the read', async () => {
            const extended = await createExtendedGroupWithRoster(3);
            const embedded = await createGroup({
                member: [{ entity: { reference: 'Patient/embedded-2' }, period: { start: '1998' } }]
            });

            const response = await graphql(version, memberQuery(version.twoIds(embedded.id, extended.id)));

            const byId = Object.fromEntries(entriesOf(version, response).map((e) => [e.resource.id, e.resource]));
            expect(startsOf(byId[embedded.id])).toEqual(['1998']);
            expect(startsOf(byId[extended.id])).toHaveLength(3);
        });

        test('an embedded Group is unchanged and honors _offset/_count', async () => {
            const embedded = await createGroup({
                member: [
                    { entity: { reference: 'Patient/e1' }, period: { start: '2001' } },
                    { entity: { reference: 'Patient/e2' }, period: { start: '2002' } },
                    { entity: { reference: 'Patient/e3' }, period: { start: '2003' } }
                ]
            });

            const all = await graphql(version, memberQuery(version.singleId(embedded.id)));
            expect(startsOf(entriesOf(version, all)[0].resource)).toEqual(['2001', '2002', '2003']);

            const page = await graphql(version, memberQuery(version.singleId(embedded.id), '(_offset: 1, _count: 1)'));
            expect(startsOf(entriesOf(version, page)[0].resource)).toEqual(['2002']);
        });

        test('feature flag off: an extended Group returns no roster', async () => {
            const group = await createExtendedGroupWithRoster(3);

            const saved = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const response = await graphql(version, memberQuery(version.singleId(group.id)));
                const member = entriesOf(version, response)[0].resource.member;
                expect(member || []).toEqual([]);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = saved;
            }
        });

        test.each([0, -5])('_count %p returns an empty page, not the whole roster', async (count) => {
            const group = await createExtendedGroupWithRoster(5);

            const response = await graphql(
                version,
                `query { ${version.field}(${version.singleId(group.id)}, _debug: true) {
                    meta { tag { system display } }
                    entry { resource { member(_count: ${count}) { period { start } } } }
                } }`,
                getGraphQLHeadersWithAdmin()
            );

            expect(entriesOf(version, response)[0].resource.member).toEqual([]);
            const tags = response.body.data[version.field].meta.tag;
            expect(tags.filter((t) => (t.display || '').includes('GroupMember_4_0_0'))).toEqual([]);
        });

        test('root field inside an inline fragment on Query still pages', async () => {
            const group = await createExtendedGroupWithRoster(3);

            const response = await graphql(
                version,
                `query { ... on Query { ${version.field}(${version.singleId(group.id)}) { entry { resource { member { period { start } } } } } } }`
            );

            expect(startsOf(entriesOf(version, response)[0].resource)).toEqual([yearOf(0), yearOf(1), yearOf(2)]);
        });

        test('root field inside a named fragment, with the id from a variable and @include, still pages', async () => {
            const group = await createExtendedGroupWithRoster(3);
            const idArg = version.field === 'group' ? 'id: [$id]' : 'id: { value: $id }';

            const response = await graphql(
                version,
                `query ($id: String, $on: Boolean!) { ...Roster @include(if: $on) }
                fragment Roster on Query { ${version.field}(${idArg}) { entry { resource { member(_count: 2) { period { start } } } } } }`,
                getGraphQLHeaders(),
                { id: group.id, on: true }
            );

            expect(startsOf(entriesOf(version, response)[0].resource)).toEqual([yearOf(0), yearOf(1)]);
        });

        test('aliased member fields on one Group: the first is served, the rest too-costly with their paths', async () => {
            const group = await createExtendedGroupWithRoster(10);
            const aliases = Array.from({ length: 4 }, (_unused, i) =>
                `m${i}: member(_offset: ${i * 1000000}, _count: 1) { period { start } }`).join('\n');

            const response = await graphqlAllowingErrors(
                version,
                `query { ${version.field}(${version.singleId(group.id)}) { entry { resource { ${aliases} } } } }`
            );

            const resource = entriesOf(version, response)[0].resource;
            expect(startsOf({ member: resource.m0 })).toEqual([yearOf(0)]);
            ['m1', 'm2', 'm3'].forEach((key) => expect(resource[key]).toBeNull());
            expectOneReadErrors(response, 3);
            expect(response.body.errors.map((e) => e.path)).toEqual(
                ['m1', 'm2', 'm3'].map((key) => [version.field, 'entry', 0, 'resource', key])
            );
        });

        test('aliased single-id root fields: only one extended Group page per request', async () => {
            const a = await createExtendedGroupWithRoster(3);
            const b = await createExtendedGroupWithRoster(3);

            const response = await graphqlAllowingErrors(
                version,
                `query {
                    a: ${version.field}(${version.singleId(a.id)}) { entry { resource { member { period { start } } } } }
                    b: ${version.field}(${version.singleId(b.id)}) { entry { resource { member { period { start } } } } }
                }`
            );

            const served = ['a', 'b'].filter((key) => Array.isArray(response.body.data[key].entry[0].resource.member));
            expect(served).toHaveLength(1);
            expectOneReadErrors(response, 1);
        });

        test('one id matching Groups under several owners: the first gets its page, the second too-costly', async () => {
            const sharedId = `shared-${version.field}`;
            await createExtendedGroupWithRoster(3, 'test-access', { id: sharedId, owner: 'owner-a' });
            await createExtendedGroupWithRoster(3, 'test-access', { id: sharedId, owner: 'owner-b' });

            const response = await graphqlAllowingErrors(version, memberQuery(version.singleId(sharedId)));

            const entries = entriesOf(version, response);
            expect(entries).toHaveLength(2);
            expect(entries.filter((e) => Array.isArray(e.resource.member))).toHaveLength(1);
            expectOneReadErrors(response, 1);
        });

        test('the one-read limit is per request: the next request reads the next page', async () => {
            const group = await createExtendedGroupWithRoster(OVERSIZED_ROSTER_SIZE);

            const first = await graphql(version, memberQuery(version.singleId(group.id)));
            const second = await graphql(
                version,
                memberQuery(version.singleId(group.id), `(_offset: ${GRAPHQL_GROUP_MEMBER_MAX_COUNT})`)
            );

            expect(startsOf(entriesOf(version, first)[0].resource)).toHaveLength(GRAPHQL_GROUP_MEMBER_MAX_COUNT);
            expect(startsOf(entriesOf(version, second)[0].resource)).toHaveLength(5);
        });

        test('tenant isolation: another tenant gets neither the Group nor its roster', async () => {
            const group = await createExtendedGroupWithRoster(3, 'tenant-a');

            const sameTenant = await graphql(
                version,
                memberQuery(version.singleId(group.id)),
                getGraphQLHeaders('user/*.read access/tenant-a.*')
            );
            expect(startsOf(entriesOf(version, sameTenant)[0].resource)).toHaveLength(3);

            const otherTenant = await graphql(
                version,
                memberQuery(version.singleId(group.id)),
                getGraphQLHeaders('user/*.read access/tenant-b.*')
            );
            expect(entriesOf(version, otherTenant)).toEqual([]);
        });
    });

    describe('Groups are not writable through GraphQL', () => {
        const sdl = (file) => fs.readFileSync(path.join(__dirname, '../../../../generated.sdl', file), 'utf8');

        test('v1 only exposes its Patient and CareTeam mutations', () => {
            const block = sdl('graphql_v1.graphql').match(/^type Mutation \{[\s\S]*?^\}/m)[0];
            expect(block).toContain('updatePreferredProviders');
            expect(block).toContain('updateGeneralPractitioner');
            expect(block).not.toMatch(/Group/);
        });

        test('v2 has no mutations', () => {
            expect(sdl('graphql_v2.graphql')).not.toMatch(/^type Mutation\b/m);
        });

        test('REST PUT of members to an extended Group is still rejected as too-costly', async () => {
            const group = await createExtendedGroupWithRoster(1);

            const response = await request
                .put(`/4_0_0/Group/${group.id}`)
                .send({
                    resourceType: 'Group',
                    id: group.id,
                    meta: defaultMeta(),
                    type: 'person',
                    actual: true,
                    member: [{ entity: { reference: 'Patient/new' } }]
                })
                .set(getHeaders());

            expect(response.status).toBe(400);
            expect(response.body.issue[0].code).toBe('too-costly');
        });
    });
});
