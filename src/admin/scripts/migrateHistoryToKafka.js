#!/usr/bin/env node
/**
 * Move history records of one resource type (default Composition) from the MongoDB history collection
 * to the history Kafka topic, then delete each record from MongoDB once Kafka has acked it.
 *
 * The time range [--start, --end) is split into 1-minute windows on `resource.meta.lastUpdated` (the
 * indexed field of every `*_History` collection; `_recorded` has no index). The collections are sharded on
 * `{ 'resource._uuid': 'hashed' }`, so a window read goes to every shard, each using its own
 * lastUpdated index, and deletes carry the shard key so they reach only the shards that own the records. A pool of workers takes the
 * next window off a shared list until none are left, so windows are processed in parallel.
 *
 * Messages go through the live HistoryKafkaProducer, so topic, key, CloudEvent headers, body, chunk size,
 * compression, retries and timeouts are the same as the live history write. The `_recorded` sent is:
 * - the document's `_recorded`, when it has one
 * - otherwise, for a DELETE entry, the creation time in its MongoDB ObjectId `_id` (when the delete was
 *   written, 1-second precision) plus 5 ms. A delete history entry carries the same versionId as the
 *   last version; the offset keeps it off a whole-second `_recorded` of that version, so the two stay
 *   separate rows in the ClickHouse table (ReplacingMergeTree keyed on resource_type, _uuid, _recorded,
 *   version_id).
 * - otherwise `resource.meta.lastUpdated`
 *
 * A record is deleted from MongoDB only after its produce succeeded. A record that fails (bad document,
 * broker rejection, timeout with an unknown outcome) stays in MongoDB and is logged by its MongoDB `_id`
 * only. Re-running is safe: the key, `ce_id` and `_recorded` are derived from the document, so a
 * record sent twice collapses into one row in ClickHouse.
 * A cloud-storage stub, or a record older than the ClickHouse history TTL for its type, is also left in
 * MongoDB: the first cannot be read from ClickHouse and the second would be dropped there.
 *
 * With --max-lag, each worker waits before taking a window while the lag of the consumer group that loads
 * the topic into ClickHouse is above the limit. The delivered records are already deleted from MongoDB, so
 * the topic is their only copy until that consumer has read them; without the limit the script can outrun
 * it and leave records to expire with the topic's retention. Windows in flight still finish, so the lag
 * can pass the limit by up to `workers` windows. A run stops if the lag cannot be read.
 *
 * Usage:
 *   node src/admin/scripts/migrateHistoryToKafka.js --start 01-11-2026T00:00 --end 02-11-2026T00:00
 */

const { ObjectId } = require('mongodb');
const { BulkInsertUpdateEntry } = require('../../dataLayer/bulkInsertUpdateEntry');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');

const WINDOW_MS = 60 * 1000;
const DELETE_RECORDED_OFFSET_MS = 5;
// Consumer group of the ClickPipe that loads the history topic into ClickHouse (same name in every environment).
const DEFAULT_LAG_GROUP = 'fhir_server-resource-history';
const DEFAULT_LAG_POLL_SECONDS = 30;
// Retention of fhir.Resource_4_0_0_History (clickhouse-init/08-resource-history.sql): rows of these types are
// dropped once `_recorded` is older than 13 months. Keep this list in step with the TTL clause there.
const HISTORY_TTL_MONTHS = 13;
const HISTORY_TTL_RESOURCE_TYPES = new Set([
    'Composition', 'MedicationStatement', 'ExplanationOfBenefit', 'Provenance',
    'Observation', 'AllergyIntolerance', 'Person', 'Patient',
    'QuestionnaireResponse', 'Condition', 'Schedule', 'DocumentReference',
    'Binary', 'Coverage', 'SubscriptionStatus', 'Task',
    'CoverageEligibilityResponse', 'Specimen', 'Slot', 'ServiceRequest',
    'HealthcareService'
]);
const WINDOW_ARG_PATTERN = /^(\d{2})-(\d{2})-(\d{4})T(\d{2}):(\d{2})$/;

