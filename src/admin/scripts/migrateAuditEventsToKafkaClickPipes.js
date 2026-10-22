#!/usr/bin/env node
/**
 * Copy AuditEvent documents from MongoDB to ClickHouse via Kafka + ClickPipes,
 * oldest first. Each Mongo batch is published in chunks of
 * AUDIT_EVENT_CLICKPIPE_BATCH_SIZE messages with AUDIT_EVENT_CLICKPIPE_COMPRESSION
 * (the same settings as the live write path), and each chunk is deleted from
 * MongoDB right after its Kafka publish succeeds.
 *
 * The live MongoDB collection is itself the progress ledger — documents that
 * remain have not yet been copied. A crash between a chunk's Kafka publish and
 * its Mongo delete leaves at most one chunk of duplicates in ClickHouse on
 * re-run; this is accepted.
 *
 * A document that fails validation, or a chunk whose Kafka publish exhausts
 * its retries (e.g. an over-sized message), is logged with the offending
 * Mongo _id(s) and the error, then left in the source collection — the
 * migration does not abort and moves on to the next chunk. These leftover
 * documents are picked up again (and will likely fail again unless the
 * underlying cause is fixed) on the next run.
 *
 * Documents are published to the same Kafka topic and in the same message
 * shape (key/value/headers) as the live AuditEvent write path
 * (`KafkaClickPipeBulkWriteExecutor`), so ClickPipes ingests backfilled rows
 * identically to live traffic. A resolved publish call means the Kafka
 * brokers acked the message; ClickPipes then lands it in ClickHouse
 * asynchronously.
 *
 * MongoDB and Kafka connections are obtained from the shared IoC container
 * (`createContainer`), so this script honours the same environment variables
 * the rest of the FHIR server uses — including `AUDIT_EVENT_MONGO_URL` when
 * audit events live on a dedicated cluster, and `ENABLE_EVENTS_KAFKA_V2` /
 * `KAFKA_V2_*` for the Kafka connection.
 *
 * Usage:
 *   node src/admin/scripts/migrateAuditEventsToKafkaClickPipes.js [options]
 */

const { createContainer } = require('../../createContainer');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { KAFKA_TOPICS } = require('../../constants/clickHouseConstants');
const { getKafkaCompressionType } = require('../../utils/kafkaClientV2');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');

const USAGE = `
Usage: node src/admin/scripts/migrateAuditEventsToKafkaClickPipes.js [options]

MongoDB and Kafka connections are read from the standard FHIR server
environment (see src/config.js). Ensure ENABLE_EVENTS_KAFKA_V2=1, the
appropriate KAFKA_V2_* variables, and the MONGO_*/AUDIT_EVENT_MONGO_*
variables are set for the target environment. Kafka publish chunk size and
compression come from AUDIT_EVENT_CLICKPIPE_BATCH_SIZE (default 50) and
AUDIT_EVENT_CLICKPIPE_COMPRESSION (default zstd).

Options:
  --collection <name>  Source collection (default: AuditEvent_4_0_0)
  --batch-size <n>     Docs read from Mongo per batch (default: 1000); each
                        batch is published and deleted in smaller chunks
  --start-from <date>  Only migrate AuditEvents with recorded >= this ISO
                        8601 date/time (default: migrate all, oldest first)
  --help, -h           Show this help
`;

/**
 * Parse a positive integer CLI argument, exiting with a clear error on bad input.
 * @param {string} flag
 * @param {string|undefined} raw
 * @returns {number}
 */
function parsePositiveInt(flag, raw) {
    if (raw === undefined || raw.startsWith('--')) {
        logError(`${flag} requires a positive integer argument`);
        process.exit(1);
    }
    const value = parseInt(raw, 10);
    if (!Number.isInteger(value) || value <= 0) {
        logError(`${flag} requires a positive integer, got: ${raw}`);
        process.exit(1);
    }
    return value;
}

