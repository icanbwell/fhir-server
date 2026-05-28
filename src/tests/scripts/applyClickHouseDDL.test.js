// Verifies the admin runner applies ClickHouse DDL from clickhouse-init/, is
// idempotent on re-run, and honors --dry-run and --file. Runs against the
// shared ClickHouse container started by jestGlobalSetup — drops the
// pre-loaded schemas before assertions, then restores them in afterAll so
// later test files still see the expected tables.

process.env.ENABLE_CLICKHOUSE = '1';

const path = require('path');
const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');

const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../utils/configManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../admin/adminLogger');
const { ApplyClickHouseDDLRunner } = require('../../admin/runners/applyClickHouseDDLRunner');

const DDL_DIR = path.resolve(__dirname, '../../../clickhouse-init');

const EXPECTED_TABLES = [
    'Group_4_0_0_MemberEvents',
    'Group_4_0_0_MemberCurrent',
    'Group_4_0_0_MemberCurrentByEntity',
    'AuditEvent_4_0_0',
    'AccessLog',
    'AUDIT_ACCESS_AGG'
];

// Materialized views must be dropped before their source tables. We list
// every object in dependency order so dropAll() works regardless of which
// MV depends on which base table.
const DROP_ORDER = [
    // Materialized views first (depend on source tables)
    'fhir.Group_4_0_0_MemberCurrent_MV',
    'fhir.Group_4_0_0_MemberCurrentByEntity_MV',
    'fhir.AUDIT_ACCESS_MV',
    // Then tables
    'fhir.Group_4_0_0_MemberCurrent',
    'fhir.Group_4_0_0_MemberCurrentByEntity',
    'fhir.Group_4_0_0_MemberEvents',
    'fhir.AuditEvent_4_0_0',
    'fhir.AccessLog',
    'fhir.AUDIT_ACCESS_AGG'
];

function makeRunner({ clickHouseClientManager, mongoDatabaseManager, dir, file, dryRun }) {
    return new ApplyClickHouseDDLRunner({
        adminLogger: new AdminLogger(),
        mongoDatabaseManager,
        clickHouseClientManager,
        dir,
        file,
        dryRun
    });
}

async function dropAllSchemas(manager) {
    for (const ref of DROP_ORDER) {
        // queryAsync wraps DROP in a span and surfaces errors. IF EXISTS keeps
        // it idempotent so partial-state cleanup from a failed prior run works.
        await manager.queryAsync({ query: `DROP TABLE IF EXISTS ${ref}` });
    }
}

describe('applyClickHouseDDL admin runner', () => {
    let clickHouseClientManager;
    let mongoDatabaseManager;

    beforeAll(async () => {
        // Use the shared container started by jestGlobalSetup.
        const configManager = new ConfigManager();
        clickHouseClientManager = new ClickHouseClientManager({ configManager });
        mongoDatabaseManager = new MongoDatabaseManager({ configManager });
    }, 90000);

    afterAll(async () => {
        // Restore the schemas the rest of the test suite expects. Idempotent
        // (every CREATE in clickhouse-init/ uses IF NOT EXISTS), so safe even
        // if a test left some objects intact.
        try {
            const runner = makeRunner({
                clickHouseClientManager,
                mongoDatabaseManager,
                dir: DDL_DIR
            });
            await runner.processAsync();
        } catch (e) {
            console.error('Failed to restore ClickHouse schemas after applyClickHouseDDL tests:', e.message);
            throw e;
        } finally {
            if (clickHouseClientManager) {
                await clickHouseClientManager.closeAsync();
            }
        }
    }, 90000);

    beforeEach(async () => {
        // Each test starts from an empty schema, so the runner has work to do.
        await dropAllSchemas(clickHouseClientManager);
    });

    test('applies all DDL files to an empty container', async () => {
        for (const table of EXPECTED_TABLES) {
            expect(await clickHouseClientManager.tableExistsAsync(table)).toBe(false);
        }

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            dir: DDL_DIR
        });
        try {
            await runner.processAsync();
        } catch (e) {
            // Surface the underlying ClickHouse error so we can diagnose failures.
            const nested = e.nested || e.original_error;
            console.error(
                'processAsync failed:', e.message,
                '\nnested:', nested && nested.message,
                '\nargs:', e.args,
                '\noriginal:', e.original_error && e.original_error.message
            );
            throw e;
        }

        for (const table of EXPECTED_TABLES) {
            expect(await clickHouseClientManager.tableExistsAsync(table)).toBe(true);
        }
    }, 60000);

    test('is idempotent on re-run', async () => {
        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            dir: DDL_DIR
        });

        // Apply once to populate the schema, then again to prove no-op behavior.
        await runner.processAsync();
        await expect(runner.processAsync()).resolves.not.toThrow();

        for (const table of EXPECTED_TABLES) {
            expect(await clickHouseClientManager.tableExistsAsync(table)).toBe(true);
        }
    }, 60000);

    test('--file applies a single file only', async () => {
        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            file: path.join(DDL_DIR, '04-access-log.sql')
        });
        await runner.processAsync();

        expect(await clickHouseClientManager.tableExistsAsync('AccessLog')).toBe(true);
        expect(await clickHouseClientManager.tableExistsAsync('Group_4_0_0_MemberEvents')).toBe(false);
        expect(await clickHouseClientManager.tableExistsAsync('AuditEvent_4_0_0')).toBe(false);
    }, 120000);

    test('--dry-run logs without executing', async () => {
        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            dir: DDL_DIR,
            dryRun: true
        });
        await runner.processAsync();

        for (const table of EXPECTED_TABLES) {
            expect(await clickHouseClientManager.tableExistsAsync(table)).toBe(false);
        }
    }, 120000);
});
