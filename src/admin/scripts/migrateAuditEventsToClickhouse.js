#!/usr/bin/env node
/**
 * Migrate AuditEvent data from Atlas Online Archive (via Data Federation) to ClickHouse.
 *
 * Processes AuditEvent documents across hourly partitions with configurable
 * concurrency. Partitions are atomic at the hour grain: if a prior attempt
 * wrote any rows, the worker (with --resume) DELETEs the hour before
 * re-migrating. Partition keys are 'YYYY-MM-DDTHH' (UTC).
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
    generateHourlyPartitions,
    hourKeyToDate,
    toClickHouseDateTime64
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
  --start-date <value>     Start bound inclusive. Accepts 'YYYY-MM-DD' (expands to THH=00)
                           or 'YYYY-MM-DDTHH'. Default: first day of the month, 13 months
                           ago — matches the AuditEvent_4_0_0 TTL window.
  --end-date <value>       End bound exclusive. Accepts 'YYYY-MM-DD' (expands to the
                           start of the next day, i.e. the full last day is included)
                           or 'YYYY-MM-DDTHH'. Default: first day of next month.
  --batch-size <n>         Docs per ClickHouse insert batch (default: 50000)
  --concurrency <n>        Concurrent hour-workers (default: 3)
  --init                   Count source docs per hour and seed 'pending' state rows
                           with source_count populated. Idempotent: hours that already
                           have a state row are left alone. Must be run before the
                           first migration pass.
  --verify-only            Run count verification only
  --resume                 Rewrite any partition with a prior partial write
                           (inserted_count > 0) by DELETEing the hour from
                           fhir.AuditEvent_4_0_0 and re-migrating. Without
                           --resume those partitions are skipped with a warning
                           so existing data is never touched.
  --show-state             Print audit_event_migration_state rows (ClickHouse only)
  --delete-partitions      Deletes AuditEvent rows for every hour in the
                           --start-date / --end-date range via ALTER ... DELETE
                           (blocking mutation) and resets each state row to
                           'pending' so --resume will re-migrate it. Both
                           --start-date and --end-date MUST be passed explicitly
                           — the sliding default is refused to avoid mass deletion.
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
 * Both anchored to UTC.
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
 * Normalize a --start-date / --end-date CLI value to a canonical hour-partition
 * key 'YYYY-MM-DDTHH'.
 *
 * Accepts:
 *   - 'YYYY-MM-DD'      → for `start`, 'YYYY-MM-DDT00'
 *                         for `end`,   start of the next day ('YYYY-(MM+1)-DDT00')
 *                         so the full last day is included (exclusive end).
 *   - 'YYYY-MM-DDTHH'   → unchanged (exclusive end works as-is).
 *
 * Rejects malformed input, non-calendar dates (e.g. 2025-02-30), and HH>23.
 *
 * @param {string} raw - CLI value
 * @param {'start'|'end'} kind - how to expand a bare date
 * @returns {string} canonical 'YYYY-MM-DDTHH'
 */
function normalizeCliDateToHour(raw, kind) {
    if (typeof raw !== 'string') {
        throw new Error(`Invalid --${kind}-date: expected string, got ${typeof raw}`);
    }

    const hourMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(raw);
    if (hourMatch) {
        const [, y, m, d, h] = hourMatch;
        const hourNum = parseInt(h, 10);
        if (hourNum > 23) {
            throw new Error(`Invalid --${kind}-date '${raw}': hour must be 00-23`);
        }
        // Round-trip via Date to reject things like '2025-02-30T05'.
        const iso = `${y}-${m}-${d}T${h}:00:00.000Z`;
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 13) !== `${y}-${m}-${d}T${h}`) {
            throw new Error(`Invalid --${kind}-date '${raw}': not a real calendar hour`);
        }
        return raw;
    }

    const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dayMatch) {
        const [, y, m, d] = dayMatch;
        const iso = `${y}-${m}-${d}T00:00:00.000Z`;
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) {
            throw new Error(`Invalid --${kind}-date '${raw}': not a real calendar date`);
        }
        if (kind === 'start') {
            return `${y}-${m}-${d}T00`;
        }
        // kind === 'end': advance by one day so the full YYYY-MM-DD is included.
        parsed.setUTCDate(parsed.getUTCDate() + 1);
        const nextY = parsed.getUTCFullYear();
        const nextM = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        const nextD = String(parsed.getUTCDate()).padStart(2, '0');
        return `${nextY}-${nextM}-${nextD}T00`;
    }

    throw new Error(
        `Invalid --${kind}-date '${raw}': expected YYYY-MM-DD or YYYY-MM-DDTHH`
    );
}

