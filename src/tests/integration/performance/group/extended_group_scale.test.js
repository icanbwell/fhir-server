/**
 * Mongo-native ("extended") Group roster scale test.
 *
 * The design targets 5,000,000 members per Group. Nothing in the repo measures the Mongo-native
 * regime above about 5,000: the three existing 1M-scale tests in this directory all set
 * ENABLE_CLICKHOUSE=1 and none sets ENABLE_EXTENDED_GROUP, so they exercise the ClickHouse event
 * log, not this regime.
 *
 * Loads a single Group's roster through the only supported write path (JSON Patch add ops on
 * /member) and reports, at each checkpoint:
 *   - write throughput, to show whether it degrades as the collection grows
 *   - on-disk size of GroupMember_4_0_0 and GroupMember_4_0_0_History, including index bytes
 *   - latency of the forward roster query ({ groupUuid }), which is what the streamed read uses
 *   - latency of the reverse lookup query ({ 'member.entity._uuid': X }), which is what
 *     GET /Group?member=X needs and which currently has no code path
 *
 * Every member add also writes one history document, so the document count is roughly double the
 * member count. That amplification is the thing most likely to be underestimated.
 *
 * Requires a real MongoDB: the in-memory replset is capped at a 0.5GB wiredTiger cache by default
 * and is not a useful substrate at this size. Run with:
 *
 *   docker run -d --name fhir-scale-mongo -p 27018:27017 mongo:8.0.15 \
 *       --replSet rs0 --bind_ip_all --wiredTigerCacheSizeGB 8
 *   docker exec fhir-scale-mongo mongosh --quiet \
 *       --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
 *
 *   EXTENDED_GROUP_SCALE_TARGET=10000000 \
 *   node node_modules/.bin/jest --runInBand --forceExit \
 *       src/tests/integration/performance/group/extended_group_scale.test.js \
 *       --testPathIgnorePatterns='/no-such-path/'
 *
 * The explicit --testPathIgnorePatterns override is required because jest.config.js excludes this
 * whole directory from the normal suite.
 */

// SCALE_REGIME selects which storage regime is measured. Both run the same load loop, the same
// batch size and the same checkpoints, so the numbers are directly comparable.
//   mongo      Mongo-native extended roster in GroupMember_4_0_0 (DCON-5473)
//   clickhouse Event-sourced roster in Group_4_0_0_MemberEvents + AggregatingMergeTree views
const REGIME = process.env.SCALE_REGIME || 'mongo';
if (!['mongo', 'clickhouse'].includes(REGIME)) {
    throw new Error(`SCALE_REGIME must be mongo or clickhouse, got ${REGIME}`);
}

// Requires a real MongoDB (see the header comment): the in-memory replset is capped at a 0.5GB
// wiredTiger cache and is not a useful substrate at this size. Opt in by exporting MONGO_URL;
// without it this falls back to whatever the harness provides, which will be slow but not wrong.
if (process.env.MONGO_URL) {
    process.env.USE_DOCKER_MONGO = '1';
}
process.env.GROUP_PATCH_OPERATIONS_LIMIT = process.env.GROUP_PATCH_OPERATIONS_LIMIT || '10000';
process.env.LOGLEVEL = 'SILENT';
process.env.PAYLOAD_LIMIT = '200mb';
process.env.STREAM_RESPONSE = '0';

if (REGIME === 'mongo') {
    process.env.ENABLE_CLICKHOUSE = '0';
    process.env.ENABLE_EXTENDED_GROUP = '1';
} else {
    process.env.ENABLE_CLICKHOUSE = '1';
    process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
    process.env.CLICKHOUSE_WRITE_MODE = 'sync';
    // Routing to ClickHouse is per-request via the useExternalStorage header, so the extended
    // regime must be off or its per-document marker would compete for the same PATCH.
    process.env.ENABLE_EXTENDED_GROUP = '0';
}

const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersJsonPatch
} = require('../../common');
const { GROUP_MEMBER_COLLECTION_NAME, GROUP_MEMBER_HISTORY_COLLECTION_NAME } = require('../../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');
const { ClickHouseClientManager } = require('../../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../utils/contextDataBuilder');

const CH_TABLES = [
    'Group_4_0_0_MemberEvents',
    'Group_4_0_0_MemberCurrent',
    'Group_4_0_0_MemberCurrentByEntity'
];

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

const TARGET = parseInt(process.env.EXTENDED_GROUP_SCALE_TARGET || '1000000', 10);
const OPS_PER_PATCH = parseInt(process.env.GROUP_PATCH_OPERATIONS_LIMIT, 10);

// Checkpoints at which to stop and measure. Only those at or below TARGET are used.
const CHECKPOINTS = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000];