/**
 * Parse an ISO 8601 date/time CLI argument, exiting with a clear error on bad input.
 * @param {string} flag
 * @param {string|undefined} raw
 * @returns {Date}
 */
function parseDateArg(flag, raw) {
    if (raw === undefined || raw.startsWith('--')) {
        logError(`${flag} requires a date/time argument`);
        process.exit(1);
    }
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) {
        logError(`${flag} requires a valid ISO 8601 date/time, got: ${raw}`);
        process.exit(1);
    }
    return value;
}

/**
 * @returns {{collection: string, batchSize: number, startFrom: Date|undefined}}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        collection: 'AuditEvent_4_0_0',
        batchSize: 1000,
        startFrom: undefined
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--collection':
                options.collection = args[++i];
                break;
            case '--batch-size':
                options.batchSize = parsePositiveInt('--batch-size', args[++i]);
                break;
            case '--start-from':
                options.startFrom = parseDateArg('--start-from', args[++i]);
                break;
            case '--help':
            case '-h':
                logInfo(USAGE);
                process.exit(0);
        }
    }

    return options;
}

/**
 * Format elapsed time as HH:MM:SS
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Whether the server is configured to actually deliver Kafka messages.
 * If this is false, `container.kafkaClientV2` resolves to a dummy client
 * whose publish call silently no-ops — this script must never run against it.
 * @param {import('../../config').ConfigManager} configManager
 * @returns {boolean}
 */
function isKafkaPublishEnabled(configManager) {
    return !!configManager.kafkaV2EnableEvents;
}

/**
 * Publish a batch of Kafka messages with retry. Retries with exponential
 * backoff up to maxAttempts; oversized or otherwise unpublishable messages
 * simply exhaust their retries and abort the batch.
 *
 * @param {import('../../utils/kafkaClientV2').KafkaClientV2} kafkaClientV2
 * @param {string} topic
 * @param {Object[]} messages
 * @param {number} [compression] kafkajs CompressionTypes value (default: none)
 * @returns {Promise<void>}
 */
