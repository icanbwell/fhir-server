const deepcopy = require('deepcopy');

const groupResource = require('../update/fixtures/group.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const {
    GROUP_MEMBER_COLLECTION_NAME,
    GROUP_MEMBER_HISTORY_COLLECTION_NAME
} = require('../../../../../../constants');
const { EVENT_TYPES } = require('../../../../../../constants/clickHouseConstants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../../../utils/mongoGroupExtendedTag');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../../../utils/contextDataBuilder');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');
const {
    ClickHouseGroupHandler
} = require('../../../../../../dataLayer/postSaveHandlers/clickHouseGroupHandler');
const {
    describe,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    test,
    expect,
    jest
} = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variables a case or a path switch may change, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT'
];

/**
 * The environment variables that register the ClickHouse Group handler for the whole file,
 * because the container creates its ClickHouse client once, when it is built.
 */
const CLICKHOUSE_ENVIRONMENT = {
    ENABLE_CLICKHOUSE: '1',
    MONGO_WITH_CLICKHOUSE_RESOURCES: 'Group',
    CLICKHOUSE_WRITE_MODE: 'sync'
};

/**
 * The content type of a JSON Patch body, the only one PATCH accepts.
 */
const JSON_PATCH_CONTENT_TYPE = 'application/json-patch+json';

/**
 * How long to keep polling a collection for the rows a write queues after its response.
 */
const POLL_ATTEMPTS = 20;

/**
 * The wait between two polls, in milliseconds.
 */
const POLL_INTERVAL_MS = 250;

/**
 * The most times the access log spy is checked for the PATCH's call, once the response is in.
 */
const MAX_ACCESS_LOG_POLLS = 50;

/**
 * The environment of a case on an extended Group.
 */
const EXTENDED_ENVIRONMENT = { ENABLE_EXTENDED_GROUP: '1' };

/**
 * The environment of a case whose embedded Group goes over the promotion limit of three members.
 */
const PROMOTION_ENVIRONMENT = { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' };

/**
 * The `_uuid` the server derives for the stored Group, from its id and its owner `client`.
 */
const GROUP_UUID = generateUUIDv5(`${groupResource.id}|client`);

/**
 * The security tags the server stores on the Group and stamps on its member rows, each with the
 * id it derives from the tag's system and code.
 */
const STORED_SECURITY_TAGS = [
    ['https://www.icanbwell.com/access', 'client'],
    ['https://www.icanbwell.com/owner', 'client'],
    ['https://www.icanbwell.com/sourceAssigningAuthority', 'client']
].map(([system, code]) => ({ system, code, id: generateUUIDv5(`${system}|${code}`) }));

/**
 * The identifiers the server adds to a Group in a response.
 */
const GROUP_IDENTIFIERS = [
    { id: 'sourceId', system: 'https://www.icanbwell.com/sourceId', value: groupResource.id },
    { id: 'uuid', system: 'https://www.icanbwell.com/uuid', value: GROUP_UUID }
];

/**
 * The tag the server adds to an extended Group in a response.
 */
const EXTENDED_GROUP_TAG = {
    id: generateUUIDv5('https://www.icanbwell.com/groupSize|extended'),
    system: 'https://www.icanbwell.com/groupSize',
    code: 'extended'
};

/**
 * The tag the server stores on a Group whose members are kept in ClickHouse.
 */
const EXTERNAL_STORAGE_MEMBER_TAG = {
    id: generateUUIDv5('https://www.icanbwell.com/externalStorageFields|member'),
    system: 'https://www.icanbwell.com/externalStorageFields',
    code: 'member'
};

/**
 * Returns the reference of the synthetic patient with the given name.
 */
const memberReference = (name) => `Patient/patch-members-${name}`;

/**
 * Returns a Group member entry pointing at the synthetic patient with the given name.
 */
const groupMember = (name, extra = {}) => ({
    entity: { reference: memberReference(name) },
    ...extra
});

/**
 * Returns a JSON Patch operation that adds the member with the given name.
 */
const addMemberOperation = (name, extra = {}) => ({
    op: 'add',
    path: '/member/-',
    value: groupMember(name, extra)
});

/**
 * Returns a JSON Patch operation that removes the member with the given name by its reference.
 */
const removeMemberOperation = (name) => ({
    op: 'remove',
    path: '/member/',
    value: groupMember(name)
});

const renameOperation = { op: 'add', path: '/name', value: 'patch-members-renamed' };

/**
 * A JSON Patch operation that adds an access tag with the code `null`, which fails the meta check
 * of the patched Group.
 */
const invalidAccessTagOperation = {
    op: 'add',
    path: '/meta/security/-',
    value: { system: 'https://www.icanbwell.com/access', code: 'null' }
};

/**
 * Returns a copy of the Group fixture with the given members.
 */
const groupWithMembers = (names) => ({
    ...deepcopy(groupResource),
    member: names.map((name) => groupMember(name))
});

/**
 * Returns the JSON Patch headers of a caller with full access.
 */
const patchHeaders = () => ({ ...getHeaders(), 'Content-Type': JSON_PATCH_CONTENT_TYPE });

/**
 * Returns the JSON Patch headers of a caller with full access that asks for the Group's members
 * to be kept in ClickHouse.
 */
const externalStoragePatchHeaders = () => ({
    ...patchHeaders(),
    [USE_EXTERNAL_STORAGE_HEADER]: 'true'
});

/**
 * Sends PATCH to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (writePath) => {
    process.env.WRITE_PIPELINE_OPERATIONS = writePath === 'new' ? 'patch' : '';
};

/**
 * Returns the expectation a case has on the given path: its `byPath` entry for that path merged
 * over its `expected`.
 */
const expectationFor = ({ expected, byPath }, writePath) => ({
    ...expected,
    ...(byPath?.[writePath] ?? {})
});

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) =>
        PATHS.map((writePath) => ({
            ...testCase,
            path: writePath,
            expectation: expectationFor(testCase, writePath)
        }))
    );

