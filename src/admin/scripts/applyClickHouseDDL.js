const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { ApplyClickHouseDDLRunner } = require('../runners/applyClickHouseDDLRunner');
const { AdminLogger } = require('../adminLogger');

/**
 * Applies ClickHouse DDL (.sql files) to the configured ClickHouse instance.
 * Idempotent when the DDL uses `CREATE ... IF NOT EXISTS`.
 *
 * Required environment:
 *   ENABLE_CLICKHOUSE=1
 *   CLICKHOUSE_HOST (default: 127.0.0.1)
 *   CLICKHOUSE_PORT (default: 8123)
 *   CLICKHOUSE_DATABASE (default: fhir)
 *   CLICKHOUSE_USERNAME (default: default)
 *   CLICKHOUSE_PASSWORD (default: empty)
 *
 * Options:
 *   --dir <path>    Directory of .sql files to apply in lexical order (default: clickhouse-init)
 *   --file <path>   Apply a single .sql file (overrides --dir)
 *   --dry-run       Log statements without executing
 *
 * Examples:
 *   ENABLE_CLICKHOUSE=1 CLICKHOUSE_HOST=http://localhost CLICKHOUSE_PORT=8123 \
 *     node src/admin/scripts/applyClickHouseDDL.js --dir clickhouse-init
 *   node src/admin/scripts/applyClickHouseDDL.js --file clickhouse-init/02-audit-event.sql --dry-run
 */
async function main() {
    const args = CommandLineParser.parseCommandLine();
    const dir = args.dir || 'clickhouse-init';
    const file = args.file;
    const dryRun = Boolean(args.dryRun);

    const container = createContainer();

    container.register(
        'applyClickHouseDDLRunner',
        (c) =>
            new ApplyClickHouseDDLRunner({
                adminLogger: new AdminLogger(),
                mongoDatabaseManager: c.mongoDatabaseManager,
                clickHouseClientManager: c.clickHouseClientManager,
                dir,
                file,
                dryRun
            })
    );

    const runner = container.applyClickHouseDDLRunner;
    try {
        await runner.processAsync();
    } finally {
        if (container.clickHouseClientManager) {
            await container.clickHouseClientManager.closeAsync();
        }
    }

    process.exit(0);
}

main().catch((reason) => {
    console.error(reason);
    process.exit(1);
});