/**
 * Resolve the CLI start/end pair to canonical inclusive-start, exclusive-end
 * hour keys, throwing on invalid or empty ranges.
 * @param {string} startRaw
 * @param {string} endRaw
 * @returns {{startHour: string, endHour: string}}
 */
function hourBoundsFromCli(startRaw, endRaw) {
    const startHour = normalizeCliDateToHour(startRaw, 'start');
    const endHour = normalizeCliDateToHour(endRaw, 'end');
    if (hourKeyToDate(endHour) <= hourKeyToDate(startHour)) {
        throw new Error(
            `--end-date (${endRaw}) must be strictly after --start-date (${startRaw})`
        );
    }
    return { startHour, endHour };
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
        // Track whether the user supplied these on argv so destructive modes
        // can refuse to operate on the sliding default range.
        startDateExplicit: false,
        endDateExplicit: false,
        batchSize: 50000,
        concurrency: 3,
        init: false,
        verifyOnly: false,
        resume: false,
        showState: false,
        deletePartitions: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--collection':
                options.collection = args[++i];
                break;
            case '--start-date':
                options.startDate = args[++i];
                options.startDateExplicit = true;
                break;
            case '--end-date':
                options.endDate = args[++i];
                options.endDateExplicit = true;
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
                options.deletePartitions = true;
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
 * @param {Array<{partition_hour: string, inserted_count?: number}>} params.partitions
 * @param {import('mongodb').Db} params.sourceDb
 * @param {string} params.collectionName
 * @param {ClickHouseClientManager} params.clickHouseClientManager
 * @param {MigrationStateManager} params.stateManager
 * @param {number} params.batchSize
 * @param {number} params.concurrency
 * @param {boolean} params.rewriteExisting - forwarded to PartitionWorker
 * @param {{aborted: boolean}} params.abortFlag - set when SIGINT/SIGTERM arrives; workers drain
 * @returns {Promise<{totalInserted: number, totalSkipped: number, failures: string[], skippedPartitions: string[]}>}
 */
async function runWorkersAsync({
    partitions,
    sourceDb,
    collectionName,
    clickHouseClientManager,
    stateManager,
    batchSize,
    concurrency,
    rewriteExisting,
    abortFlag
}) {
    let queueIndex = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    const failures = [];
    const skippedPartitions = [];
    const startTime = Date.now();
    const totalPartitions = partitions.length;

    async function workerLoop(workerId) {
        while (queueIndex < partitions.length) {
            if (abortFlag.aborted) return;
            const idx = queueIndex++;
            const partition = partitions[idx];

            const hour = partition.partition_hour;
            const priorInsertedCount = Number(partition.inserted_count) || 0;

            try {
                const worker = new PartitionWorker({
                    sourceDb,
                    collectionName,
                    clickHouseClientManager,
                    stateManager,
                    batchSize,
                    rewriteExisting
                });

                const result = await worker.processAsync({
                    partitionHour: hour,
                    priorInsertedCount
                });

                if (result.skippedReason) {
                    skippedPartitions.push(hour);
                }

                totalInserted += result.insertedCount;
                totalSkipped += result.skippedCount;

                const completed = idx + 1;
                const elapsed = formatElapsed(Date.now() - startTime);
                logInfo('Partition processed', {
                    workerId,
                    partitionHour: hour,
                    insertedCount: result.insertedCount,
                    sourceCount: result.sourceCount,
                    skippedCount: result.skippedCount,
                    skippedReason: result.skippedReason,
                    progress: `${completed}/${totalPartitions}`,
                    elapsed
                });
            } catch (error) {
                failures.push(hour);
                logError('Partition failed', { workerId, partitionHour: hour, error: error.message });
            }
        }
    }

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(workerLoop(i + 1));
    }
    await Promise.all(workers);

    return { totalInserted, totalSkipped, failures, skippedPartitions };
}