async function publishWithRetryAsync(kafkaClientV2, topic, messages, compression) {
    const maxAttempts = 3;
    let delay = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await kafkaClientV2.sendCloudEventMessageAsync({ topic, messages, compression });
            return;
        } catch (error) {
            if (attempt === maxAttempts) {
                throw new Error(
                    `Kafka publish failed after ${maxAttempts} attempts (batch size ${messages.length}): ${error.message}`
                );
            }
            logWarn('Kafka publish failed, retrying', {
                attempt,
                batchSize: messages.length,
                delay,
                error: error.message
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}

/**
 * `_uuid` and `recorded` are non-nullable ORDER BY/PARTITION BY columns in
 * clickhouse-init/02-audit-event.sql. The old direct-ClickHouse-insert path
 * relied on ClickHouse to reject a row missing either one; Kafka does not
 * validate message content at all (e.g. an undefined key just means "no
 * key"), so a malformed row would otherwise publish successfully and its
 * Mongo source would be deleted. Validate explicitly instead.
 * @param {Object} row
 * @throws {Error} if a required column is missing
 */
function assertValidRow(row) {
    if (!row._uuid || !row.recorded) {
        throw new Error(
            `AuditEvent row is missing a required field (_uuid=${row._uuid}, recorded=${row.recorded})`
        );
    }
}

/**
 * Transform docs, then publish the valid rows to Kafka in chunks of
 * `publishBatchSize`, deleting each chunk from Mongo once its publish
 * succeeds. A doc that fails validation (missing `_uuid` or `recorded`) is
 * logged and excluded before publishing; if a chunk's Kafka publish exhausts
 * its retries, none of that chunk's docs are deleted (other chunks are
 * unaffected). Either way the affected doc(s) are logged with their
 * Mongo _id and the error, and are simply left in Mongo — this function
 * never throws for these cases, so a bad batch does not abort the run.
 *
 * @param {Object} params
 * @param {Object[]} params.docs
 * @param {import('mongodb').Collection} params.collection
 * @param {import('../../utils/kafkaClientV2').KafkaClientV2} params.kafkaClientV2
 * @param {string} params.topic
 * @param {AuditEventTransformer} params.transformer
 * @param {number} params.batchNo
 * @param {number} [params.publishBatchSize=50] max messages per Kafka publish
 * @param {number} [params.compression] kafkajs CompressionTypes value (default: none)
 * @returns {Promise<{inserted: number, deleted: number, failed: number}>}
 */
async function processBatchAsync({
    docs,
    collection,
    kafkaClientV2,
    topic,
    transformer,
    batchNo,
    publishBatchSize = 50,
    compression
}) {
    let failedCount = 0;
    const publishable = [];
    // Transform docs one at a time (rather than transformer.transformBatch, which
    // maps the whole array in one shot) so a single doc that throws during
    // transformation — e.g. a missing `recorded` blowing up toClickHouseDateTime —
    // doesn't abort every other doc's transform along with it.
    docs.forEach((doc) => {
        try {
            const row = transformer.transformDocument(doc);
            assertValidRow(row);
            publishable.push({
                id: doc._id,
                message: {
                    key: row._uuid,
                    value: JSON.stringify(row),
                    headers: { version: 'R4', requestId: `migration-batch-${batchNo}` }
                }
            });
        } catch (error) {
            failedCount++;
            logError('AuditEvent failed transformation/validation; leaving in Mongo, not migrated', {
                batchNo,
                auditEventId: doc._id,
                error: error.message
            });
        }
    });

    let publishedCount = 0;
    let deletedCount = 0;

    for (let i = 0; i < publishable.length; i += publishBatchSize) {
        const chunk = publishable.slice(i, i + publishBatchSize);
        const chunkIds = chunk.map((p) => p.id);
        try {
            await publishWithRetryAsync(kafkaClientV2, topic, chunk.map((p) => p.message), compression);
        } catch (error) {
            failedCount += chunk.length;
            logError('Kafka publish failed for chunk after retries; leaving AuditEvents in Mongo, not migrated', {
                batchNo,
                chunkSize: chunk.length,
                auditEventIds: chunkIds,
                error: error.message
            });
            continue;
        }
        publishedCount += chunk.length;

        const deleteResult = await collection.deleteMany({ _id: { $in: chunkIds } });
        deletedCount += deleteResult.deletedCount;
        if (deleteResult.deletedCount !== chunkIds.length) {
            logWarn('Source deleteMany returned fewer deletions than requested', {
                requested: chunkIds.length,
                deleted: deleteResult.deletedCount
            });
        }
    }

    return { inserted: publishedCount, deleted: deletedCount, failed: failedCount };
}

/**
 * Main migration loop. Returns the exit code; the outer IIFE owns process.exit.
 * @returns {Promise<number>}
 */
async function main() {
    const options = parseArgs();
    const container = createContainer();
    const publishBatchSize = container.configManager.auditEventClickPipeBatchSize;
    const compressionName = container.configManager.auditEventClickPipeCompression;
    const compression = getKafkaCompressionType(compressionName);

    logInfo('AuditEvent Migration: MongoDB -> Kafka/ClickPipes', {
        collection: options.collection,
        batchSize: options.batchSize,
        publishBatchSize,
        compression: compressionName,
        startFrom: options.startFrom ? options.startFrom.toISOString() : undefined
    });

    const mongoDatabaseManager = container.mongoDatabaseManager;
    const kafkaClientV2 = container.kafkaClientV2;
    const transformer = new AuditEventTransformer();
    const topic = KAFKA_TOPICS.AUDIT_EVENT;

    if (!isKafkaPublishEnabled(container.configManager)) {
        logError(
            'Kafka publishing is disabled (ENABLE_EVENTS_KAFKA_V2 is not set); ' +
            'refusing to run since messages would be silently dropped. Set ' +
            'ENABLE_EVENTS_KAFKA_V2=1 and the KAFKA_V2_* connection variables.'
        );
        return 1;
    }

    const abortFlag = { aborted: false };
    const onSignal = (signal) => {
        if (abortFlag.aborted) return;
        abortFlag.aborted = true;
        logWarn('Received signal; finishing in-flight batch then exiting', { signal });
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    const startTime = Date.now();
    let totalInserted = 0;
    let totalDeleted = 0;
    let totalFailed = 0;
    let batchNo = 0;

    try {
        logInfo('Connecting to MongoDB (audit event config)');
        const auditDb = await mongoDatabaseManager.getAuditDbAsync();
        logInfo('Connected to MongoDB', { db: auditDb.databaseName });

        const collection = auditDb.collection(options.collection);
        // `recorded` is stored as a native Date (see DateColumnHandler in the
        // preSave pipeline), so --start-from is compared against a Date, not
        // a string.
        const filter = options.startFrom ? { recorded: { $gte: options.startFrom } } : {};
        // Sort ascending on `recorded` (with `_id` as a stable tiebreaker for ties)
        // so the oldest events are evacuated first. Re-runs after a crash pick up
        // from wherever the collection currently starts.
        const cursor = collection
            .find(filter)
            .sort({ recorded: 1, _id: 1 })
            .batchSize(options.batchSize);

        const runBatch = async (docs) => {
            batchNo++;
            try {
                const result = await processBatchAsync({
                    docs,
                    collection,
                    kafkaClientV2,
                    topic,
                    transformer,
                    batchNo,
                    publishBatchSize,
                    compression
                });
                totalInserted += result.inserted;
                totalDeleted += result.deleted;
                totalFailed += result.failed;
                logInfo('Batch copied', {
                    batchNo,
                    inserted: result.inserted,
                    deleted: result.deleted,
                    failed: result.failed,
                    cumulativeInserted: totalInserted,
                    cumulativeFailed: totalFailed,
                    elapsed: formatElapsed(Date.now() - startTime)
                });
            } catch (error) {
                // processBatchAsync only throws for unexpected infra errors
                // (e.g. Mongo deleteMany failing) — per-doc validation
                // failures and Kafka publish failures are handled and logged
                // inside it without throwing. Log batch context before the
                // error unwinds so operators know exactly where the run
                // stopped, then re-throw to halt the migration.
                logError('Batch failed; aborting migration', {
                    batchNo,
                    batchSize: docs.length,
                    cumulativeInserted: totalInserted,
                    cumulativeDeleted: totalDeleted,
                    cumulativeFailed: totalFailed,
                    elapsed: formatElapsed(Date.now() - startTime),
                    error: error.message
                });
                throw error;
            }
        };

        try {
            let batch = [];
            while (await cursor.hasNext()) {
                if (abortFlag.aborted) break;
                batch.push(await cursor.next());
                if (batch.length >= options.batchSize) {
                    await runBatch(batch);
                    batch = [];
                }
            }

            if (batch.length > 0) {
                await runBatch(batch);
            }
        } finally {
            await cursor.close();
        }

        logInfo('Migration complete', {
            totalBatches: batchNo,
            totalInserted,
            totalDeleted,
            totalFailed,
            elapsed: formatElapsed(Date.now() - startTime),
            aborted: abortFlag.aborted
        });

        return abortFlag.aborted ? 1 : 0;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        await mongoDatabaseManager.disconnectAsync();
        await kafkaClientV2.disconnect();
    }
}

if (require.main === module) {
    main()
        .then((code) => {
            process.exit(code);
        })
        .catch((error) => {
            logError('Fatal error', { error: error.message, stack: error.stack });
            process.exit(1);
        });
}

module.exports = {
    parsePositiveInt,
    parseDateArg,
    formatElapsed,
    isKafkaPublishEnabled,
    publishWithRetryAsync,
    processBatchAsync
};