const USAGE = `
Usage: node src/admin/scripts/migrateHistoryToKafka.js --start <DD-MM-YYYYTHH:MM> --end <DD-MM-YYYYTHH:MM> [options]

Times are UTC; --start is inclusive and --end exclusive. Records are selected by
resource.meta.lastUpdated in 1-minute windows. MongoDB and Kafka connections come from the
standard FHIR server environment. The resource type must be listed in
RESOURCE_HISTORY_KAFKA_RESOURCES and RESOURCE_HISTORY_CLICKHOUSE_READ_RESOURCES, and
ENABLE_EVENTS_KAFKA_V2 must be on. Types whose history
is kept in cloud storage (CLOUD_STORAGE_HISTORY_RESOURCES) are refused, and for types with a
ClickHouse history TTL --start must be within the last 13 months.

Options:
  --start <time>          Start of the range, e.g. 01-11-2026T00:00 (required)
  --end <time>            End of the range, e.g. 02-11-2026T00:00 (required)
  --resource-type <type>  Resource type to migrate (default: Composition)
  --workers <n>           Windows processed in parallel (default: 4)
  --read-batch-size <n>   Documents read from MongoDB per batch (default: 100)
  --kafka-batch-size <n>  Messages per Kafka produce call (default: RESOURCE_HISTORY_KAFKA_BATCH_SIZE, 50)
  --max-lag <n>           Wait before each window while the consumer group is more than n records behind
                          on the history topic (default: no limit)
  --lag-group <id>        Consumer group whose lag is checked (default: ${DEFAULT_LAG_GROUP})
  --lag-poll-seconds <n>  Seconds between lag checks while waiting (default: ${DEFAULT_LAG_POLL_SECONDS})
  --dry-run               Count the records per window without producing or deleting
  --help, -h              Show this help
`;

/**
 * Parses a DD-MM-YYYYTHH:MM argument as a UTC time.
 * @param {string} flag
 * @param {string|undefined} raw
 * @returns {Date}
 * @throws {Error} on a missing or invalid value
 */
function parseWindowTime (flag, raw) {
    const match = WINDOW_ARG_PATTERN.exec(raw || '');
    if (!match) {
        throw new Error(`${flag} requires a time in the form DD-MM-YYYYTHH:MM, got: ${raw}`);
    }
    const [, day, month, year, hour, minute] = match.map(Number);
    const value = new Date(Date.UTC(year, month - 1, day, hour, minute));
    // Date.UTC rolls over out-of-range parts (31-02 becomes 03-03), so check they round-trip.
    if (value.getUTCDate() !== day || value.getUTCMonth() !== month - 1 || value.getUTCFullYear() !== year ||
        value.getUTCHours() !== hour || value.getUTCMinutes() !== minute) {
        throw new Error(`${flag} is not a valid date/time: ${raw}`);
    }
    return value;
}

/**
 * @param {string} flag
 * @param {string|undefined} raw
 * @returns {number}
 * @throws {Error} unless raw is a positive integer
 */