/**
 * Print the migration state table.
 *
 * Runs against ClickHouse only — does not require Online Archive credentials.
 * Filters by the resolved --start-date / --end-date hour bounds.
 *
 * @param {Object} params
 * @param {MigrationStateManager} params.stateManager
 * @param {string} params.startHour - inclusive 'YYYY-MM-DDTHH'
 * @param {string} params.endHour - exclusive 'YYYY-MM-DDTHH'
 * @returns {Promise<void>}
 */
async function showMigrationStateAsync({ stateManager, startHour, endHour }) {
    const allStates = await stateManager.getAllStatesAsync();
    const states = allStates.filter(
        (s) => s.partition_hour >= startHour && s.partition_hour < endHour
    );

    logInfo('Migration state table', {
        table: 'fhir.audit_event_migration_state',
        startHour,
        endHour,
        rows: states.length
    });

    for (const s of states) {
        logInfo('Partition state', {
            partitionHour: s.partition_hour,
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
 * Delete AuditEvent rows for every hour in the range and reset their state rows.
 *
 * AuditEvent_4_0_0 is PARTITION BY toYYYYMM(recorded) (monthly), so we can't
 * DROP PARTITION for a single hour — we use ALTER TABLE ... DELETE with
 * mutations_sync = 2 so the call blocks until the mutation completes.
 *
 * Hours without an existing state row are skipped with a warning (likely
 * outside the seeded range) rather than creating stray 'pending' rows.
 *
 * @param {Object} params
 * @param {ClickHouseClientManager} params.clickHouseClientManager
 * @param {MigrationStateManager} params.stateManager
 * @param {string} params.startHour - inclusive 'YYYY-MM-DDTHH'
 * @param {string} params.endHour - exclusive 'YYYY-MM-DDTHH'
 * @returns {Promise<void>}
 */
async function deletePartitionsAsync({
    clickHouseClientManager,
    stateManager,
    startHour,
    endHour
}) {
    const hours = generateHourlyPartitions(startHour, endHour);

    const allStates = await stateManager.getAllStatesAsync();
    const stateByHour = new Map(allStates.map((s) => [s.partition_hour, s]));

    const hoursWithState = hours.filter((h) => stateByHour.has(h));
    const missing = hours.filter((h) => !stateByHour.has(h));
    if (missing.length > 0) {
        logWarn('Skipping hours with no state row (outside seeded range)', {
            missingCount: missing.length,
            firstMissing: missing[0],
            lastMissing: missing[missing.length - 1]
        });
    }
    if (hoursWithState.length === 0) {
        logError('Nothing to delete: no state rows in the requested range', {
            startHour,
            endHour
        });
        return;
    }

    logWarn('About to delete partitions', {
        table: 'fhir.AuditEvent_4_0_0',
        startHour,
        endHour,
        count: hoursWithState.length
    });

    for (const hour of hoursWithState) {
        const hourStart = hourKeyToDate(hour);
        const hourEnd = new Date(hourStart);
        hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);

        logInfo('Deleting AuditEvent rows', { partitionHour: hour });
        await clickHouseClientManager.queryAsync({
            query: `ALTER TABLE fhir.AuditEvent_4_0_0
                    DELETE WHERE recorded >= {hourStart:DateTime64(3, 'UTC')}
                             AND recorded < {hourEnd:DateTime64(3, 'UTC')}
                    SETTINGS mutations_sync = 2`,
            query_params: {
                hourStart: toClickHouseDateTime64(hourStart),
                hourEnd: toClickHouseDateTime64(hourEnd)
            }
        });

        logInfo('Resetting migration state row', { partitionHour: hour });
        await stateManager.resetPartitionAsync(hour);

        logInfo('Partition deleted', { partitionHour: hour });
    }

    logInfo('Delete complete', {
        startHour,
        endHour,
        count: hoursWithState.length,
        skippedMissing: missing.length
    });
}

/**
 * Count source documents per hour in parallel, then seed state rows for hours
 * that don't yet have one. Idempotent: hours with an existing state row keep
 * whatever status they have (completed/in_progress/failed/pending) — this
 * flow only creates the initial row, it never overwrites.
 *
 * @param {Object} params
 * @param {import('mongodb').Db} params.sourceDb
 * @param {string} params.collectionName
 * @param {MigrationStateManager} params.stateManager
 * @param {string[]} params.hours - 'YYYY-MM-DDTHH' list to initialize
 * @param {number} params.concurrency - parallel countDocuments calls
 * @returns {Promise<{seeded: number, skipped: number, totalSource: number}>}
 */
async function initPartitionsAsync({
    sourceDb,
    collectionName,
    stateManager,
    hours,
    concurrency
}) {
    const existing = await stateManager.getAllStatesAsync();
    const existingHours = new Set(existing.map((s) => s.partition_hour));
    const toInit = hours.filter((h) => !existingHours.has(h));
    const skipped = hours.length - toInit.length;

    if (toInit.length === 0) {
        logInfo('Init: all partitions already have state rows', { skipped });
        return { seeded: 0, skipped, totalSource: 0 };
    }

    logInfo('Init: counting source docs per hour', {
        hoursToInit: toInit.length,
        hoursAlreadyPresent: skipped,
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
            const hour = toInit[idx];
            const hourStart = hourKeyToDate(hour);
            const hourEnd = new Date(hourStart);
            hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);
            const sourceCount = await collection.countDocuments({
                recorded: { $gte: hourStart, $lt: hourEnd }
            });
            entries[idx] = { hour, sourceCount };

            completed++;
            // 37k partitions over 13 months, so log every 500 to stay readable.
            if (completed % 500 === 0 || completed === toInit.length) {
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

    // Resolve the CLI start/end pair up-front so every downstream path sees
    // canonical hour keys. Exits 1 on malformed input — no destructive work
    // has happened yet.
    let bounds;
    try {
        bounds = hourBoundsFromCli(options.startDate, options.endDate);
    } catch (err) {
        logError(err.message);
        return 1;
    }
    const { startHour, endHour } = bounds;

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
            await showMigrationStateAsync({ stateManager, startHour, endHour });
        } finally {
            await clickHouseManager.closeAsync();
        }
        return 0;
    }

    if (options.deletePartitions) {
        if (!options.startDateExplicit || !options.endDateExplicit) {
            logError(
                '--delete-partitions requires both --start-date and --end-date to be ' +
                'passed explicitly (the sliding default is refused for destructive ops).'
            );
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
                startHour,
                endHour
            });
        } catch (err) {
            logError(err.message);
            return 1;
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
        startHour,
        endHour,
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
            const hours = generateHourlyPartitions(startHour, endHour);
            logInfo('Hourly partitions generated', { total: hours.length });
            await initPartitionsAsync({
                sourceDb,
                collectionName: options.collection,
                stateManager,
                hours,
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
                'State table is empty for this range. Run with --init first to seed ' +
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
                startHour,
                endHour
            });

            logInfo('Verification results', {
                matched: result.matched,
                mismatched: result.mismatched
            });

            if (result.mismatches.length > 0) {
                for (const m of result.mismatches) {
                    logWarn('Count mismatch', {
                        hour: m.hour,
                        sourceCount: m.sourceCount,
                        chCount: m.chCount,
                        diff: m.sourceCount - m.chCount
                    });
                }
            }

            return result.mismatched > 0 ? 1 : 0;
        }

        logInfo('Starting migration');

        const partitions = await stateManager.getPendingPartitionsAsync({
            startHour,
            endHour
        });
        logInfo('Partitions to process', {
            partitionsToProcess: partitions.length,
            startHour,
            endHour
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
            rewriteExisting: options.resume,
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
            skippedPartitions: result.skippedPartitions.length,
            aborted: abortFlag.aborted
        });

        if (result.failures.length > 0) {
            logWarn('Failed partitions (re-run with --resume)', { hours: result.failures });
        }

        if (result.skippedPartitions.length > 0) {
            logWarn(
                'Partitions skipped because inserted_count > 0 — use --resume to rewrite',
                { hours: result.skippedPartitions }
            );
        }

        if (
            result.failures.length === 0 &&
            result.skippedPartitions.length === 0 &&
            !abortFlag.aborted
        ) {
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

module.exports = { defaultDateRange, normalizeCliDateToHour, hourBoundsFromCli };
