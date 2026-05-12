#!/usr/bin/env node
/**
 * Copy AuditEvent documents from MongoDB to ClickHouse, oldest first, and delete
 * each batch from MongoDB after the ClickHouse insert succeeds.
 *
 * The live MongoDB collection is itself the progress ledger — documents that
 * remain have not yet been copied. A crash between the ClickHouse insert and
 * the Mongo delete leaves at most one batch of duplicates in ClickHouse on
 * re-run; this is accepted.
 *
 * MongoDB and ClickHouse connections are obtained from the shared IoC container
 * (`createContainer`), so this script honours the same environment variables the
 * rest of the FHIR server uses — including `AUDIT_EVENT_MONGO_URL` when audit
 * events live on a dedicated cluster.
 *
 * Usage:
 *   node src/admin/scripts/migrateAuditEventsToClickhouse.js [options]
 */

const { createContainer } = require('../../createContainer');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');

const USAGE = `
Usage: node src/admin/scripts/migrateAuditEventsToClickhouse.js [options]

MongoDB and ClickHouse connections are read from the standard FHIR server
environment (see src/config.js). Ensure ENABLE_CLICKHOUSE=1 and the
appropriate MONGO_*/AUDIT_EVENT_MONGO_*/CLICKHOUSE_* variables are set for
the target environment.

Options:
  --collection <name>  Source collection (default: AuditEvent_4_0_0)
  --batch-size <n>     Docs per ClickHouse insert + Mongo delete (default: 10000)
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
 * @returns {{collection: string, batchSize: number}}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        collection: 'AuditEvent_4_0_0',
        batchSize: 10000
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--collection':
                options.collection = args[++i];
                break;
            case '--batch-size':
                options.batchSize = parsePositiveInt('--batch-size', args[++i]);
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
 * Insert rows into ClickHouse with retry. On a size-related failure, recursively
 * splits the batch in half; on other failures, retries with exponential backoff
 * up to maxRetries.
 *
 * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} clickHouseClientManager
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
async function insertWithRetryAsync(clickHouseClientManager, rows) {
    const MIN_CHUNK_SIZE = 1000;

    try {
        await clickHouseClientManager.insertAsync({
            table: 'fhir.AuditEvent_4_0_0',
            values: rows,
            format: 'JSONEachRow'
        });
    } catch (error) {
        const errorMsg = error.original_error?.message || error.nested?.message || error.message;
        const isSizeError =
            errorMsg === 'Invalid string length' ||
            errorMsg.includes('string length') ||
            errorMsg.includes('allocation failed');

        if (isSizeError && rows.length > MIN_CHUNK_SIZE) {
            const mid = Math.ceil(rows.length / 2);
            logWarn('ClickHouse insert failed due to payload size, splitting batch', {
                originalSize: rows.length,
                newSize: mid,
                error: error.message
            });
            await insertWithRetryAsync(clickHouseClientManager, rows.slice(0, mid));
            await insertWithRetryAsync(clickHouseClientManager, rows.slice(mid));
            return;
        }

        const maxRetries = 3;
        let delay = 2000;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await clickHouseClientManager.insertAsync({
                    table: 'fhir.AuditEvent_4_0_0',
                    values: rows,
                    format: 'JSONEachRow'
                });
                return;
            } catch (retryError) {
                if (attempt === maxRetries) {
                    throw new Error(
                        `ClickHouse insert failed after ${maxRetries} attempts (batch size ${rows.length}): ${retryError.message}`
                    );
                }
                logWarn('ClickHouse insert failed, retrying', {
                    attempt,
                    batchSize: rows.length,
                    delay,
                    error: retryError.message
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }
}

/**
 * Transform docs, insert the rows into ClickHouse, then delete the batch's
 * source docs from Mongo by _id. A malformed source doc (missing `_uuid` or
 * `recorded`) causes the ClickHouse insert to fail, which aborts the whole
 * run — no Mongo delete runs for a batch that didn't land.
 *
 * @param {Object} params
 * @param {Object[]} params.docs
 * @param {import('mongodb').Collection} params.collection
 * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
 * @param {AuditEventTransformer} params.transformer
 * @returns {Promise<{inserted: number, deleted: number}>}
 */
async function processBatchAsync({ docs, collection, clickHouseClientManager, transformer }) {
    const { rows } = transformer.transformBatch(docs);

    if (rows.length > 0) {
        await insertWithRetryAsync(clickHouseClientManager, rows);
    }

    const ids = docs.map((doc) => doc._id);
    const deleteResult = await collection.deleteMany({ _id: { $in: ids } });
    if (deleteResult.deletedCount !== ids.length) {
        logWarn('Source deleteMany returned fewer deletions than requested', {
            requested: ids.length,
            deleted: deleteResult.deletedCount
        });
    }

    return { inserted: rows.length, deleted: deleteResult.deletedCount };
}

/**
 * Main migration loop. Returns the exit code; the outer IIFE owns process.exit.
 * @returns {Promise<number>}
 */
async function main() {
    const options = parseArgs();

    logInfo('AuditEvent Migration: MongoDB -> ClickHouse', {
        collection: options.collection,
        batchSize: options.batchSize
    });

    const container = createContainer();
    const mongoDatabaseManager = container.mongoDatabaseManager;
    const clickHouseClientManager = container.clickHouseClientManager;
    const transformer = new AuditEventTransformer();

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
    let batchNo = 0;

    try {
        logInfo('Connecting to MongoDB (audit event config)');
        const auditDb = await mongoDatabaseManager.getAuditDbAsync();
        logInfo('Connected to MongoDB', { db: auditDb.databaseName });

        logInfo('Connecting to ClickHouse');
        await clickHouseClientManager.getClientAsync();
        logInfo('Connected to ClickHouse');

        const collection = auditDb.collection(options.collection);
        // Sort ascending on `recorded` (with `_id` as a stable tiebreaker for ties)
        // so the oldest events are evacuated first. Re-runs after a crash pick up
        // from wherever the collection currently starts.
        const cursor = collection
            .find({})
            .sort({ recorded: 1, _id: 1 })
            .batchSize(options.batchSize);

        const runBatch = async (docs) => {
            batchNo++;
            try {
                const result = await processBatchAsync({
                    docs,
                    collection,
                    clickHouseClientManager,
                    transformer
                });
                totalInserted += result.inserted;
                totalDeleted += result.deleted;
                logInfo('Batch copied', {
                    batchNo,
                    inserted: result.inserted,
                    deleted: result.deleted,
                    cumulativeInserted: totalInserted,
                    elapsed: formatElapsed(Date.now() - startTime)
                });
            } catch (error) {
                // Log batch context before the error unwinds so operators know
                // exactly where the run stopped. Then re-throw to halt the
                // migration — no Mongo source docs are deleted for this batch.
                logError('Batch failed; aborting migration', {
                    batchNo,
                    batchSize: docs.length,
                    cumulativeInserted: totalInserted,
                    cumulativeDeleted: totalDeleted,
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
            elapsed: formatElapsed(Date.now() - startTime),
            aborted: abortFlag.aborted
        });

        return abortFlag.aborted ? 1 : 0;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        await mongoDatabaseManager.disconnectAsync();
        await clickHouseClientManager.closeAsync();
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
    formatElapsed,
    insertWithRetryAsync,
    processBatchAsync
};
