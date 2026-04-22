#!/usr/bin/env node
/**
 * Migrate AuditEvent data from Atlas Online Archive (via Data Federation) to ClickHouse.
 *
 * Processes ~55TB of AuditEvent documents across ~1,553 daily partitions with
 * configurable concurrency. Resume-safe via ClickHouse state table.
 *
 * Usage:
 *   node src/admin/scripts/migrateAuditEventsToClickhouse.js [options]
 *
 * Environment Variables (required):
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL  Online Archive connection string
 *   AUDIT_EVENT_MONGO_USERNAME  MongoDB username (optional if URL has creds)
 *   AUDIT_EVENT_MONGO_PASSWORD  MongoDB password (optional if URL has creds)
 *   AUDIT_EVENT_MONGO_DB_NAME   Source database name (default: fhir)
 *
 * Options:
 *   --collection <name>      Source collection name (default: AuditEvent_4_0_0)
 *   --start-date <YYYY-MM-DD> Start date inclusive (default: 2022-01-01)
 *   --end-date <YYYY-MM-DD>  End date exclusive (default: 2026-04-01)
 *   --batch-size <n>         Documents per ClickHouse insert batch (default: 50000)
 *   --concurrency <n>        Number of concurrent day-workers (default: 3)
 *   --dry-run                Count source docs and seed state without inserting
 *   --verify-only            Skip migration, run count verification only
 *   --resume                 Resume from incomplete partitions
 *   --show-state             Print audit_event_migration_state rows (no archive creds required)
 *   --delete-partitions <days> Delete AuditEvent rows for given YYYY-MM-DD days and reset state
 *   --help, -h               Show this help
 *
 * Examples:
 *   # Dry run to see partition counts
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL="mongodb://..." \
 *     node src/admin/scripts/migrateAuditEventsToClickhouse.js --dry-run
 *
 *   # Full migration with higher concurrency (increase heap for more workers)
 *   NODE_OPTIONS=--max-old-space-size=8192 \
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL="mongodb://..." \
 *     node src/admin/scripts/migrateAuditEventsToClickhouse.js --concurrency 6
 *
 *   # Resume after interruption
 *   node src/admin/scripts/migrateAuditEventsToClickhouse.js --resume
 *
 *   # Verify counts after migration
 *   node src/admin/scripts/migrateAuditEventsToClickhouse.js --verify-only
 */

const { MongoClient } = require('mongodb');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');
const {
    MigrationStateManager,
    generateDailyPartitions
} = require('../utils/migrationStateManager');
const { PartitionWorker } = require('../utils/partitionWorker');
const { MigrationVerifier } = require('../utils/migrationVerifier');

/**
 * Builds the Online Archive MongoDB connection URL from environment variables.
 * Mirrors the pattern in src/config.js for AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL.
 * @returns {{mongoUrl: string, dbName: string}}
 */