/**
 * Waits for the given number of milliseconds.
 */
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Waits until every post-request task the server has queued has finished.
 */
const waitForPostRequestTasks = () =>
    getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

/**
 * Stores the Group a case starts from through `$merge` on the old path, with the given headers,
 * and waits for every post-request task it queued.
 */
const storeGroupAsync = async (request, group, headers = getHeaders()) => {
    useWritePath('old');
    const resp = await request.post('/4_0_0/Group/$merge').send(group).set(headers);
    expect(resp.status).toBe(200);
    expect(resp.body.created).toBe(true);
    await waitForPostRequestTasks();
};

/**
 * Sends a PATCH of the stored Group.
 */
const patchGroup = (request, body, headers = patchHeaders()) =>
    request.patch(`/4_0_0/Group/${groupResource.id}`).send(body).set(headers);

/**
 * Sends a PATCH that a case needs to have run already, on the old path, and waits for every
 * post-request task it queued.
 */
const seedPatchAsync = async (request, body, headers = patchHeaders()) => {
    useWritePath('old');
    const resp = await patchGroup(request, body, headers);
    expect(resp.status).toBe(200);
    await waitForPostRequestTasks();
};

/**
 * Returns the client database collection with the given name.
 */
const clientCollection = async (name) => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    return db.collection(name);
};

/**
 * Puts the stored Group into the extended regime by setting the internal marker field on its
 * document, the way the Group member tests do.
 */
const markGroupExtendedAsync = async () => {
    const groups = await clientCollection('Group_4_0_0');
    await groups.updateOne(
        { id: groupResource.id },
        { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
    );
};

/**
 * Reads the stored Group straight from MongoDB, as plain JSON.
 */
const readStoredGroup = async () => {
    const groups = await clientCollection('Group_4_0_0');
    const documents = await groups.find({}).toArray();
    expect(documents).toHaveLength(1);
    return JSON.parse(JSON.stringify(documents[0]));
};

/**
 * Reads the stored Group's history rows straight from MongoDB.
 */
const readGroupHistoryRows = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
    return db.collection('Group_4_0_0_History').find({}).toArray();
};