function parsePositiveInt (flag, raw) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${flag} requires a positive integer, got: ${raw}`);
    }
    return value;
}

/**
 * @param {string[]} argv
 * @returns {{start: Date, end: Date, resourceType: string, workers: number, readBatchSize: number,
 *     kafkaBatchSize: number|null, maxLag: number|null, lagGroup: string, lagPollSeconds: number,
 *     dryRun: boolean, help: boolean}}
 * @throws {Error} on invalid arguments
 */
function parseArgs (argv) {
    const options = {
        start: undefined,
        end: undefined,
        resourceType: 'Composition',
        workers: 4,
        readBatchSize: 100,
        kafkaBatchSize: null,
        maxLag: null,
        lagGroup: DEFAULT_LAG_GROUP,
        lagPollSeconds: DEFAULT_LAG_POLL_SECONDS,
        dryRun: false,
        help: false
    };
    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--start':
                options.start = parseWindowTime('--start', argv[++i]);
                break;
            case '--end':
                options.end = parseWindowTime('--end', argv[++i]);
                break;
            case '--resource-type':
                options.resourceType = argv[++i];
                break;
            case '--workers':
                options.workers = parsePositiveInt('--workers', argv[++i]);
                break;
            case '--read-batch-size':
                options.readBatchSize = parsePositiveInt('--read-batch-size', argv[++i]);
                break;
            case '--kafka-batch-size':
                options.kafkaBatchSize = parsePositiveInt('--kafka-batch-size', argv[++i]);
                break;
            case '--max-lag':
                options.maxLag = parsePositiveInt('--max-lag', argv[++i]);
                break;
            case '--lag-group':
                options.lagGroup = argv[++i];
                break;
            case '--lag-poll-seconds':
                options.lagPollSeconds = parsePositiveInt('--lag-poll-seconds', argv[++i]);
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                return options;
            default:
                throw new Error(`Unknown argument: ${argv[i]}`);
        }
    }
    if (!options.start || !options.end) {
        throw new Error('--start and --end are required');
    }
    if (options.start >= options.end) {
        throw new Error('--start must be before --end');
    }
    if (!options.resourceType || !/^[A-Z][A-Za-z]+$/.test(options.resourceType)) {
        throw new Error(`--resource-type is not a resource type: ${options.resourceType}`);
    }
    if (!options.lagGroup) {
        throw new Error('--lag-group requires a consumer group id');
    }
    return options;
}

/**
 * Splits [start, end) into consecutive windows of windowMs; the last one may be shorter.
 * @param {Date} start
 * @param {Date} end
 * @param {number} [windowMs]
 * @returns {{start: Date, end: Date}[]}
 */
function buildWindows (start, end, windowMs = WINDOW_MS) {
    const windows = [];
    for (let t = start.getTime(); t < end.getTime(); t += windowMs) {
        windows.push({ start: new Date(t), end: new Date(Math.min(t + windowMs, end.getTime())) });
    }
    return windows;
}

/**
 * The `_recorded` to send for a history document: its own `_recorded`; else, for a DELETE entry, the
 * creation time in its ObjectId `_id` plus 5 ms; else `resource.meta.lastUpdated`.
 * @param {Object} doc MongoDB history document
 * @returns {Date}
 * @throws {Error} when the needed value is missing or not a valid date
 */
function resolveRecorded (doc) {
    if (doc._recorded !== undefined && doc._recorded !== null) {
        const recorded = new Date(doc._recorded);
        if (Number.isNaN(recorded.getTime())) {
            throw new Error('_recorded is not a valid date');
        }
        return recorded;
    }
    if (String(doc.request?.method || '').toUpperCase() === 'DELETE') {
        if (!(doc._id instanceof ObjectId)) {
            throw new Error('no _recorded and _id of a DELETE entry is not an ObjectId');
        }
        return new Date(doc._id.getTimestamp().getTime() + DELETE_RECORDED_OFFSET_MS);
    }
    const lastUpdated = new Date(doc.resource?.meta?.lastUpdated);
    if (Number.isNaN(lastUpdated.getTime())) {
        throw new Error('no _recorded and resource.meta.lastUpdated is not a valid date');
    }
    return lastUpdated;
}

/**
 * The oldest `_recorded` ClickHouse keeps for a resource type, or null when the type has no TTL. A record
 * older than this would be dropped by the TTL right after it lands, so it must stay in MongoDB.
 * @param {string} resourceType
 * @param {Date} [now]
 * @returns {Date|null}
 */
function historyRetentionCutoff (resourceType, now = new Date()) {
    if (!HISTORY_TTL_RESOURCE_TYPES.has(resourceType)) {
        return null;
    }
    const cutoff = new Date(now.getTime());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - HISTORY_TTL_MONTHS);
    return cutoff;
}

/**
 * Wraps a MongoDB history document in the entry HistoryKafkaProducer takes. The document is copied with
 * the resolved `_recorded`; the MongoDB document itself is not changed.
 * @param {Object} doc
 * @param {string} resourceType
 * @param {Date|null} [retentionCutoff] records whose `_recorded` is older are refused
 * @returns {BulkInsertUpdateEntry}
 * @throws {Error} when the document cannot become a history message
 */
function toHistoryEntry (doc, resourceType, retentionCutoff = null) {
    // A cloud-storage stub holds a pointer instead of the resource, and ClickHouse history reads reject it.
    if (doc[RESOURCE_CLOUD_STORAGE_PATH_KEY]) {
        throw new Error('history entry is stored in cloud storage');
    }
    const resource = doc.resource;
    if (!resource?._uuid) {
        throw new Error('resource._uuid is missing');
    }
    if (resource.meta?.versionId === undefined || resource.meta?.versionId === null) {
        throw new Error('resource.meta.versionId is missing');
    }
    const recorded = resolveRecorded(doc);
    if (retentionCutoff && recorded < retentionCutoff) {
        throw new Error('_recorded is older than the ClickHouse history retention');
    }
    const document = { ...doc, _recorded: recorded };
    return new BulkInsertUpdateEntry({
        operationType: 'insert',
        isCreateOperation: false,
        isUpdateOperation: false,
        resourceType,
        id: resource.id,
        uuid: resource._uuid,
        resource,
        operation: { insertOne: { document } },
        patches: null,
        skipped: false,
        sourceAssigningAuthority: resource._sourceAssigningAuthority
    });
}

/**
 * MongoDB filter for the delivered records. `*_History` collections are sharded on
 * `{ 'resource._uuid': 'hashed' }`, so the shard key lets mongos send the delete only to the shards that
 * own these records instead of every shard. `_id` alone picks the exact documents.
 * @param {unknown[]} ids MongoDB `_id`s of the delivered records
 * @param {Set<string>} uuids their `resource._uuid`s
 * @returns {Object}
 */
function deliveredFilter (ids, uuids) {
    return { 'resource._uuid': { $in: [...uuids] }, _id: { $in: ids } };
}

/**
 * Produces a batch of history documents, deletes from MongoDB the ones Kafka acked, and logs the batch
 * with the `resource._uuid` of its first and last record.
 * @param {Object} params
 * @param {Object[]} params.docs
 * @param {string} params.resourceType
 * @param {import('mongodb').Collection} params.collection
 * @param {import('../../dataLayer/historyKafkaProducer').HistoryKafkaProducer} params.historyKafkaProducer
 * @param {string} params.requestId
 * @param {Date|null} [params.retentionCutoff] records older than this stay in MongoDB
 * @param {number|null} [params.kafkaBatchSize] messages per produce call; null uses the producer's setting
 * @returns {Promise<{produced: number, deleted: number, failed: number}>}
 */
async function processDocsAsync ({
    docs, resourceType, collection, historyKafkaProducer, requestId, retentionCutoff = null, kafkaBatchSize = null
}) {
    const result = await produceAndDeleteAsync({
        docs, resourceType, collection, historyKafkaProducer, requestId, retentionCutoff, kafkaBatchSize
    });
    logInfo('Batch done', {
        resourceType,
        requestId,
        records: docs.length,
        firstUuid: docs[0]?.resource?._uuid,
        lastUuid: docs[docs.length - 1]?.resource?._uuid,
        ...result
    });
    return result;
}

/**
 * @param {Object} params same as processDocsAsync
 * @returns {Promise<{produced: number, deleted: number, failed: number}>}
 */
async function produceAndDeleteAsync ({
    docs, resourceType, collection, historyKafkaProducer, requestId, retentionCutoff, kafkaBatchSize
}) {
    // produceAsync treats a type it is not enabled for as "nothing to send" and reports no failures,
    // which here would delete records that never reached Kafka.
    if (!historyKafkaProducer.isEnabledFor(resourceType)) {
        throw new Error(`History Kafka produce is not enabled for ${resourceType}`);
    }
    let failed = 0;
    const entries = [];
    for (const doc of docs) {
        try {
            entries.push(toHistoryEntry(doc, resourceType, retentionCutoff));
        } catch (error) {
            failed++;
            logError('History record cannot be converted; left in MongoDB', {
                resourceType, mongoId: String(doc._id), error: error.message
            });
        }
    }
    if (entries.length === 0) {
        return { produced: 0, deleted: 0, failed };
    }

    const failedEntries = new Set(await historyKafkaProducer.produceAsync({
        resourceType, operations: entries, requestId, stopOnBrokerFailure: true, batchSize: kafkaBatchSize
    }));
    const deliveredIds = [];
    const deliveredUuids = new Set();
    for (const entry of entries) {
        const mongoId = entry.operation.insertOne.document._id;
        if (failedEntries.has(entry)) {
            failed++;
            logError('History record not delivered to Kafka; left in MongoDB', {
                resourceType, mongoId: String(mongoId), requestId
            });
        } else {
            deliveredIds.push(mongoId);
            deliveredUuids.add(entry.uuid);
        }
    }

    let deleted = 0;
    if (deliveredIds.length > 0) {
        const result = await collection.deleteMany(deliveredFilter(deliveredIds, deliveredUuids));
        deleted = result.deletedCount;
        if (deleted !== deliveredIds.length) {
            logWarn('Deleted fewer history records than were delivered', {
                resourceType, requestId, delivered: deliveredIds.length, deleted
            });
        }
    }
    return { produced: deliveredIds.length, deleted, failed };
}

/**
 * @param {{start: Date, end: Date}} window
 * @returns {Object} MongoDB filter for the window
 */
function windowFilter (window) {
    return { 'resource.meta.lastUpdated': { $gte: window.start, $lt: window.end } };
}

/**
 * Why the script must not run for this type and range, or null when it may. A dry run changes nothing, so
 * it is never refused.
 * @param {Object} params
 * @param {string} params.resourceType
 * @param {Date} params.start
 * @param {boolean} params.dryRun
 * @param {Date|null} params.retentionCutoff
 * @param {{isEnabledFor: (resourceType: string) => boolean}} params.historyKafkaProducer
 * @param {{readsFromClickHouse: (resourceType: string) => boolean}} params.historyReadRouter
 * @param {{cloudStorageHistoryResources: string[]}} params.configManager
 * @returns {string|null}
 */
function findRefusalReason ({
    resourceType, start, dryRun, retentionCutoff, historyKafkaProducer, historyReadRouter, configManager
}) {
    if (dryRun) {
        return null;
    }
    if (!historyKafkaProducer.isEnabledFor(resourceType)) {
        return 'history Kafka produce is not enabled for this resource type; set ENABLE_EVENTS_KAFKA_V2 and add ' +
            'it to RESOURCE_HISTORY_KAFKA_RESOURCES';
    }
    // Deleted records are gone from MongoDB, so _history and vread must already be served from ClickHouse.
    if (!historyReadRouter.readsFromClickHouse(resourceType)) {
        return 'history reads for this resource type still come from MongoDB; add it to ' +
            'RESOURCE_HISTORY_CLICKHOUSE_READ_RESOURCES first';
    }
    if (configManager.cloudStorageHistoryResources.includes(resourceType)) {
        return 'history of this resource type is kept in cloud storage and cannot be read from ClickHouse';
    }
    if (retentionCutoff && start < retentionCutoff) {
        return `--start is older than the ClickHouse history retention (${retentionCutoff.toISOString()}); ` +
            'records that old would be dropped by the TTL after leaving MongoDB';
    }
    return null;
}

/**
 * Migrates (or, on a dry run, counts) the records of one window.
 * @param {Object} params
 * @param {{start: Date, end: Date}} params.window
 * @param {string} params.resourceType
 * @param {import('mongodb').Collection} params.collection
 * @param {import('../../dataLayer/historyKafkaProducer').HistoryKafkaProducer} params.historyKafkaProducer
 * @param {number} params.readBatchSize
 * @param {boolean} params.dryRun
 * @param {Date|null} [params.retentionCutoff] records older than this stay in MongoDB
 * @param {number|null} [params.kafkaBatchSize] messages per produce call; null uses the producer's setting
 * @returns {Promise<{read: number, produced: number, deleted: number, failed: number}>}
 */
async function migrateWindowAsync ({
    window, resourceType, collection, historyKafkaProducer, readBatchSize, dryRun, retentionCutoff = null,
    kafkaBatchSize = null
}) {
    const totals = { read: 0, produced: 0, deleted: 0, failed: 0 };
    if (dryRun) {
        totals.read = await collection.countDocuments(windowFilter(window));
        return totals;
    }
    const requestId = `history-migration-${window.start.toISOString()}`;
    const cursor = collection.find(windowFilter(window)).batchSize(readBatchSize);
    const flushAsync = async (docs) => {
        const result = await processDocsAsync({
            docs, resourceType, collection, historyKafkaProducer, requestId, retentionCutoff, kafkaBatchSize
        });
        totals.produced += result.produced;
        totals.deleted += result.deleted;
        totals.failed += result.failed;
    };
    try {
        let batch = [];
        for await (const doc of cursor) {
            totals.read++;
            batch.push(doc);
            if (batch.length >= readBatchSize) {
                await flushAsync(batch);
                batch = [];
            }
        }
        if (batch.length > 0) {
            await flushAsync(batch);
        }
    } finally {
        await cursor.close();
    }
    return totals;
}

/**
 * How many records a consumer group still has to read from a topic: per partition, the end offset minus
 * the group's committed offset. A partition the group has not committed on counts from its first offset.
 * @param {Object} params
 * @param {import('kafkajs').Admin} params.admin connected admin client
 * @param {string} params.groupId
 * @param {string} params.topic
 * @returns {Promise<number>}
 */
async function consumerLagAsync ({ admin, groupId, topic }) {
    const [topicOffsets, groupOffsets] = await Promise.all([
        admin.fetchTopicOffsets(topic),
        admin.fetchOffsets({ groupId, topics: [topic] })
    ]);
    const committed = new Map(
        (groupOffsets[0]?.partitions ?? []).map(({ partition, offset }) => [partition, Number(offset)])
    );
    let lag = 0;
    for (const { partition, high, low } of topicOffsets) {
        const offset = committed.get(partition);
        const position = offset === undefined || offset < 0 ? Number(low) : offset;
        lag += Math.max(0, Number(high) - position);
    }
    return lag;
}

/**
 * Builds the wait a worker runs before it takes a window: it resolves once the lag is at or below
 * `maxLag`, or the run is aborted. One reading is shared by all workers for `pollMs`, so the broker is
 * asked at most once per interval however many workers there are.
 * @param {Object} params
 * @param {() => Promise<number>} params.readLagAsync
 * @param {number} params.maxLag
 * @param {number} params.pollMs
 * @param {{aborted: boolean}} params.abortFlag
 * @param {(ms: number) => Promise<void>} [params.sleepAsync]
 * @param {() => number} [params.now] clock in ms
 * @returns {() => Promise<void>} rejects when the lag cannot be read
 */
function createLagGate ({
    readLagAsync, maxLag, pollMs, abortFlag,
    sleepAsync = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now
}) {
    let reading = null;
    const currentLagAsync = () => {
        if (!reading || now() - reading.at >= pollMs) {
            reading = { at: now(), lag: readLagAsync() };
        }
        return reading.lag;
    };
    return async () => {
        while (!abortFlag.aborted) {
            const lag = await currentLagAsync();
            if (lag <= maxLag) {
                return;
            }
            logInfo('Consumer lag is above the limit; waiting', { lag, maxLag, pollSeconds: pollMs / 1000 });
            await sleepAsync(pollMs);
        }
    };
}

/**
 * Runs `workers` loops that each take the next window from the list until it is empty or the run is
 * aborted. A window that throws stops the whole run, after the windows already in flight finish.
 * @param {Object} params
 * @param {{start: Date, end: Date}[]} params.windows
 * @param {number} params.workers
 * @param {() => Promise<void>} [params.beforeWindowAsync] awaited before each window is taken
 * @param {(window: {start: Date, end: Date}) => Promise<void>} params.processWindowAsync
 * @param {{aborted: boolean}} params.abortFlag
 * @returns {Promise<void>}
 */
async function runWorkersAsync ({ windows, workers, processWindowAsync, abortFlag, beforeWindowAsync = null }) {
    let next = 0;
    const errors = [];
    const workerAsync = async () => {
        while (!abortFlag.aborted && next < windows.length) {
            try {
                if (beforeWindowAsync) {
                    await beforeWindowAsync();
                    if (abortFlag.aborted || next >= windows.length) {
                        break;
                    }
                }
                await processWindowAsync(windows[next++]);
            } catch (error) {
                abortFlag.aborted = true;
                errors.push(error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(workers, windows.length) }, workerAsync));
    if (errors.length > 0) {
        throw errors[0];
    }
}

/**
 * @returns {Promise<number>} exit code: 0 when every record moved, 1 otherwise
 */
async function main () {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        logError(error.message);
        logInfo(USAGE);
        return 1;
    }
    if (options.help) {
        logInfo(USAGE);
        return 0;
    }

    // Required here, not at the top, so the helpers can be unit-tested without loading the whole server.
    const { createContainer } = require('../../createContainer');
    const container = createContainer();
    const { mongoDatabaseManager, kafkaClientV2, historyKafkaProducer } = container;
    const { resourceType } = options;

    const retentionCutoff = historyRetentionCutoff(resourceType);
    const refusal = findRefusalReason({
        resourceType,
        start: options.start,
        dryRun: options.dryRun,
        retentionCutoff,
        historyKafkaProducer,
        historyReadRouter: container.historyReadRouter,
        configManager: container.configManager
    });
    if (refusal) {
        logError(`Refusing to migrate: ${refusal}`, { resourceType, start: options.start.toISOString() });
        return 1;
    }

    const windows = buildWindows(options.start, options.end);
    const collectionName = `${resourceType}_4_0_0_History`;
    logInfo('History migration: MongoDB -> Kafka', {
        collection: collectionName,
        topic: container.configManager.resourceHistoryKafkaTopic,
        start: options.start.toISOString(),
        end: options.end.toISOString(),
        windows: windows.length,
        workers: options.workers,
        readBatchSize: options.readBatchSize,
        kafkaBatchSize: options.kafkaBatchSize ?? container.configManager.resourceHistoryKafkaBatchSize,
        maxLag: options.maxLag,
        lagGroup: options.maxLag === null ? undefined : options.lagGroup,
        dryRun: options.dryRun
    });

    const abortFlag = { aborted: false };
    const onSignal = (signal) => {
        if (!abortFlag.aborted) {
            abortFlag.aborted = true;
            logWarn('Received signal; finishing the windows in flight, then exiting', { signal });
        }
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    const startedAt = Date.now();
    const totals = { windows: 0, read: 0, produced: 0, deleted: 0, failed: 0 };
    let admin = null;
    try {
        const historyDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        const collection = historyDb.collection(collectionName);

        // A dry run produces nothing, so it has no lag to wait for.
        let beforeWindowAsync = null;
        if (options.maxLag !== null && !options.dryRun) {
            admin = kafkaClientV2.createAdminClient();
            await admin.connect();
            beforeWindowAsync = createLagGate({
                readLagAsync: () => consumerLagAsync({
                    admin, groupId: options.lagGroup, topic: container.configManager.resourceHistoryKafkaTopic
                }),
                maxLag: options.maxLag,
                pollMs: options.lagPollSeconds * 1000,
                abortFlag
            });
        }

        await runWorkersAsync({
            windows,
            workers: options.workers,
            abortFlag,
            beforeWindowAsync,
            processWindowAsync: async (window) => {
                const result = await migrateWindowAsync({
                    window,
                    resourceType,
                    collection,
                    historyKafkaProducer,
                    readBatchSize: options.readBatchSize,
                    dryRun: options.dryRun,
                    retentionCutoff,
                    kafkaBatchSize: options.kafkaBatchSize
                });
                totals.windows++;
                totals.read += result.read;
                totals.produced += result.produced;
                totals.deleted += result.deleted;
                totals.failed += result.failed;
                if (result.read > 0) {
                    logInfo('Window done', {
                        windowStart: window.start.toISOString(), ...result, windowsDone: totals.windows
                    });
                }
            }
        });

        logInfo('History migration finished', {
            ...totals,
            windowsTotal: windows.length,
            aborted: abortFlag.aborted,
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000)
        });
        return abortFlag.aborted || totals.failed > 0 ? 1 : 0;
    } catch (error) {
        logError('History migration stopped', { ...totals, error: error.message });
        return 1;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        await admin?.disconnect().catch((error) => {
            logWarn('Kafka admin disconnect failed', { error: error.message });
        });
        await mongoDatabaseManager.disconnectAsync();
        await kafkaClientV2.disconnect();
    }
}

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((error) => {
            logError('Fatal error', { error: error.message, stack: error.stack });
            process.exit(1);
        });
}

module.exports = {
    parseWindowTime,
    parseArgs,
    buildWindows,
    resolveRecorded,
    historyRetentionCutoff,
    findRefusalReason,
    toHistoryEntry,
    processDocsAsync,
    migrateWindowAsync,
    runWorkersAsync,
    consumerLagAsync,
    createLagGate
};