function buildMongoUrl() {
    const env = process.env;
    let mongoUrl = env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL || '';

    if (!mongoUrl) {
        logError('AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL environment variable is required');
        process.exit(1);
    }

    if (env.AUDIT_EVENT_MONGO_USERNAME !== undefined) {
        const username = encodeURIComponent(env.AUDIT_EVENT_MONGO_USERNAME);
        const password = encodeURIComponent(env.AUDIT_EVENT_MONGO_PASSWORD);
        mongoUrl = mongoUrl.replace(
            'mongodb://',
            `mongodb://${username}:${password}@`
        );
    }
    const dbName = env.AUDIT_EVENT_MONGO_DB_NAME || 'fhir';

    return { mongoUrl, dbName };
}

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        collection: 'AuditEvent_4_0_0',
        startDate: '2022-01-01',
        endDate: '2026-04-01',
        batchSize: 50000,
        concurrency: 3,
        dryRun: false,
        verifyOnly: false,
        resume: false,
        showState: false,
        deletePartitions: null // Array<string> of 'YYYY-MM-DD' once parsed
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--collection':
                options.collection = args[++i];
                break;
            case '--start-date':
                options.startDate = args[++i];
                break;
            case '--end-date':
                options.endDate = args[++i];
                break;
            case '--batch-size':
                options.batchSize = parseInt(args[++i]);
                break;
            case '--concurrency':
                options.concurrency = parseInt(args[++i]);
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--verify-only':
                options.verifyOnly = true;
                break;
            case '--resume':
                options.resume = true;
                break;
            case '--show-state':
                options.showState = true;
                break;
            case '--delete-partitions':
                options.deletePartitions = args[++i]
                    .split(',')
                    .map((d) => d.trim())
                    .filter(Boolean);
                break;
            case '--help':
            case '-h':
                logInfo(`
Usage: node src/admin/scripts/migrateAuditEventsToClickhouse.js [options]

Environment Variables (required):
  AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL  Online Archive connection string
  AUDIT_EVENT_MONGO_USERNAME  MongoDB username (optional)
  AUDIT_EVENT_MONGO_PASSWORD  MongoDB password (optional)
  AUDIT_EVENT_MONGO_DB_NAME   Source database name (default: fhir)

Options:
  --collection <name>      Source collection (default: AuditEvent_4_0_0)
  --start-date <YYYY-MM-DD> Start date inclusive (default: 2022-01-01)
  --end-date <YYYY-MM-DD>  End date exclusive (default: 2026-04-01)
  --batch-size <n>         Docs per batch (default: 50000)
  --concurrency <n>        Concurrent workers (default: 3)
  --dry-run                Seed state, count docs, don't insert
  --verify-only            Run count verification only
  --resume                 Resume incomplete partitions
  --show-state             Print audit_event_migration_state rows (ClickHouse only, no archive needed)
  --delete-partitions <days> Comma-separated YYYY-MM-DD list. Deletes AuditEvent rows for
                           those days via ALTER ... DELETE (blocking mutation) and resets
                           the state row to 'pending' so --resume will re-migrate it.
  --help, -h               Show this help
                `);
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
 * Run concurrent workers over a partition queue
 * @param {Object} params
 * @param {Array<{partition_day: string, last_mongo_id: string}>} params.partitions
 * @param {import('mongodb').Db} params.sourceDb
 * @param {string} params.collectionName
 * @param {ClickHouseClientManager} params.clickHouseClientManager
 * @param {MigrationStateManager} params.stateManager
 * @param {number} params.batchSize
 * @param {number} params.concurrency
 * @param {boolean} params.dryRun
 * @returns {Promise<{totalInserted: number, totalSkipped: number, failures: string[]}>}
 */
async function runWorkersAsync({
    partitions,
    sourceDb,
    collectionName,
    clickHouseClientManager,
    stateManager,
    batchSize,
    concurrency,
    dryRun
}) {
    let queueIndex = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    const failures = [];
    const startTime = Date.now();
    const totalPartitions = partitions.length;

    /**
     * Worker loop: grabs next partition from queue, processes it, repeats
     * @param {number} workerId
     */
    async function workerLoop(workerId) {
        while (queueIndex < partitions.length) {
            const idx = queueIndex++;
            const partition = partitions[idx];
            if (!partition) break;

            const {
                partition_day: day,
                last_mongo_id: lastId,
                last_recorded: lastRecorded
            } = partition;

            try {
                const worker = new PartitionWorker({
                    sourceDb,
                    collectionName,
                    clickHouseClientManager,
                    stateManager,
                    batchSize,
                    dryRun
                });

                const result = await worker.processAsync({
                    partitionDay: day,
                    lastMongoId: lastId || '',
                    lastRecorded: lastRecorded || ''
                });

                totalInserted += result.insertedCount;
                totalSkipped += result.skippedCount;

                const completed = idx + 1;
                const elapsed = formatElapsed(Date.now() - startTime);
                logInfo('Partition processed', {
                    dryRun,
                    workerId,
                    partitionDay: day,
                    insertedCount: result.insertedCount,
                    sourceCount: result.sourceCount,
                    progress: `${completed}/${totalPartitions}`,
                    elapsed
                });
            } catch (error) {
                failures.push(day);
                logError('Partition failed', { workerId, partitionDay: day, error: error.message });
            }
        }
    }

    // Launch concurrent workers
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(workerLoop(i + 1));
    }
    await Promise.all(workers);

    return { totalInserted, totalSkipped, failures };
}

