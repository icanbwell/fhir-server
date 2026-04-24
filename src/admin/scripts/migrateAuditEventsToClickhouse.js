#!/usr/bin/env node
/**
 * Migrate AuditEvent data from Atlas Online Archive (via Data Federation) to ClickHouse.
 *
 * Processes ~55TB of AuditEvent documents across ~1,553 daily partitions with
 * configurable concurrency. Partitions are atomic at the day grain: if a prior
 * attempt wrote any rows, the worker DELETEs the day before re-migrating.
 *
 * Usage:
 *   node src/admin/scripts/migrateAuditEventsToClickhouse.js [options]
 *
 * Environment Variables:
 *   AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL  Online Archive connection string (required for migration/verify)
 *   AUDIT_EVENT_MONGO_USERNAME  MongoDB username (optional if URL has creds)
 *   AUDIT_EVENT_MONGO_PASSWORD  MongoDB password (required when username is set)
 *   AUDIT_EVENT_MONGO_DB_NAME   Source database name (default: fhir)
 *
 * See --help for options.
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

const USAGE = `
Usage: node src/admin/scripts/migrateAuditEventsToClickhouse.js [options]

Environment Variables:
  AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL  Online Archive connection string (required for migration/verify)
  AUDIT_EVENT_MONGO_USERNAME  MongoDB username (optional)
  AUDIT_EVENT_MONGO_PASSWORD  MongoDB password (required when username is set)
  AUDIT_EVENT_MONGO_DB_NAME   Source database name (default: fhir)

Options:
  --collection <name>      Source collection (default: AuditEvent_4_0_0)
  --start-date <YYYY-MM-DD> Start date inclusive (default: first day of the month,
                           13 months ago — matches the AuditEvent_4_0_0 TTL window)
  --end-date <YYYY-MM-DD>  End date exclusive (default: first day of next month)
  --batch-size <n>         Docs per ClickHouse insert batch (default: 50000)
  --concurrency <n>        Concurrent day-workers (default: 3)
  --init                   Count source docs per day and seed 'pending' state rows
                           with source_count populated. Idempotent: days that already
                           have a state row are left alone. Must be run before the
                           first migration pass.
  --verify-only            Run count verification only
  --resume                 Retry any pending/in_progress/failed partitions. Days with
                           inserted_count > 0 are DELETEd before re-migration.
  --show-state             Print audit_event_migration_state rows (ClickHouse only)
  --delete-partitions <days> Comma-separated YYYY-MM-DD list. Deletes AuditEvent rows for
                           those days via ALTER ... DELETE (blocking mutation) and resets
                           the state row to 'pending' so --resume will re-migrate it.
                           Requires --yes confirmation.
  --yes                    Confirm destructive operations (--delete-partitions).
  --help, -h               Show this help
`;

/**
 * Build the Online Archive MongoDB connection URL from environment variables.
 * Mirrors src/config.js:71-79 for both `mongodb://` and `mongodb+srv://` forms.
 * @returns {{mongoUrl: string, dbName: string}}
 */
function buildMongoUrl() {
    const env = process.env;
    let mongoUrl = env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL || '';

    if (!mongoUrl) {
        logError('AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL environment variable is required');
        process.exit(1);
    }

    const username = env.AUDIT_EVENT_MONGO_USERNAME;
    const password = env.AUDIT_EVENT_MONGO_PASSWORD;
    if (username !== undefined || password !== undefined) {
        if (username === undefined || password === undefined) {
            logError(
                'AUDIT_EVENT_MONGO_USERNAME and AUDIT_EVENT_MONGO_PASSWORD must be set together'
            );
            process.exit(1);
        }
        const u = encodeURIComponent(username);
        const p = encodeURIComponent(password);
        mongoUrl = mongoUrl
            .replace('mongodb://', `mongodb://${u}:${p}@`)
            .replace('mongodb+srv://', `mongodb+srv://${u}:${p}@`);
    }
    const dbName = env.AUDIT_EVENT_MONGO_DB_NAME || 'fhir';

    return { mongoUrl, dbName };
}

