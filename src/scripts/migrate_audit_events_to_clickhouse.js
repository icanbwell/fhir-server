#!/usr/bin/env node
/**
 * Migrate AuditEvent data from Atlas Online Archive (via Data Federation) to ClickHouse.
 *
 * Processes ~55TB of AuditEvent documents across ~1,553 daily partitions with
 * configurable concurrency. Resume-safe via ClickHouse state table.
 *
 * Usage:
 *   node src/scripts/migrate_audit_events_to_clickhouse.js [options]
 *
 * Environment Variables (required):
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL  Atlas Data Federation base URL
 *   AUDIT_EVENT_MONGO_USERNAME                     MongoDB username (optional if URL has creds)
 *   AUDIT_EVENT_MONGO_PASSWORD                     MongoDB password (optional if URL has creds)
 *   AUDIT_EVENT_MONGO_DB_NAME                      Source database name (default: fhir)
 *
 * Options:
 *   --collection <name>      Source collection name (default: AuditEvent_4_0_0)
 *   --start-date <YYYY-MM-DD> Start date inclusive (default: 2022-01-01)
 *   --end-date <YYYY-MM-DD>  End date exclusive (default: 2026-04-01)
 *   --batch-size <n>         Documents per ClickHouse insert batch (default: 100000)
 *   --concurrency <n>        Number of concurrent day-workers (default: 6)
 *   --dry-run                Count source docs and seed state without inserting
 *   --verify-only            Skip migration, run count verification only
 *   --resume                 Resume from incomplete partitions
 *   --help, -h               Show this help
 *
 * Examples:
 *   # Dry run to see partition counts
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL="mongodb+srv://..." \
 *     node src/scripts/migrate_audit_events_to_clickhouse.js --dry-run
 *
 *   # Full migration with 8 concurrent workers
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL="mongodb+srv://..." \
 *     node src/scripts/migrate_audit_events_to_clickhouse.js --concurrency 8
 *
 *   # Resume after interruption
 *   node src/scripts/migrate_audit_events_to_clickhouse.js --resume
 *
 *   # Verify counts after migration
 *   node src/scripts/migrate_audit_events_to_clickhouse.js --verify-only
 */

const { MongoClient } = require('mongodb');
const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
const { ConfigManager } = require('../utils/configManager');
const { logInfo, logError, logWarn } = require('../operations/common/logging');
const {
    MigrationStateManager,
    generateDailyPartitions
} = require('../admin/utils/migrationStateManager');
const { PartitionWorker } = require('../admin/utils/partitionWorker');
const { MigrationVerifier } = require('../admin/utils/migrationVerifier');

/**
 * Builds the Atlas Data Federation connection URL from environment variables.
 * Mirrors the pattern in src/config.js for AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL.
 * @returns {{federationUrl: string, dbName: string}}
 */
function buildFederationUrl() {
    const env = process.env;
    let federationUrl = env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL || '';

    if (!federationUrl) {
        logError('AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL environment variable is required');
        process.exit(1);
    }

    if (env.AUDIT_EVENT_MONGO_USERNAME !== undefined) {
        federationUrl = federationUrl.replace(
            'mongodb://',
            `mongodb://${env.AUDIT_EVENT_MONGO_USERNAME}:${env.AUDIT_EVENT_MONGO_PASSWORD}@`
        );
        federationUrl = federationUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${env.AUDIT_EVENT_MONGO_USERNAME}:${env.AUDIT_EVENT_MONGO_PASSWORD}@`
        );
    }

    federationUrl = encodeURI(federationUrl);
    const dbName = env.AUDIT_EVENT_MONGO_DB_NAME || 'fhir';

    return { federationUrl, dbName };
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
        batchSize: 100000,
        concurrency: 6,
        dryRun: false,
        verifyOnly: false,
        resume: false
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
            case '--help':
            case '-h':
                logInfo(`
Usage: node src/scripts/migrate_audit_events_to_clickhouse.js [options]

Environment Variables (required):
  AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL  Atlas Data Federation base URL
  AUDIT_EVENT_MONGO_USERNAME                     MongoDB username
  AUDIT_EVENT_MONGO_PASSWORD                     MongoDB password
  AUDIT_EVENT_MONGO_DB_NAME                      Source database name (default: fhir)

Options:
  --collection <name>      Source collection (default: AuditEvent_4_0_0)
  --start-date <YYYY-MM-DD> Start date inclusive (default: 2022-01-01)
  --end-date <YYYY-MM-DD>  End date exclusive (default: 2026-04-01)
  --batch-size <n>         Docs per batch (default: 100000)
  --concurrency <n>        Concurrent workers (default: 6)
  --dry-run                Seed state, count docs, don't insert
  --verify-only            Run count verification only
  --resume                 Resume incomplete partitions
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

            const { partition_day: day, last_mongo_id: lastId } = partition;

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
                    lastMongoId: lastId || ''
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
 * Main migration function
 */
async function main() {
    const options = parseArgs();
    const { federationUrl, dbName } = buildFederationUrl();

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

    logInfo('Connecting to Atlas Data Federation');
    const mongoClient = await MongoClient.connect(federationUrl);
    const sourceDb = mongoClient.db(dbName);
    logInfo('Connected to Atlas Data Federation');

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

        const result = await verifier.verifyAllAsync({ concurrency: options.concurrency });

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
    let partitions;
    if (options.resume) {
        partitions = await stateManager.getPendingPartitionsAsync();
        logInfo('Resuming migration', { partitionsToProcess: partitions.length });
    } else if (summary.completed > 0 && !options.dryRun) {
        partitions = await stateManager.getPendingPartitionsAsync();
        logInfo('Continuing migration', { partitionsRemaining: partitions.length });
    } else {
        partitions = days.map((day) => ({ partition_day: day, last_mongo_id: '' }));
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