/**
 * Print the migration state table.
 *
 * Runs against ClickHouse only — does not require Online Archive credentials,
 * so an operator can check progress with just ClickHouse access. Filters by the
 * same --start-date / --end-date flags the migration modes use, so operators
 * get a consistent slice across runs.
 *
 * @param {Object} params
 * @param {MigrationStateManager} params.stateManager
 * @param {string} params.startDate - inclusive 'YYYY-MM-DD'
 * @param {string} params.endDate - exclusive 'YYYY-MM-DD'
 * @returns {Promise<void>}
 */
async function showMigrationStateAsync({ stateManager, startDate, endDate }) {
    const allStates = await stateManager.getAllStatesAsync();
    const states = allStates.filter(
        (s) => s.partition_day >= startDate && s.partition_day < endDate
    );

    logInfo('Migration state table', {
        table: 'fhir.audit_event_migration_state',
        startDate,
        endDate,
        rows: states.length
    });

    for (const s of states) {
        logInfo('Partition state', {
            partitionDay: s.partition_day,
            status: s.status,
            sourceCount: Number(s.source_count) || 0,
            insertedCount: Number(s.inserted_count) || 0,
            lastMongoId: s.last_mongo_id || '',
            lastRecorded: s.last_recorded || '',
            startedAt: s.started_at || null,
            completedAt: s.completed_at || null,
            errorMessage: s.error_message || ''
        });
    }

    const summary = {
        total: states.length,
        pending: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        totalSource: 0,
        totalInserted: 0
    };
    for (const s of states) {
        summary[s.status] = (summary[s.status] || 0) + 1;
        summary.totalSource += Number(s.source_count) || 0;
        summary.totalInserted += Number(s.inserted_count) || 0;
    }
    logInfo('Migration state summary', summary);
}

/**
 * Validates a YYYY-MM-DD string and normalizes it to canonical form.
 * Rejects malformed input — critical because this string interpolates into an
 * ALTER ... DELETE predicate (though we parameterize, we still want clean data).
 * @param {string} day
 * @returns {string} canonical 'YYYY-MM-DD'
 * @throws {Error} if the date is malformed or invalid
 */
function validatePartitionDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new Error(`Invalid partition day '${day}': expected YYYY-MM-DD`);
    }
    const parsed = new Date(day + 'T00:00:00.000Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
        throw new Error(`Invalid partition day '${day}': not a real calendar date`);
    }
    return day;
}

/**
 * Delete AuditEvent rows for specified partition days and reset their state rows.
 *
 * AuditEvent_4_0_0 is PARTITION BY toYYYYMM(recorded) (monthly), so we can't
 * DROP PARTITION for a single day — we use ALTER TABLE ... DELETE with
 * mutations_sync = 2 so the call blocks until the mutation completes. On a
 * 55TB table this can take minutes per day.
 *
 * State rows are not DELETE-d; they're re-inserted as 'pending' so --resume
 * will re-migrate them. ReplacingMergeTree collapse does the rest.
 *
 * @param {Object} params
 * @param {ClickHouseClientManager} params.clickHouseClientManager
 * @param {MigrationStateManager} params.stateManager
 * @param {string[]} params.days - Array of YYYY-MM-DD strings
 * @returns {Promise<void>}
 */