function mb(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Jest buffers console output until a test finishes, which is useless for a run measured in hours.
// Mirror every checkpoint to a file so progress is observable while it runs.
const PROGRESS_LOG = process.env.EXTENDED_GROUP_SCALE_LOG || '/tmp/extended_group_scale.log';

function report(text) {
    console.log(text);
    try {
        require('fs').appendFileSync(PROGRESS_LOG, `${text}\n`);
    } catch {
        // progress logging is best-effort
    }
}

describe('Extended Group roster scale', () => {
    let request;
    let db;
    let groupId;
    let groupUuid;
    let clickHouse;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
        const container = getTestContainer();
        db = await container.mongoDatabaseManager.getClientDbAsync();

        // Start from empty so sizes and timings describe this run only.
        await db.collection(GROUP_MEMBER_COLLECTION_NAME).deleteMany({});
        await db.collection(GROUP_MEMBER_HISTORY_COLLECTION_NAME).deleteMany({});
        await db.collection(GROUP_COLLECTION_NAME).deleteMany({});

        // The integration harness never runs the index runner, so collections come up with only
        // _id_. Measuring writes that way is meaningless: resolveMemberWritesAsync issues
        // { groupUuid, _uuid: { $in: [...10k] } } on every PATCH, which without an index on _uuid
        // is a full collection scan per batch and turns the load into O(n^2). Create the same
        // index set production gets, so the numbers describe the design rather than the harness.
        //
        // From src/indexes/customIndexes.js: the standalone unique `uuid` index (GroupMember is
        // not in its exclude list) plus the three GroupMember-specific indexes.
        if (REGIME === 'clickhouse') {
            clickHouse = new ClickHouseClientManager({ configManager: new ConfigManager() });
            await clickHouse.getClientAsync();
            for (const t of CH_TABLES) {
                await clickHouse.truncateTableAsync(t);
            }
            return;
        }

        await db.collection(GROUP_MEMBER_COLLECTION_NAME).createIndexes([
            { key: { _uuid: 1 }, name: 'uuid', unique: true },
            { key: { groupUuid: 1 }, name: 'groupUuid_1' },
            { key: { 'member.entity._uuid': 1 }, name: 'member_entity_uuid_1' },
            { key: { 'member.entity._sourceId': 1 }, name: 'member_entity_sourceId_1' }
        ]);
        // Deliberately NOT creating history indexes: DCON-5527 specified two and neither shipped,
        // so the history collection really does run with only _id_. Its numbers below reflect that.
        await db.collection(GROUP_MEMBER_HISTORY_COLLECTION_NAME).createIndexes([
            { key: { _uuid: 1 }, name: 'uuid' }
        ]);
    }, 600000);

    afterAll(async () => {
        await commonAfterEach();
    }, 120000);

    function patchHeaders() {
        const headers = getHeadersJsonPatch();
        // ClickHouse routing is per-request; the Mongo-native regime is routed by the document's
        // own marker and takes no header.
        return REGIME === 'clickhouse'
            ? { ...headers, [USE_EXTERNAL_STORAGE_HEADER]: 'true' }
            : headers;
    }

    /**
     * Bytes and rows actually on disk per ClickHouse table, which is the comparable figure to
     * Mongo's storageSize + totalIndexSize. Only active parts count; merged-away parts do not.
     */
    async function clickHouseReport() {
        const rows = await clickHouse.queryAsync({
            query: `
                SELECT table, sum(rows) AS rows, sum(bytes_on_disk) AS bytes
                FROM system.parts
                WHERE active AND database = {db:String} AND table IN ({tables:Array(String)})
                GROUP BY table
            `,
            query_params: { db: process.env.CLICKHOUSE_DATABASE || 'fhir', tables: CH_TABLES }
        });
        const byTable = {};
        for (const r of rows || []) {
            byTable[r.table] = { rows: Number(r.rows), bytes: Number(r.bytes) };
        }
        return byTable;
    }

    async function collectionReport(name) {
        try {
            const stats = await db.command({ collStats: name });
            const indexes = await db.collection(name).indexes();
            return {
                count: stats.count || 0,
                storageSize: stats.storageSize || 0,
                totalIndexSize: stats.totalIndexSize || 0,
                avgObjSize: stats.avgObjSize || 0,
                indexNames: indexes.map((i) => i.name)
            };
        } catch {
            return { count: 0, storageSize: 0, totalIndexSize: 0, avgObjSize: 0, indexNames: [] };
        }
    }

    async function timed(label, fn) {
        const started = Date.now();
        const result = await fn();
        const ms = Date.now() - started;
        return { label, ms, result };
    }

    test(
        `load ${TARGET.toLocaleString()} members via PATCH and measure`,
        async () => {
            const createResponse = await request
                .post('/4_0_0/Group')
                .send({
                    resourceType: 'Group',
                    type: 'person',
                    actual: true,
                    name: 'Extended Scale Group',
                    meta: {
                        source: 'http://test-system.com/Group',
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                        ]
                    }
                })
                .set(getHeaders());
            expect(createResponse.status).toBe(201);
            groupId = createResponse.body.id;

            if (REGIME === 'mongo') {
                await db
                    .collection(GROUP_COLLECTION_NAME)
                    .updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
            }
            const groupDoc = await db.collection(GROUP_COLLECTION_NAME).findOne({ id: groupId });
            groupUuid = groupDoc._uuid;
            expect(groupUuid).toBeTruthy();

            const checkpoints = CHECKPOINTS.filter((c) => c <= TARGET);
            if (checkpoints[checkpoints.length - 1] !== TARGET) {
                checkpoints.push(TARGET);
            }

            report(`\ntarget=${TARGET.toLocaleString()} opsPerPatch=${OPS_PER_PATCH.toLocaleString()} mongo=${process.env.MONGO_URL || 'harness default'}\n`);

            let loaded = 0;
            let nextCheckpointIndex = 0;
            const runStarted = Date.now();
            let windowStarted = Date.now();
            let windowLoaded = 0;

            while (loaded < TARGET) {
                const batchSize = Math.min(OPS_PER_PATCH, TARGET - loaded);
                const ops = new Array(batchSize);
                for (let i = 0; i < batchSize; i++) {
                    ops[i] = {
                        op: 'add',
                        path: '/member/-',
                        value: { entity: { reference: `Patient/scale-${loaded + i}` } }
                    };
                }

                // Long runs have been stopping with bare 401/501 responses carrying empty bodies,
                // neither of which this app emits, so capture everything the response and the
                // thrown error carry and retry before giving up. A transient failure that
                // succeeds on retry is a harness or transport problem; one that repeats is real.
                let patchResponse = null;
                let lastFailure = null;
                for (let attempt = 1; attempt <= 4; attempt++) {
                    try {
                        const response = await request
                            .patch(`/4_0_0/Group/${groupId}`)
                            .send(ops)
                            .set(patchHeaders());
                        if (response.status === 200) {
                            patchResponse = response;
                            break;
                        }
                        lastFailure =
                            `status=${response.status} ` +
                            `text=${String(response.text || '').slice(0, 400)} ` +
                            `headers=${JSON.stringify(response.headers || {}).slice(0, 400)}`;
                    } catch (e) {
                        lastFailure =
                            `threw ${e.code || e.name}: ${e.message} ` +
                            `status=${e.status ?? 'none'} ` +
                            `text=${String(e.response?.text || '').slice(0, 400)}`;
                    }
                    report(
                        `\nPATCH attempt ${attempt} failed at ${loaded.toLocaleString()} members: ` +
                        `${lastFailure}\n  heapUsed=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB ` +
                        `rss=${Math.round(process.memoryUsage().rss / 1048576)}MB\n`
                    );
                    if (attempt < 4) {
                        await new Promise((r) => setTimeout(r, 1000 * attempt));
                    }
                }

                if (!patchResponse) {
                    report(`\nPATCH terminally failed at ${loaded.toLocaleString()} members after 4 attempts\n`);
                }
                expect(patchResponse).not.toBeNull();

                loaded += batchSize;
                windowLoaded += batchSize;

                if (
                    nextCheckpointIndex < checkpoints.length &&
                    loaded >= checkpoints[nextCheckpointIndex]
                ) {
                    const windowSeconds = (Date.now() - windowStarted) / 1000;
                    const overallSeconds = (Date.now() - runStarted) / 1000;

                    const header = [
                        `--- ${REGIME} @ ${loaded.toLocaleString()} members ---`,
                        `elapsed            ${overallSeconds.toFixed(0)}s`,
                        `rate (window)      ${Math.round(windowLoaded / windowSeconds).toLocaleString()}/s`,
                        `rate (overall)     ${Math.round(loaded / overallSeconds).toLocaleString()}/s`
                    ];

                    let body;
                    if (REGIME === 'clickhouse') {
                        const t = await clickHouseReport();
                        const events = t.Group_4_0_0_MemberEvents || { rows: 0, bytes: 0 };
                        const current = t.Group_4_0_0_MemberCurrent || { rows: 0, bytes: 0 };
                        const byEntity = t.Group_4_0_0_MemberCurrentByEntity || { rows: 0, bytes: 0 };
                        const totalBytes = events.bytes + current.bytes + byEntity.bytes;

                        // Forward roster: current members of this Group, the query the read path
                        // runs. argMax over the aggregating view, not a plain scan.
                        const forward = await timed('forward', () =>
                            clickHouse.queryAsync({
                                query: `
                                    SELECT entity_reference
                                    FROM Group_4_0_0_MemberCurrent
                                    WHERE group_id = {groupId:String}
                                    GROUP BY group_id, entity_reference
                                    HAVING argMaxMerge(event_type) = 'added'
                                    LIMIT 100
                                `,
                                query_params: { groupId }
                            })
                        );
                        // Reverse lookup: which Groups contain this member.
                        const reverse = await timed('reverse', () =>
                            clickHouse.queryAsync({
                                query: `
                                    SELECT group_id
                                    FROM Group_4_0_0_MemberCurrentByEntity
                                    WHERE entity_reference = {ref:String}
                                    GROUP BY entity_reference, group_id
                                    HAVING argMaxMerge(event_type) = 'added'
                                `,
                                query_params: { ref: `Patient/scale-${Math.floor(loaded / 2)}` }
                            })
                        );

                        // DQM-shaped temporal query: who joined the cohort during a window.
                        // This is the question the analytical consumers actually ask, and it is
                        // the one Mongo cannot express at all, since nothing distinguishes an
                        // add from an update there.
                        const temporal = await timed('temporal', () =>
                            clickHouse.queryAsync({
                                query: `
                                    SELECT count() AS added
                                    FROM Group_4_0_0_MemberEvents
                                    WHERE group_id = {groupId:String}
                                      AND event_type = 'added'
                                      AND event_time >= {since:DateTime64(3)}
                                `,
                                query_params: {
                                    groupId,
                                    since: new Date(runStarted).toISOString().replace('T', ' ').slice(0, 23)
                                }
                            })
                        );

                        body = [
                            `events             ${events.rows.toLocaleString()} rows  ${mb(events.bytes)}`,
                            `current            ${current.rows.toLocaleString()} rows  ${mb(current.bytes)}`,
                            `currentByEntity    ${byEntity.rows.toLocaleString()} rows  ${mb(byEntity.bytes)}`,
                            `total on disk      ${mb(totalBytes)}`,
                            `forward page 100   ${forward.ms}ms (${(forward.result || []).length} rows)`,
                            `reverse lookup     ${reverse.ms}ms (${(reverse.result || []).length} rows)`,
                            `temporal added     ${temporal.ms}ms (${(temporal.result || [])[0]?.added ?? '?'} events)`,
                            ''
                        ];
                    } else {
                        const live = await collectionReport(GROUP_MEMBER_COLLECTION_NAME);
                        const history = await collectionReport(GROUP_MEMBER_HISTORY_COLLECTION_NAME);

                        const forward = await timed('forward', () =>
                            db.collection(GROUP_MEMBER_COLLECTION_NAME).find({ groupUuid }).limit(100).toArray()
                        );
                        const reverseDoc = await db
                            .collection(GROUP_MEMBER_COLLECTION_NAME)
                            .findOne({ 'member.entity.reference': `Patient/scale-${Math.floor(loaded / 2)}` });
                        const reverse = await timed('reverse', () =>
                            reverseDoc
                                ? db
                                      .collection(GROUP_MEMBER_COLLECTION_NAME)
                                      .find({ 'member.entity._uuid': reverseDoc.member.entity._uuid })
                                      .toArray()
                                : Promise.resolve([])
                        );

                        body = [
                            `live docs          ${live.count.toLocaleString()} rows  data ${mb(live.storageSize)}  idx ${mb(live.totalIndexSize)}`,
                            `history docs       ${history.count.toLocaleString()} rows  data ${mb(history.storageSize)}  idx ${mb(history.totalIndexSize)}`,
                            `total on disk      ${mb(live.storageSize + live.totalIndexSize + history.storageSize + history.totalIndexSize)}`,
                            `forward page 100   ${forward.ms}ms (${forward.result.length} rows)`,
                            `reverse lookup     ${reverse.ms}ms (${reverse.result.length} rows)`,
                            ''
                        ];
                    }

                    report([...header, ...body].join('\n'));

                    windowStarted = Date.now();
                    windowLoaded = 0;
                    nextCheckpointIndex++;
                }
            }

            if (REGIME === 'mongo') {
                const finalLive = await collectionReport(GROUP_MEMBER_COLLECTION_NAME);
                expect(finalLive.count).toBe(TARGET);
            } else {
                const t = await clickHouseReport();
                expect((t.Group_4_0_0_MemberEvents || { rows: 0 }).rows).toBeGreaterThanOrEqual(TARGET);
            }
        },
        24 * 60 * 60 * 1000
    );
});
