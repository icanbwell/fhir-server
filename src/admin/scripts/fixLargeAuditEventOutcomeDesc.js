// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixLargeAuditEventOutcomeDescRunner } = require('../runners/fixLargeAuditEventOutcomeDescRunner');

/**
 * Replaces the oversized outcomeDesc of error AuditEvents (action 'E') in
 * ClickHouse (table fhir.AuditEvent_4_0_0) with a generic status phrase derived
 * from outcome (8 -> 'Internal Server Error', else -> 'Bad Request'). Only events
 * whose outcomeDesc exceeds the byte limit (default 500) are touched; every other
 * field is left as-is. Error AuditEvents historically stored the raw error payload
 * in outcomeDesc, which can be many MB.
 *
 * Required environment:
 *   ENABLE_CLICKHOUSE=1
 *   CLICKHOUSE_HOST / CLICKHOUSE_PORT / CLICKHOUSE_DATABASE / CLICKHOUSE_USERNAME / CLICKHOUSE_PASSWORD
 *
 * Options:
 *   --from <YYYY-MM-DD>   inclusive lower bound on recorded. Required.
 *   --to <YYYY-MM-DD>     exclusive upper bound on recorded. Required.
 *   --maxBytes <bytes>    outcomeDesc byte threshold; events above it are rewritten (default 500)
 *   --dryRun              count matches without updating
 *
 * Processes one day at a time over [from, to). Only error AuditEvents (action 'E')
 * are targeted; that is not configurable.
 *
 * @returns {Promise<void>}
 */
async function main () {
    const parameters = CommandLineParser.parseCommandLine();

    const container = createContainer();

    container.register('fixLargeAuditEventOutcomeDescRunner', (c) => new FixLargeAuditEventOutcomeDescRunner({
        adminLogger: new AdminLogger(),
        mongoDatabaseManager: c.mongoDatabaseManager,
        clickHouseClientManager: c.clickHouseClientManager,
        from: parameters.from,
        to: parameters.to,
        maxOutcomeDescBytes: parameters.maxBytes ? parseInt(parameters.maxBytes) : undefined,
        dryRun: Boolean(parameters.dryRun)
    }));

    const runner = container.fixLargeAuditEventOutcomeDescRunner;
    try {
        await runner.processAsync();
    } finally {
        if (container.clickHouseClientManager) {
            await container.clickHouseClientManager.closeAsync();
        }
    }

    process.exit(0);
}

/**
 * To run this:
 * nvm use
 *
 * # Dry run first: find error AuditEvents with outcomeDesc > 500 bytes, day-by-day across May & June 2026
 * node src/admin/scripts/fixLargeAuditEventOutcomeDesc.js --from=2026-05-01 --to=2026-07-01 --dryRun
 *
 * # Replace their outcomeDesc with the generic phrase (Bad Request / Internal Server Error)
 * node src/admin/scripts/fixLargeAuditEventOutcomeDesc.js --from=2026-05-01 --to=2026-07-01
 *
 * # Override the byte threshold (default 500)
 * node src/admin/scripts/fixLargeAuditEventOutcomeDesc.js --from=2026-06-01 --to=2026-07-01 --maxBytes=1000
 */
main().catch((reason) => {
    console.error(reason);
    process.exit(1);
});
