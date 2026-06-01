#!/usr/bin/env node
/**
 * Backfills the AUDIT_ACCESS_AGG table from existing AuditEvent_4_0_0 data in ClickHouse.
 *
 * Materialized Views only capture new inserts — this script replays the MV logic
 * on historical data that existed before the MV was created. It processes data in
 * monthly partitions (matching the source table's partitioning) to avoid loading
 * the entire dataset into memory at once.
 *
 * The script is idempotent: AggregatingMergeTree correctly merges duplicate partial
 * aggregate states on background compaction, so re-runs produce correct results.
 *
 * Required environment:
 *   ENABLE_CLICKHOUSE=1
 *   CLICKHOUSE_HOST, CLICKHOUSE_PORT, etc. (same as FHIR server)
 *
 * Options:
 *   --batch-size <n>     Number of months to process per batch (default: 1)
 *   --start-month <YYYY-MM>  Start from this month (default: earliest data)
 *   --end-month <YYYY-MM>    Stop after this month (default: latest data)
 *   --dry-run            Log queries without executing
 *   --help, -h           Show this help
 *
 * Examples:
 *   ENABLE_CLICKHOUSE=1 CLICKHOUSE_HOST=http://localhost CLICKHOUSE_PORT=8123 \
 *     node src/admin/scripts/backfillAuditAccessMV.js
 *
 *   node src/admin/scripts/backfillAuditAccessMV.js --start-month 2024-01 --end-month 2024-06
 *   node src/admin/scripts/backfillAuditAccessMV.js --dry-run
 */

const { createContainer } = require('../../createContainer');
const { logError } = require('../../operations/common/logging');
const { AdminLogger } = require('../adminLogger');
const {
    BackfillAuditAccessMVRunner,
    buildBackfillQuery,
    monthToPartition,
    formatElapsed,
    discoverPartitionsAsync
} = require('../runners/backfillAuditAccessMVRunner');

const USAGE = `
Usage: node src/admin/scripts/backfillAuditAccessMV.js [options]

Backfills AUDIT_ACCESS_AGG from existing AuditEvent_4_0_0 data in ClickHouse.
Processes one month at a time to bound memory usage.

Options:
  --batch-size <n>         Months per INSERT...SELECT batch (default: 1)
  --start-month <YYYY-MM>  Start from this month (default: earliest partition)
  --end-month <YYYY-MM>    Stop after this month (default: latest partition)
  --dry-run                Log the INSERT statement without executing
  --help, -h               Show this help
`;

/**
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
 * @param {string} flag
 * @param {string|undefined} raw
 * @returns {string}
 */
function parseMonth(flag, raw) {
    if (raw === undefined || raw.startsWith('--')) {
        logError(`${flag} requires a YYYY-MM argument`);
        process.exit(1);
    }
    if (!/^\d{4}-\d{2}$/.test(raw)) {
        logError(`${flag} requires format YYYY-MM, got: ${raw}`);
        process.exit(1);
    }
    return raw;
}

/**
 * @returns {{batchSize: number, startMonth: string|null, endMonth: string|null, dryRun: boolean}}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        batchSize: 1,
        startMonth: null,
        endMonth: null,
        dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--batch-size':
                options.batchSize = parsePositiveInt('--batch-size', args[++i]);
                break;
            case '--start-month':
                options.startMonth = parseMonth('--start-month', args[++i]);
                break;
            case '--end-month':
                options.endMonth = parseMonth('--end-month', args[++i]);
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                console.log(USAGE);
                process.exit(0);
        }
    }

    return options;
}

/**
 * @returns {Promise<number>}
 */
async function main() {
    const options = parseArgs();

    const container = createContainer();

    const runner = new BackfillAuditAccessMVRunner({
        adminLogger: new AdminLogger(),
        mongoDatabaseManager: container.mongoDatabaseManager,
        clickHouseClientManager: container.clickHouseClientManager,
        batchSize: options.batchSize,
        startMonth: options.startMonth,
        endMonth: options.endMonth,
        dryRun: options.dryRun
    });

    try {
        return await runner.processAsync();
    } finally {
        if (container.clickHouseClientManager) {
            await container.clickHouseClientManager.closeAsync();
        }
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
    parseMonth,
    monthToPartition,
    formatElapsed,
    buildBackfillQuery,
    discoverPartitionsAsync
};