async function deletePartitionsAsync({ clickHouseClientManager, stateManager, days }) {
    const validated = days.map(validatePartitionDay);

    // Preview what's about to get nuked
    const allStates = await stateManager.getAllStatesAsync();
    const stateByDay = new Map(allStates.map((s) => [s.partition_day, s]));

    logWarn('About to delete partitions', {
        table: 'fhir.AuditEvent_4_0_0',
        days: validated,
        count: validated.length
    });
    for (const day of validated) {
        const s = stateByDay.get(day);
        logWarn('Partition to delete', {
            partitionDay: day,
            currentStatus: s?.status || '(no state row)',
            currentInsertedCount: Number(s?.inserted_count) || 0,
            currentSourceCount: Number(s?.source_count) || 0
        });
    }

    for (const day of validated) {
        logInfo('Deleting AuditEvent rows', { partitionDay: day });
        // mutations_sync = 2 blocks until the mutation finishes on all replicas.
        // Without this, ALTER DELETE returns immediately and the caller can't
        // tell whether the data is actually gone yet.
        await clickHouseClientManager.queryAsync({
            query: `ALTER TABLE fhir.AuditEvent_4_0_0
                    DELETE WHERE toDate(recorded) = {day:String}
                    SETTINGS mutations_sync = 2`,
            query_params: { day }
        });

        logInfo('Resetting migration state row', { partitionDay: day });
        await stateManager.resetPartitionAsync(day);

        logInfo('Partition deleted', { partitionDay: day });
    }

    logInfo('Delete complete', { days: validated, count: validated.length });
}

/**
 * Main migration function
 */