/**
 * Reads every row of the extended Group member collection, as plain JSON.
 */
const readMemberRows = async () => {
    const rows = await (await clientCollection(GROUP_MEMBER_COLLECTION_NAME)).find({}).toArray();
    return JSON.parse(JSON.stringify(rows));
};

/**
 * Reads every history row of the extended Group member collection.
 */
const readMemberHistoryRows = async () =>
    (await clientCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME)).find({}).toArray();

/**
 * Reads rows with the given reader once the post-request tasks are done, polling until two
 * reads in a row have as many rows and, when the expected number is given, that many.
 */
const readSettled = async (readRows, expectedCount) => {
    await waitForPostRequestTasks();
    let rows = await readRows();
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await delay(POLL_INTERVAL_MS);
        const next = await readRows();
        const settled = next.length === rows.length;
        rows = next;
        if (settled && (expectedCount === undefined || rows.length === expectedCount)) {
            break;
        }
    }
    return rows;
};

/**
 * Returns the given entries sorted by their JSON text, so that a comparison ignores their order.
 */
const sortedByJson = (entries) =>
    [...entries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/**
 * Returns what the extended member collection holds: each row's member reference, inactive flag
 * and version.
 */
const summarizeMemberRows = (rows) =>
    sortedByJson(
        rows.map((row) => ({
            reference: row.member.entity.reference,
            inactive: row.member.inactive ?? null,
            versionId: row.meta.versionId
        }))
    );

/**
 * Returns the member history rows written at the given Group version: each row's member
 * reference and request method.
 */
const summarizeMemberHistoryAt = (rows, versionId) =>
    sortedByJson(
        rows
            .filter((row) => row.resource.meta.versionId === versionId)
            .map((row) => ({
                reference: row.resource.member.entity.reference,
                method: row.request.method
            }))
    );

/**
 * Returns a copy of a response body without `meta.lastUpdated`, which changes on every run.
 */
const withoutLastUpdated = (body) => {
    const copy = deepcopy(body);
    if (copy?.meta) {
        delete copy.meta.lastUpdated;
    }
    return copy;
};

/**
 * Returns a member entry of a response: the member with the given name, its reference carrying
 * the extensions the server adds, and the given fields.
 */
const responseMember = (name, fields = {}) => ({
    entity: {
        extension: [
            {
                id: 'sourceId',
                url: 'https://www.icanbwell.com/sourceId',
                valueString: memberReference(name)
            },
            {
                id: 'uuid',
                url: 'https://www.icanbwell.com/uuid',
                valueString: `Patient/${generateUUIDv5(`patch-members-${name}|client`)}`
            },
            {
                id: 'sourceAssigningAuthority',
                url: 'https://www.icanbwell.com/sourceAssigningAuthority',
                valueString: 'client'
            }
        ],
        reference: memberReference(name)
    },
    ...fields
});

/**
 * Returns the response body of a PATCH of the Group fixture at the given version, with the
 * given fields and tags added, and with the identifiers the server adds unless told not to.
 */
const groupResponse = ({ versionId, fields = {}, tags, identifiers = true }) => ({
    resourceType: 'Group',
    id: groupResource.id,
    meta: {
        source: groupResource.meta.source,
        security: STORED_SECURITY_TAGS,
        versionId,
        ...(tags ? { tag: tags } : {})
    },
    type: groupResource.type,
    actual: groupResource.actual,
    ...fields,
    ...(identifiers ? { identifier: GROUP_IDENTIFIERS } : {})
});

/**
 * Waits until the access logger has been called for the PATCH, which the server does when the
 * response finishes, and returns the operation result of every call as JSON.
 */
const waitForAccessLogResults = async (logAccessLogAsync) => {
    for (let poll = 0; poll < MAX_ACCESS_LOG_POLLS; poll++) {
        if (logAccessLogAsync.mock.calls.length >= 1) {
            break;
        }
        await delay(100);
    }
    return logAccessLogAsync.mock.calls.map(([{ operationResult }]) =>
        operationResult === undefined ? null : JSON.parse(JSON.stringify(operationResult))
    );
};

/**
 * Checks that every member row the PATCH wrote, the ones at the Group's new version, carries the
 * stored Group's last-updated and security tags, each tag with its id.
 */
const expectRowsStampedWithGroup = ({ rows, group }) => {
    const written = rows.filter((row) => row.meta.versionId === group.meta.versionId);
    for (const row of written) {
        expect(row.groupUuid).toBe(GROUP_UUID);
        expect(new Date(row.meta.lastUpdated).toISOString()).toBe(
            new Date(group.meta.lastUpdated).toISOString()
        );
        expect(row.meta.security).toStrictEqual(group.meta.security);
    }
    expect(group.meta.security).toStrictEqual(STORED_SECURITY_TAGS);
};

describe('PATCH of Group members on the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        [...ENVIRONMENT_KEYS, ...Object.keys(CLICKHOUSE_ENVIRONMENT)].map((key) => [
            key,
            process.env[key]
        ])
    );

    /**
     * Puts every environment variable this file changes back to its value before the file ran.
     */
    const restoreEnvironment = (keys) => {
        for (const key of keys) {
            if (originalEnvironment[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnvironment[key];
            }
        }
    };

    beforeAll(() => {
        Object.assign(process.env, CLICKHOUSE_ENVIRONMENT);
    });

    afterAll(() => {
        restoreEnvironment(Object.keys(CLICKHOUSE_ENVIRONMENT));
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        restoreEnvironment(ENVIRONMENT_KEYS);
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    describe('extended Group', () => {
        /**
         * Stores the Group, marks it extended and adds the given members to it with a PATCH on
         * the old path, which bumps the Group to version 2 when it adds any.
         */
        const seedExtendedGroupAsync = async (request, memberNames) => {
            await storeGroupAsync(request, deepcopy(groupResource));
            await markGroupExtendedAsync();
            if (memberNames.length > 0) {
                await seedPatchAsync(
                    request,
                    memberNames.map((name) => addMemberOperation(name))
                );
            }
        };

        /**
         * Stores the Group with three embedded members and promotes it with a PATCH on the old
         * path that adds a fourth, so it is extended with four member rows at version 2.
         */
        const seedPromotedGroupAsync = async (request) => {
            await storeGroupAsync(request, groupWithMembers(['a', 'b', 'c']));
            Object.assign(process.env, PROMOTION_ENVIRONMENT);
            await seedPatchAsync(request, [addMemberOperation('d')]);
        };

        const cases = [
            {
                name: 'memberAdded',
                seed: (request) => seedExtendedGroupAsync(request, []),
                body: [addMemberOperation('new')],
                expected: {
                    versionId: '2',
                    groupHistoryVersions: ['1', '2'],
                    memberRows: [
                        { reference: memberReference('new'), inactive: null, versionId: '2' }
                    ],
                    memberHistoryAtVersion: [
                        { reference: memberReference('new'), method: 'PATCH' }
                    ],
                    response: groupResponse({ versionId: '2', tags: [EXTENDED_GROUP_TAG] })
                }
            },
            {
                name: 'memberRemoved',
                seed: (request) => seedExtendedGroupAsync(request, ['gone', 'kept']),
                body: [removeMemberOperation('gone')],
                expected: {
                    versionId: '3',
                    groupHistoryVersions: ['1', '2', '3'],
                    memberRows: [
                        { reference: memberReference('kept'), inactive: null, versionId: '2' }
                    ],
                    memberHistoryAtVersion: [
                        { reference: memberReference('gone'), method: 'DELETE' }
                    ],
                    response: groupResponse({ versionId: '3', tags: [EXTENDED_GROUP_TAG] })
                }
            },
            {
                name: 'mixedMemberAndFieldPatch',
                seed: (request) => seedExtendedGroupAsync(request, []),
                body: [addMemberOperation('new', { inactive: true }), renameOperation],
                expected: {
                    versionId: '2',
                    name: 'patch-members-renamed',
                    groupHistoryVersions: ['1', '2'],
                    memberRows: [
                        { reference: memberReference('new'), inactive: true, versionId: '2' }
                    ],
                    memberHistoryAtVersion: [
                        { reference: memberReference('new'), method: 'PATCH' }
                    ],
                    response: groupResponse({
                        versionId: '2',
                        tags: [EXTENDED_GROUP_TAG],
                        fields: { name: 'patch-members-renamed' }
                    })
                }
            },
            {
                name: 'absentMemberRemovedIsANoOp',
                seed: (request) => seedExtendedGroupAsync(request, []),
                body: [removeMemberOperation('never-added')],
                expected: {
                    versionId: '1',
                    groupHistoryVersions: ['1'],
                    memberRows: [],
                    memberHistoryAtVersion: [],
                    response: groupResponse({ versionId: '1', tags: [EXTENDED_GROUP_TAG] })
                },
                /**
                 * Accepted difference: a no-op PATCH answers `updated: false` and stores an
                 * access-log entry of the stored Group on the new path; the old path stores none.
                 */
                byPath: {
                    old: { accessLog: [null] },
                    new: {
                        accessLog: [
                            [
                                {
                                    created: false,
                                    updated: false,
                                    id: groupResource.id,
                                    uuid: GROUP_UUID,
                                    sourceAssigningAuthority: 'client',
                                    resourceType: 'Group'
                                }
                            ]
                        ]
                    }
                }
            },
            {
                name: 'alreadyExtendedGroupMemberAddedAndRemoved',
                seed: seedPromotedGroupAsync,
                body: [addMemberOperation('e'), removeMemberOperation('a')],
                expected: {
                    versionId: '3',
                    groupHistoryVersions: ['1', '2', '3'],
                    memberRows: [
                        { reference: memberReference('b'), inactive: null, versionId: '2' },
                        { reference: memberReference('c'), inactive: null, versionId: '2' },
                        { reference: memberReference('d'), inactive: null, versionId: '2' },
                        { reference: memberReference('e'), inactive: null, versionId: '3' }
                    ],
                    memberHistoryAtVersion: [
                        { reference: memberReference('a'), method: 'DELETE' },
                        { reference: memberReference('e'), method: 'PATCH' }
                    ],
                    response: groupResponse({ versionId: '3', tags: [EXTENDED_GROUP_TAG] })
                }
            }
        ];

        test.each(withEachPath(cases))(
            '$name on the $path path',
            async ({ path: writePath, seed, body, expectation }) => {
                const request = await createTestRequest();
                Object.assign(process.env, EXTENDED_ENVIRONMENT);
                await seed(request);
                const memberHistoryBefore = await readSettled(readMemberHistoryRows);
                const logAccessLogAsync = jest.spyOn(
                    getTestContainer().accessLogger,
                    'logAccessLogAsync'
                );
                await delay(100);
                logAccessLogAsync.mockClear();
                useWritePath(writePath);

                const resp = await patchGroup(request, body);

                expect(resp.status).toBe(200);
                expect(withoutLastUpdated(resp.body)).toStrictEqual(expectation.response);
                const group = await readStoredGroup();
                expect(group.meta.versionId).toBe(expectation.versionId);
                expect(group.member).toBeUndefined();
                expect(group[MONGO_GROUP_EXTENDED_FIELD]).toBe(true);
                expect(group.name).toBe(expectation.name);
                const groupHistory = await readSettled(
                    readGroupHistoryRows,
                    expectation.groupHistoryVersions.length
                );
                expect(groupHistory.map((row) => row.resource.meta.versionId).sort()).toStrictEqual(
                    expectation.groupHistoryVersions
                );
                const memberHistory = await readSettled(
                    readMemberHistoryRows,
                    memberHistoryBefore.length + expectation.memberHistoryAtVersion.length
                );
                expect(
                    summarizeMemberHistoryAt(memberHistory, expectation.versionId)
                ).toStrictEqual(expectation.memberHistoryAtVersion);
                expect(memberHistory).toHaveLength(
                    memberHistoryBefore.length + expectation.memberHistoryAtVersion.length
                );
                const rows = await readMemberRows();
                expect(summarizeMemberRows(rows)).toStrictEqual(expectation.memberRows);
                expectRowsStampedWithGroup({ rows, group });
                if (expectation.accessLog) {
                    expect(await waitForAccessLogResults(logAccessLogAsync)).toStrictEqual(
                        expectation.accessLog
                    );
                }
            }
        );
    });

    describe('embedded Group', () => {
        const cases = [
            {
                name: 'memberAddOverPromotionLimitPromotes',
                stored: groupWithMembers(['a', 'b', 'c']),
                env: PROMOTION_ENVIRONMENT,
                body: [addMemberOperation('d')],
                expected: {
                    storedMembers: undefined,
                    extended: true,
                    memberRows: ['a', 'b', 'c', 'd'].map((name) => ({
                        reference: memberReference(name),
                        inactive: null,
                        versionId: '2'
                    })),
                    memberHistoryAtVersion: ['a', 'b', 'c', 'd'].map((name) => ({
                        reference: memberReference(name),
                        method: 'PATCH'
                    })),
                    response: groupResponse({ versionId: '2', tags: [EXTENDED_GROUP_TAG] })
                }
            },
            {
                name: 'repeatedMemberKeepsOneEntry',
                stored: groupWithMembers(['a', 'b']),
                env: {},
                body: [addMemberOperation('a', { period: { start: '2026-01-01' } })],
                expected: {
                    storedMembers: [
                        {
                            entity: { reference: memberReference('a') },
                            period: { start: '2026-01-01' }
                        },
                        { entity: { reference: memberReference('b') } }
                    ],
                    extended: undefined,
                    memberRows: [],
                    memberHistoryAtVersion: [],
                    response: groupResponse({
                        versionId: '2',
                        fields: {
                            member: [
                                responseMember('a', { period: { start: '2026-01-01' } }),
                                responseMember('b')
                            ]
                        }
                    })
                }
            }
        ];

        /**
         * Returns the stored Group's members with only the fields a client sends: the entity
         * reference and the member's own fields.
         */
        const clientMembers = (members) =>
            members?.map(({ entity, ...fields }) => ({
                entity: { reference: entity.reference },
                ...fields
            }));

        test.each(withEachPath(cases))(
            '$name on the $path path',
            async ({ path: writePath, stored, env, body, expectation }) => {
                const request = await createTestRequest();
                await storeGroupAsync(request, stored);
                Object.assign(process.env, env);
                useWritePath(writePath);

                const resp = await patchGroup(request, body);

                expect(resp.status).toBe(200);
                expect(withoutLastUpdated(resp.body)).toStrictEqual(expectation.response);
                const group = await readStoredGroup();
                expect(group.meta.versionId).toBe('2');
                expect(clientMembers(group.member)).toStrictEqual(expectation.storedMembers);
                expect(group[MONGO_GROUP_EXTENDED_FIELD]).toBe(expectation.extended);
                const groupHistory = await readSettled(readGroupHistoryRows, 2);
                expect(groupHistory.map((row) => row.resource.meta.versionId).sort()).toStrictEqual(
                    ['1', '2']
                );
                const memberHistory = await readSettled(
                    readMemberHistoryRows,
                    expectation.memberHistoryAtVersion.length
                );
                expect(memberHistory).toHaveLength(expectation.memberHistoryAtVersion.length);
                expect(summarizeMemberHistoryAt(memberHistory, '2')).toStrictEqual(
                    expectation.memberHistoryAtVersion
                );
                const rows = await readMemberRows();
                expect(summarizeMemberRows(rows)).toStrictEqual(expectation.memberRows);
                expectRowsStampedWithGroup({ rows, group });
            }
        );
    });

    describe('ClickHouse Group', () => {
        /**
         * Returns every member event ClickHouse holds for the Group: its type, member reference
         * and the Group's authority and tags, in event order.
         */
        const readMemberEventsAsync = () =>
            getTestContainer().clickHouseClientManager.queryAsync({
                query:
                    'SELECT event_type, entity_reference, group_source_assigning_authority, ' +
                    'access_tags, owner_tags FROM fhir.Group_4_0_0_MemberEvents ' +
                    'WHERE group_id = {groupId:String} ORDER BY event_time, entity_reference',
                query_params: { groupId: groupResource.id }
            });

        /**
         * Returns the member event ClickHouse stores for the given type and member.
         */
        const memberEvent = (eventType, name) => ({
            event_type: eventType,
            entity_reference: memberReference(name),
            group_source_assigning_authority: 'client',
            access_tags: ['client'],
            owner_tags: ['client']
        });

        beforeEach(async () => {
            await createTestRequest();
            await getTestContainer().clickHouseClientManager.truncateTableAsync(
                'Group_4_0_0_MemberEvents'
            );
        });

        const cases = [
            {
                name: 'memberOnlyPatchWritesEachEventOnce',
                body: [addMemberOperation('c'), removeMemberOperation('a')],
                expected: {
                    events: [
                        memberEvent(EVENT_TYPES.MEMBER_ADDED, 'c'),
                        memberEvent(EVENT_TYPES.MEMBER_REMOVED, 'a')
                    ],
                    groupHistoryVersions: ['1', '2']
                },
                /**
                 * Accepted differences: the new path validates, audits and success-logs a
                 * member-only PATCH of a ClickHouse Group, where the old path returns before all
                 * three, and its response carries the enriched identifiers that every other PATCH
                 * response has.
                 */
                byPath: {
                    old: {
                        auditEntries: [],
                        /**
                         * Accepted difference: the old path answers with
                         * `buildMemberPatchResponse`, which skips identifier enrichment, so its
                         * response has no `identifier` entries; the new path's response carries
                         * the enriched `identifier: [sourceId, uuid]` of every other PATCH.
                         */
                        response: groupResponse({
                            versionId: '2',
                            tags: [EXTERNAL_STORAGE_MEMBER_TAG],
                            identifiers: false
                        })
                    },
                    new: {
                        auditEntries: [{ operation: 'update', ids: [GROUP_UUID] }],
                        response: groupResponse({
                            versionId: '2',
                            tags: [EXTERNAL_STORAGE_MEMBER_TAG]
                        })
                    }
                }
            },
            {
                name: 'mixedPatchWritesEachEventOnce',
                body: [renameOperation, addMemberOperation('c')],
                expected: {
                    events: [memberEvent(EVENT_TYPES.MEMBER_ADDED, 'c')],
                    name: 'patch-members-renamed',
                    auditEntries: [{ operation: 'update', ids: [GROUP_UUID] }],
                    response: groupResponse({
                        versionId: '2',
                        tags: [EXTERNAL_STORAGE_MEMBER_TAG],
                        fields: { name: 'patch-members-renamed' }
                    })
                },
                /**
                 * Accepted difference: the old path writes the Group twice, both at the new
                 * version, so it stores two history rows for it; the new path writes it once.
                 */
                byPath: {
                    old: { groupHistoryVersions: ['1', '2', '2'] },
                    new: { groupHistoryVersions: ['1', '2'] }
                }
            }
        ];

        test.each(withEachPath(cases))(
            '$name on the $path path',
            async ({ path: writePath, body, expectation }) => {
                const request = await createTestRequest();
                const headers = externalStoragePatchHeaders();
                await storeGroupAsync(request, groupWithMembers(['a', 'b']), headers);
                const eventsBefore = await readMemberEventsAsync();
                expect(eventsBefore).toStrictEqual([
                    memberEvent(EVENT_TYPES.MEMBER_ADDED, 'a'),
                    memberEvent(EVENT_TYPES.MEMBER_ADDED, 'b')
                ]);
                const writeEventsAsync = jest.spyOn(
                    ClickHouseGroupHandler.prototype,
                    'writeEventsAsync'
                );
                const logAuditEntryAsync = jest.spyOn(
                    getTestContainer().auditLogger,
                    'logAuditEntryAsync'
                );
                useWritePath(writePath);

                const resp = await patchGroup(request, body, headers);

                expect(resp.status).toBe(200);
                expect(withoutLastUpdated(resp.body)).toStrictEqual(expectation.response);
                await waitForPostRequestTasks();
                expect(
                    writeEventsAsync.mock.calls.map(
                        ([{ groupResource: group }]) => group.meta.versionId
                    )
                ).toStrictEqual(['2']);
                const eventsAfter = await readMemberEventsAsync();
                expect(eventsAfter.slice(0, eventsBefore.length)).toStrictEqual(eventsBefore);
                expect(sortedByJson(eventsAfter.slice(eventsBefore.length))).toStrictEqual(
                    sortedByJson(expectation.events)
                );
                const group = await readStoredGroup();
                expect(group.meta.versionId).toBe('2');
                expect(group.member).toBeUndefined();
                expect(group.name).toBe(expectation.name);
                const groupHistory = await readSettled(
                    readGroupHistoryRows,
                    expectation.groupHistoryVersions.length
                );
                expect(groupHistory.map((row) => row.resource.meta.versionId).sort()).toStrictEqual(
                    expectation.groupHistoryVersions
                );
                expect(
                    logAuditEntryAsync.mock.calls.map(([{ operation, ids }]) => ({
                        operation,
                        ids
                    }))
                ).toStrictEqual(expectation.auditEntries);
            }
        );

        const rejectedCases = [
            {
                name: 'mixedPatchRejectedWritesNoEvents',
                body: [addMemberOperation('c'), invalidAccessTagOperation],
                expected: { status: 400, issueCode: 'invalid' },
                /**
                 * Accepted difference: the old path writes the member operations before it checks
                 * the rest of the patch, so a rejected mixed PATCH has already bumped the Group to
                 * version 2 and written its events; the new path writes nothing for a rejected
                 * PATCH, so the stored Group and ClickHouse stay as they were.
                 */
                byPath: {
                    old: {
                        versionId: '2',
                        groupHistoryVersions: ['1', '2'],
                        newEvents: [memberEvent(EVENT_TYPES.MEMBER_ADDED, 'c')],
                        eventWrites: 1
                    },
                    new: {
                        versionId: '1',
                        groupHistoryVersions: ['1'],
                        newEvents: [],
                        eventWrites: 0
                    }
                }
            }
        ];

        test.each(withEachPath(rejectedCases))(
            '$name on the $path path',
            async ({ path: writePath, body, expectation }) => {
                const request = await createTestRequest();
                const headers = externalStoragePatchHeaders();
                await storeGroupAsync(request, groupWithMembers(['a', 'b']), headers);
                const eventsBefore = await readMemberEventsAsync();
                const writeEventsAsync = jest.spyOn(
                    ClickHouseGroupHandler.prototype,
                    'writeEventsAsync'
                );
                useWritePath(writePath);

                const resp = await patchGroup(request, body, headers);

                expect(resp.status).toBe(expectation.status);
                expect(resp.body.resourceType).toBe('OperationOutcome');
                expect(resp.body.issue.map((issue) => issue.code)).toContain(expectation.issueCode);
                await waitForPostRequestTasks();
                expect(writeEventsAsync).toHaveBeenCalledTimes(expectation.eventWrites);
                const eventsAfter = await readMemberEventsAsync();
                expect(eventsAfter.slice(0, eventsBefore.length)).toStrictEqual(eventsBefore);
                expect(sortedByJson(eventsAfter.slice(eventsBefore.length))).toStrictEqual(
                    sortedByJson(expectation.newEvents)
                );
                const group = await readStoredGroup();
                expect(group.meta.versionId).toBe(expectation.versionId);
                const groupHistory = await readSettled(
                    readGroupHistoryRows,
                    expectation.groupHistoryVersions.length
                );
                expect(groupHistory.map((row) => row.resource.meta.versionId).sort()).toStrictEqual(
                    expectation.groupHistoryVersions
                );
            }
        );
    });
});