/**
 * Parse a positive integer CLI argument, exiting with a clear error on bad input.
 * @param {string} flag - the flag name, for error messages
 * @param {string|undefined} raw - the raw argv value
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
 * Default date range matches the AuditEvent_4_0_0 TTL
 * (`recorded + INTERVAL 13 MONTH DELETE` in clickhouse-init/02-audit-event.sql).
 * Anything older will be TTL-dropped shortly after insert anyway.
 *
 * Start = first day of the month 13 months ago (inclusive).
 * End   = first day of next month (exclusive).
 * Both anchored to UTC to match how dayStart / dayEnd are constructed elsewhere.
 *
 * @param {Date} [now] - override for tests
 * @returns {{startDate: string, endDate: string}}
 */
function defaultDateRange(now = new Date()) {
    const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const startInclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1));
    return {
        startDate: startInclusive.toISOString().slice(0, 10),
        endDate: endExclusive.toISOString().slice(0, 10)
    };
}

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const { startDate, endDate } = defaultDateRange();
    const options = {
        collection: 'AuditEvent_4_0_0',
        startDate,
        endDate,
        batchSize: 50000,
        concurrency: 3,
        init: false,
        verifyOnly: false,
        resume: false,
        showState: false,
        deletePartitions: null,
        yes: false
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
                options.batchSize = parsePositiveInt('--batch-size', args[++i]);
                break;
            case '--concurrency':
                options.concurrency = parsePositiveInt('--concurrency', args[++i]);
                break;
            case '--init':
                options.init = true;
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
            case '--yes':
                options.yes = true;
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
 * Run concurrent workers over a partition queue
 * @param {Object} params
 * @param {Array<{partition_day: string, inserted_count?: number}>} params.partitions
 * @param {import('mongodb').Db} params.sourceDb
 * @param {string} params.collectionName
 * @param {ClickHouseClientManager} params.clickHouseClientManager
 * @param {MigrationStateManager} params.stateManager
 * @param {number} params.batchSize
 * @param {number} params.concurrency
 * @param {{aborted: boolean}} params.abortFlag - set when SIGINT/SIGTERM arrives; workers drain
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
    abortFlag
}) {
    let queueIndex = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    const failures = [];
    const startTime = Date.now();
    const totalPartitions = partitions.length;

    async function workerLoop(workerId) {
        while (queueIndex < partitions.length) {
            if (abortFlag.aborted) return;
            const idx = queueIndex++;
            const partition = partitions[idx];

            const day = partition.partition_day;
            const priorInsertedCount = Number(partition.inserted_count) || 0;

            try {
                const worker = new PartitionWorker({
                    sourceDb,
                    collectionName,
                    clickHouseClientManager,
                    stateManager,
                    batchSize
                });

                const result = await worker.processAsync({
                    partitionDay: day,
                    priorInsertedCount
                });

                totalInserted += result.insertedCount;
                totalSkipped += result.skippedCount;

                const completed = idx + 1;
                const elapsed = formatElapsed(Date.now() - startTime);
                logInfo('Partition processed', {
                    workerId,
                    partitionDay: day,
                    insertedCount: result.insertedCount,
                    sourceCount: result.sourceCount,
                    skippedCount: result.skippedCount,
                    progress: `${completed}/${totalPartitions}`,
                    elapsed
                });
            } catch (error) {
                failures.push(day);
                logError('Partition failed', { workerId, partitionDay: day, error: error.message });
            }
        }
    }

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
 * Runs against ClickHouse only — does not require Online Archive credentials.
 * Filters by the same --start-date / --end-date flags the migration modes use.
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
 * Validate a YYYY-MM-DD string and normalize it to canonical form.
 * Rejects 2025-02-30 and similar: `toISOString().slice(0,10)` of the parsed Date
 * won't match the input unless it's a real calendar date.
 * @param {string} day
 * @returns {string}
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
 * Days without an existing state row are refused (likely typos outside the
 * seeded range) rather than silently creating a stray 'pending' row.
 *
 * @param {Object} params
 * @param {ClickHouseClientManager} params.clickHouseClientManager
 * @param {MigrationStateManager} params.stateManager
 * @param {string[]} params.days - Array of YYYY-MM-DD strings
 * @returns {Promise<void>}
 */
async function deletePartitionsAsync({ clickHouseClientManager, stateManager, days }) {
    const validated = days.map(validatePartitionDay);

    const allStates = await stateManager.getAllStatesAsync();
    const stateByDay = new Map(allStates.map((s) => [s.partition_day, s]));

    const missing = validated.filter((d) => !stateByDay.has(d));
    if (missing.length > 0) {
        logError(
            'Refusing to delete: some days have no state row (likely typo or outside seeded range)',
            { missing }
        );
        process.exit(1);
    }

    logWarn('About to delete partitions', {
        table: 'fhir.AuditEvent_4_0_0',
        days: validated,
        count: validated.length
    });
    for (const day of validated) {
        const s = stateByDay.get(day);
        logWarn('Partition to delete', {
            partitionDay: day,
            currentStatus: s.status,
            currentInsertedCount: Number(s.inserted_count) || 0,
            currentSourceCount: Number(s.source_count) || 0
        });
    }

    for (const day of validated) {
        logInfo('Deleting AuditEvent rows', { partitionDay: day });
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
 * Count source documents per day in parallel, then seed state rows for days
 * that don't yet have one. Idempotent: days with an existing state row keep
 * whatever status they have (completed/in_progress/failed/pending) — this
 * flow only creates the initial row, it never overwrites.
 *
 * @param {Object} params
 * @param {import('mongodb').Db} params.sourceDb
 * @param {string} params.collectionName
 * @param {MigrationStateManager} params.stateManager
 * @param {string[]} params.days - 'YYYY-MM-DD' list to initialize
 * @param {number} params.concurrency - parallel countDocuments calls
 * @returns {Promise<{seeded: number, skipped: number, totalSource: number}>}
 */
async function initPartitionsAsync({
    sourceDb,
    collectionName,
    stateManager,
    days,
    concurrency
}) {
    const existing = await stateManager.getAllStatesAsync();
    const existingDays = new Set(existing.map((s) => s.partition_day));
    const toInit = days.filter((d) => !existingDays.has(d));
    const skipped = days.length - toInit.length;

    if (toInit.length === 0) {
        logInfo('Init: all partitions already have state rows', { skipped });
        return { seeded: 0, skipped, totalSource: 0 };
    }

    logInfo('Init: counting source docs per day', {
        daysToInit: toInit.length,
        daysAlreadyPresent: skipped,
        concurrency
    });

    const collection = sourceDb.collection(collectionName);
    const entries = new Array(toInit.length);
    let queueIndex = 0;
    let completed = 0;
    const startTime = Date.now();

    async function workerLoop() {
        while (queueIndex < toInit.length) {
            const idx = queueIndex++;
            const day = toInit[idx];
            const dayStart = new Date(day + 'T00:00:00.000Z');
            const dayEnd = new Date(dayStart);
            dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
            const sourceCount = await collection.countDocuments({
                recorded: { $gte: dayStart, $lt: dayEnd }
            });
            entries[idx] = { day, sourceCount };

            completed++;
            if (completed % 50 === 0 || completed === toInit.length) {
                logInfo('Init progress', {
                    completed,
                    total: toInit.length,
                    elapsed: formatElapsed(Date.now() - startTime)
                });
            }
        }
    }

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(workerLoop());
    }
    await Promise.all(workers);

    const seeded = await stateManager.seedPartitionsAsync(entries);
    const totalSource = entries.reduce((acc, e) => acc + (Number(e.sourceCount) || 0), 0);

    logInfo('Init complete', { seeded, skipped, totalSource });
    return { seeded, skipped, totalSource };
}

/**
 * Main migration function. Returns an exit code; the outer IIFE is the sole
 * caller of process.exit.
 * @returns {Promise<number>}
 */
async function main() {
    const options = parseArgs();

    // Paths that don't need Online Archive creds. Handle before buildMongoUrl()
    // (which exits when the archive URL is absent).
    if (options.showState) {
        const configManager = new ConfigManager();
        const clickHouseManager = new ClickHouseClientManager({ configManager });
        try {
            await clickHouseManager.getClientAsync();
            const stateManager = new MigrationStateManager({
                clickHouseClientManager: clickHouseManager
            });
            await showMigrationStateAsync({
                stateManager,
                startDate: options.startDate,
                endDate: options.endDate
            });
        } finally {
            await clickHouseManager.closeAsync();
        }
        return 0;
    }

    if (options.deletePartitions) {
        if (options.deletePartitions.length === 0) {
            logError('--delete-partitions requires at least one YYYY-MM-DD day');
            return 1;
        }
        if (!options.yes) {
            logError(
                '--delete-partitions is destructive (ALTER ... DELETE on AuditEvent_4_0_0). ' +
                'Pass --yes to confirm.'
            );
            return 1;
        }
        let validatedDays;
        try {
            validatedDays = options.deletePartitions.map(validatePartitionDay);
        } catch (err) {
            logError(err.message);
            return 1;
        }

        const configManager = new ConfigManager();
        const clickHouseManager = new ClickHouseClientManager({ configManager });
        try {
            await clickHouseManager.getClientAsync();
            const stateManager = new MigrationStateManager({
                clickHouseClientManager: clickHouseManager
            });
            await deletePartitionsAsync({
                clickHouseClientManager: clickHouseManager,
                stateManager,
                days: validatedDays
            });
        } finally {
            await clickHouseManager.closeAsync();
        }
        return 0;
    }

    const { mongoUrl, dbName } = buildMongoUrl();

    const mode = options.init
        ? 'INIT'
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

    const configManager = new ConfigManager();
    const clickHouseManager = new ClickHouseClientManager({ configManager });

    logInfo('Connecting to Online Archive MongoDB');
    const mongoClient = await MongoClient.connect(mongoUrl);
    const abortFlag = { aborted: false };

    try {
        const sourceDb = mongoClient.db(dbName);
        logInfo('Connected to Online Archive MongoDB');

        logInfo('Connecting to ClickHouse');
        await clickHouseManager.getClientAsync();
        logInfo('Connected to ClickHouse');

        const stateManager = new MigrationStateManager({
            clickHouseClientManager: clickHouseManager
        });

        if (options.init) {
            const days = generateDailyPartitions(options.startDate, options.endDate);
            logInfo('Daily partitions generated', { total: days.length });
            await initPartitionsAsync({
                sourceDb,
                collectionName: options.collection,
                stateManager,
                days,
                concurrency: options.concurrency
            });
            return 0;
        }

        const summary = await stateManager.getSummaryAsync();
        logInfo('Current migration state', {
            pending: summary.pending,
            in_progress: summary.in_progress,
            completed: summary.completed,
            failed: summary.failed,
            totalInserted: summary.totalInserted
        });

        if (summary.total === 0) {
            logError(
                'State table is empty for this date range. Run with --init first to seed ' +
                'partition rows with source_count.'
            );
            return 1;
        }

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

            logInfo('Verification results', {
                matched: result.matched,
                mismatched: result.mismatched
            });

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

            return result.mismatched > 0 ? 1 : 0;
        }

        logInfo('Starting migration');

        // Single partition-selection path. getPendingPartitionsAsync returns
        // pending + in_progress + failed rows, so resume/continue/first-run
        // all behave identically — the worker handles prior-partial-write
        // cleanup via priorInsertedCount.
        const partitions = await stateManager.getPendingPartitionsAsync({
            startDate: options.startDate,
            endDate: options.endDate
        });
        logInfo('Partitions to process', {
            partitionsToProcess: partitions.length,
            startDate: options.startDate,
            endDate: options.endDate
        });

        if (partitions.length === 0) {
            logInfo('All partitions completed. Run with --verify-only to verify counts.');
            return 0;
        }

        const onSignal = (signal) => {
            if (abortFlag.aborted) return;
            abortFlag.aborted = true;
            logWarn('Received signal; finishing in-flight partitions then exiting', { signal });
        };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);

        const migrationStart = Date.now();

        const result = await runWorkersAsync({
            partitions,
            sourceDb,
            collectionName: options.collection,
            clickHouseClientManager: clickHouseManager,
            stateManager,
            batchSize: options.batchSize,
            concurrency: options.concurrency,
            abortFlag
        });

        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);

        const elapsed = formatElapsed(Date.now() - migrationStart);

        const finalSummary = await stateManager.getSummaryAsync();
        logInfo('Migration complete', {
            elapsed,
            insertedRows: result.totalInserted,
            skippedMalformed: result.totalSkipped,
            completedPartitions: `${finalSummary.completed}/${finalSummary.total}`,
            failedPartitions: result.failures.length,
            aborted: abortFlag.aborted
        });

        if (result.failures.length > 0) {
            logWarn('Failed partitions (re-run with --resume)', { days: result.failures });
        }

        if (result.failures.length === 0 && !abortFlag.aborted) {
            logInfo('All partitions completed. Run with --verify-only to verify counts.');
        }

        return result.failures.length > 0 || abortFlag.aborted ? 1 : 0;
    } finally {
        await mongoClient.close();
        await clickHouseManager.closeAsync();
    }
}

// Only auto-run when invoked as a CLI; when required from a test, just expose
// the pure helpers below.
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

module.exports = { defaultDateRange };