async function main() {
    const options = parseArgs();

    // --show-state and --delete-partitions run without archive credentials;
    // handle before buildMongoUrl() which exits(1) when the archive URL is absent.
    if (options.showState) {
        const configManager = new ConfigManager();
        const clickHouseManager = new ClickHouseClientManager({ configManager });
        await clickHouseManager.getClientAsync();
        const stateManager = new MigrationStateManager({
            clickHouseClientManager: clickHouseManager
        });
        await showMigrationStateAsync({
            stateManager,
            startDate: options.startDate,
            endDate: options.endDate
        });
        await clickHouseManager.closeAsync();
        return;
    }

    if (options.deletePartitions) {
        if (options.deletePartitions.length === 0) {
            logError('--delete-partitions requires at least one YYYY-MM-DD day');
            process.exit(1);
        }
        // Validate days up-front so we fail fast on malformed input — before
        // opening a ClickHouse connection or printing a scary confirmation banner.
        let validatedDays;
        try {
            validatedDays = options.deletePartitions.map(validatePartitionDay);
        } catch (err) {
            logError(err.message);
            process.exit(1);
        }

        const configManager = new ConfigManager();
        const clickHouseManager = new ClickHouseClientManager({ configManager });
        await clickHouseManager.getClientAsync();
        const stateManager = new MigrationStateManager({
            clickHouseClientManager: clickHouseManager
        });
        try {
            await deletePartitionsAsync({
                clickHouseClientManager: clickHouseManager,
                stateManager,
                days: validatedDays
            });
        } finally {
            await clickHouseManager.closeAsync();
        }
        return;
    }

    const { mongoUrl, dbName } = buildMongoUrl();

    const mode = options.dryRun
        ? 'DRY RUN'
        : options.verifyOnly
          ? 'VERIFY ONLY'
          : options.resume
            ? 'RESUME'
            : 'FULL MIGRATION';
    logInfo('AuditEvent Migration: Atlas Archive -> ClickHouse', {
        mode,
        startDate: options.startDate,
        endDate: options.endDate,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        collection: `${dbName}.${options.collection}`
    });

    // Initialize connections
    const configManager = new ConfigManager();
    const clickHouseManager = new ClickHouseClientManager({ configManager });

    logInfo('Connecting to Online Archive MongoDB');
    const mongoClient = await MongoClient.connect(mongoUrl);
    const sourceDb = mongoClient.db(dbName);
    logInfo('Connected to Online Archive MongoDB');

    logInfo('Connecting to ClickHouse');
    await clickHouseManager.getClientAsync();
    logInfo('Connected to ClickHouse');

    const stateManager = new MigrationStateManager({ clickHouseClientManager: clickHouseManager });

    // Generate daily partitions
    const days = generateDailyPartitions(options.startDate, options.endDate);
    logInfo('Daily partitions generated', { total: days.length });

    // Seed state table
    const seeded = await stateManager.seedPartitionsAsync(days);
    if (seeded > 0) {
        logInfo('Seeded new partitions in state table', { seeded });
    }

    // Show current state summary
    const summary = await stateManager.getSummaryAsync();
    logInfo('Current migration state', {
        pending: summary.pending,
        in_progress: summary.in_progress,
        completed: summary.completed,
        failed: summary.failed,
        totalInserted: summary.totalInserted
    });

    // =====================
    // Verify-only mode
    // =====================
    if (options.verifyOnly) {
        logInfo('Starting verification mode');

        const verifier = new MigrationVerifier({
            sourceDb,
            collectionName: options.collection,
            clickHouseClientManager: clickHouseManager,
            stateManager
        });

        const result = await verifier.verifyAllAsync({
            concurrency: options.concurrency,
            startDate: options.startDate,
            endDate: options.endDate
        });

        logInfo('Verification results', { matched: result.matched, mismatched: result.mismatched });

        if (result.mismatches.length > 0) {
            for (const m of result.mismatches) {
                logWarn('Count mismatch', {
                    day: m.day,
                    sourceCount: m.sourceCount,
                    chCount: m.chCount,
                    diff: m.sourceCount - m.chCount
                });
            }
        }

        await mongoClient.close();
        await clickHouseManager.closeAsync();
        process.exit(result.mismatched > 0 ? 1 : 0);
    }

    // =====================
    // Migration mode
    // =====================
    logInfo('Starting migration', { dryRun: options.dryRun });

    // Get partitions to process
    const dateRange = { startDate: options.startDate, endDate: options.endDate };
    let partitions;
    if (options.resume) {
        partitions = await stateManager.getPendingPartitionsAsync(dateRange);
        logInfo('Resuming migration', { partitionsToProcess: partitions.length, ...dateRange });
    } else if (summary.completed > 0 && !options.dryRun) {
        partitions = await stateManager.getPendingPartitionsAsync(dateRange);
        logInfo('Continuing migration', { partitionsRemaining: partitions.length, ...dateRange });
    } else {
        partitions = days.map((day) => ({
            partition_day: day,
            last_mongo_id: '',
            last_recorded: ''
        }));
        logInfo('Processing all partitions', { total: partitions.length });
    }

    if (partitions.length === 0) {
        logInfo('All partitions completed. Run with --verify-only to verify counts.');
        await mongoClient.close();
        await clickHouseManager.closeAsync();
        return;
    }

    const migrationStart = Date.now();

    const result = await runWorkersAsync({
        partitions,
        sourceDb,
        collectionName: options.collection,
        clickHouseClientManager: clickHouseManager,
        stateManager,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        dryRun: options.dryRun
    });

    const elapsed = formatElapsed(Date.now() - migrationStart);

    // Final summary
    const finalSummary = await stateManager.getSummaryAsync();
    logInfo('Migration complete', {
        elapsed,
        insertedRows: result.totalInserted,
        skippedMalformed: result.totalSkipped,
        completedPartitions: `${finalSummary.completed}/${finalSummary.total}`,
        failedPartitions: result.failures.length
    });

    if (result.failures.length > 0) {
        logWarn('Failed partitions (re-run with --resume)', { days: result.failures });
    }

    if (!options.dryRun && result.failures.length === 0) {
        logInfo('All partitions completed. Run with --verify-only to verify counts.');
    }

    await mongoClient.close();
    await clickHouseManager.closeAsync();

    process.exit(result.failures.length > 0 ? 1 : 0);
}

// Run
main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        logError('Fatal error', { error: error.message, stack: error.stack });
        process.exit(1);
    });
