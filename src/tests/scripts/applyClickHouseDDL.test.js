// Apply ClickHouse DDL from clickhouse-init/ to an empty ClickHouse container.
// Verifies the admin runner creates all expected tables, is idempotent on re-run,
// and honors --dry-run and --file.

process.env.ENABLE_CLICKHOUSE = '1';

const path = require('path');
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');

const { ClickHouseTestContainer } = require('../clickHouseTestContainer');
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
    'audit_event_migration_state',
    'AccessLog'
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

describe('applyClickHouseDDL admin runner', () => {
    let container;
    let clickHouseClientManager;
    let mongoDatabaseManager;
    let savedEnv;

    beforeAll(async () => {
        container = new ClickHouseTestContainer();
        await container.start({ startupTimeoutMs: 60000, loadSchema: false });
        savedEnv = container.applyEnvVars();

        const configManager = new ConfigManager();
        clickHouseClientManager = new ClickHouseClientManager({ configManager });
        mongoDatabaseManager = new MongoDatabaseManager({ configManager });
    }, 90000);

    afterAll(async () => {
        if (clickHouseClientManager) {
            await clickHouseClientManager.closeAsync();
        }
        if (container) {
            if (savedEnv) container.restoreEnvVars(savedEnv);
            await container.stop();
        }
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
        await runner.processAsync();

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
        await expect(runner.processAsync()).resolves.not.toThrow();

        for (const table of EXPECTED_TABLES) {
            expect(await clickHouseClientManager.tableExistsAsync(table)).toBe(true);
        }
    }, 60000);

    test('--file applies a single file only', async () => {
        // Fresh container to prove only the requested file is applied.
        const fresh = new ClickHouseTestContainer();
        await fresh.start({ startupTimeoutMs: 60000, loadSchema: false });
        const saved = fresh.applyEnvVars();
        const freshManager = new ClickHouseClientManager({ configManager: new ConfigManager() });

        try {
            const runner = makeRunner({
                clickHouseClientManager: freshManager,
                mongoDatabaseManager,
                file: path.join(DDL_DIR, '03-audit-event-migration-state.sql')
            });
            await runner.processAsync();

            expect(await freshManager.tableExistsAsync('audit_event_migration_state')).toBe(true);
            expect(await freshManager.tableExistsAsync('Group_4_0_0_MemberEvents')).toBe(false);
            expect(await freshManager.tableExistsAsync('AuditEvent_4_0_0')).toBe(false);
        } finally {
            await freshManager.closeAsync();
            fresh.restoreEnvVars(saved);
            await fresh.stop();
            // Restore env vars for the outer container so later assertions (none here, but safe) work.
            container.applyEnvVars();
        }
    }, 120000);

    test('--dry-run logs without executing', async () => {
        const fresh = new ClickHouseTestContainer();
        await fresh.start({ startupTimeoutMs: 60000, loadSchema: false });
        const saved = fresh.applyEnvVars();
        const freshManager = new ClickHouseClientManager({ configManager: new ConfigManager() });

        try {
            const runner = makeRunner({
                clickHouseClientManager: freshManager,
                mongoDatabaseManager,
                dir: DDL_DIR,
                dryRun: true
            });
            await runner.processAsync();

            for (const table of EXPECTED_TABLES) {
                expect(await freshManager.tableExistsAsync(table)).toBe(false);
            }
        } finally {
            await freshManager.closeAsync();
            fresh.restoreEnvVars(saved);
            await fresh.stop();
            container.applyEnvVars();
        }
    }, 120000);
});
