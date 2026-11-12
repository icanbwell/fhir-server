// Verifies the admin runner applies ClickHouse DDL from clickhouse-init/, is
// idempotent on re-run, and honors --dry-run and --file. Runs against the
// shared ClickHouse container started by jestGlobalSetup — drops the
// pre-loaded schemas before assertions, then restores them in afterAll so
// later test files still see the expected tables.

process.env.ENABLE_CLICKHOUSE = '1';

const path = require('path');
const { describe, test, beforeAll, beforeEach, afterAll, expect, jest } = require('@jest/globals');

const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../../../admin/adminLogger');
const { ApplyClickHouseDDLRunner } = require('../../../admin/runners/applyClickHouseDDLRunner');

const DDL_DIR = path.resolve(__dirname, '../../../../clickhouse-init');

const EXPECTED_TABLES = [
    'Group_4_0_0_MemberEvents',
    'Group_4_0_0_MemberCurrent',
    'Group_4_0_0_MemberCurrentByEntity',
    'AuditEvent_4_0_0',
    'AccessLog',
    'AUDIT_ACCESS_AGG',
    'Resource_4_0_0_History'
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
    'fhir.AUDIT_ACCESS_AGG',
    'fhir.Resource_4_0_0_History'
];

function makeRunner({
    clickHouseClientManager,
    mongoDatabaseManager,
    dir,
    file,
    dryRun,
    skipDatabaseCreation,
    adminLogger = new AdminLogger()
}) {
    return new ApplyClickHouseDDLRunner({
        adminLogger,
        mongoDatabaseManager,
        clickHouseClientManager,
        dir,
        file,
        dryRun,
        skipDatabaseCreation
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

    test('--skip-database-creation skips CREATE DATABASE statements but still applies the rest', async () => {
        const adminLogger = new AdminLogger();
        const logInfoSpy = jest.spyOn(adminLogger, 'logInfo');

        const runner = makeRunner({
            clickHouseClientManager,
            mongoDatabaseManager,
            dir: DDL_DIR,
            skipDatabaseCreation: true,
            adminLogger
        });
        await runner.processAsync();

        expect(logInfoSpy).toHaveBeenCalledWith(
            'Skipping CREATE DATABASE statement(s)',
            expect.objectContaining({ file: '01-init-schema.sql' })
        );

        for (const table of EXPECTED_TABLES) {
            expect(await clickHouseClientManager.tableExistsAsync(table)).toBe(true);
        }
    }, 60000);

    describe('Resource_4_0_0_History table', () => {
        const TABLE = 'fhir.Resource_4_0_0_History';

        // Timestamps are relative to now so rows stay inside the 13-month TTL window.
        const toClickHouseTime = (date) => date.toISOString().replace('T', ' ').replace('Z', '');
        const daysAgo = (days) => toClickHouseTime(new Date(Date.now() - days * 24 * 3600 * 1000));

        const row = (overrides = {}) => ({
            resource_type: 'Patient',
            _uuid: 'synthetic-uuid-1',
            _recorded: daysAgo(2),
            version_id: '1',
            access_tags: ['https://example.org/tag|synthetic'],
            raw: { resourceType: 'Patient', id: 'synthetic-1' },
            ...overrides
        });

        beforeEach(async () => {
            await makeRunner({
                clickHouseClientManager,
                mongoDatabaseManager,
                file: path.join(DDL_DIR, '08-resource-history.sql')
            }).processAsync();
        });

        async function selectAsync(query) {
            return clickHouseClientManager.queryAsync({ query });
        }

        test('is created with the engine, key, partitioning and TTL from the design', async () => {
            const rows = await selectAsync(`SHOW CREATE TABLE ${TABLE}`);
            const ddl = Object.values(rows[0])[0];

            expect(ddl).toContain('ReplacingMergeTree');
            expect(ddl).toContain('PARTITION BY toYYYYMM(_recorded)');
            expect(ddl).toContain('ORDER BY (resource_type, _uuid, _recorded, version_id)');
            expect(ddl).toContain('TTL toDateTime(_recorded) + toIntervalMonth(13)');
            expect(ddl).toContain('resource_type IN');
            expect(ddl).toContain('ttl_only_drop_parts = 1');
        }, 60000);

        test('FINAL collapses a duplicate row redelivered in a separate insert', async () => {
            const duplicated = row();
            // Separate inserts create separate parts, like an at-least-once redelivery;
            // a single block would be deduped at insert time and not exercise FINAL.
            await clickHouseClientManager.insertAsync({
                table: TABLE,
                values: [duplicated, row({ _recorded: daysAgo(1), version_id: '2' })]
            });
            await clickHouseClientManager.insertAsync({ table: TABLE, values: [{ ...duplicated }] });

            const order = 'ORDER BY _recorded DESC, toUInt64OrZero(version_id) DESC';
            const withoutFinal = await selectAsync(`SELECT version_id FROM ${TABLE} ${order}`);
            const withFinal = await selectAsync(`SELECT version_id FROM ${TABLE} FINAL ${order}`);

            expect(withoutFinal).toHaveLength(3);
            expect(withFinal.map((r) => r.version_id)).toEqual(['2', '1']);
        }, 60000);

        test('accepts one insert batch spanning several resource types', async () => {
            await clickHouseClientManager.insertAsync({
                table: TABLE,
                values: [
                    row(),
                    row({ resource_type: 'Observation', _uuid: 'synthetic-uuid-2' }),
                    row({ resource_type: 'Condition', _uuid: 'synthetic-uuid-3' })
                ]
            });

            const rows = await selectAsync(`SELECT count() AS c FROM ${TABLE}`);

            expect(Number(rows[0].c)).toBe(3);
        }, 60000);

        test('TTL drops rows older than 13 months', async () => {
            const old = new Date();
            old.setUTCMonth(old.getUTCMonth() - 14);
            await clickHouseClientManager.insertAsync({
                table: TABLE,
                values: [
                    row({ _uuid: 'synthetic-old', _recorded: toClickHouseTime(old) }),
                    row({ _uuid: 'synthetic-new', _recorded: daysAgo(0) })
                ]
            });

            await clickHouseClientManager.queryAsync({ query: `OPTIMIZE TABLE ${TABLE} FINAL` });
            const rows = await selectAsync(`SELECT _uuid FROM ${TABLE}`);

            expect(rows.map((r) => r._uuid)).toEqual(['synthetic-new']);
        }, 60000);

        test.each([
            ['Consent', 'kept'],
            ['Group', 'kept'],
            ['SomeFutureResourceType', 'kept'],
            ['Patient', 'dropped']
        ])('TTL on a 14-month-old %s row: %s', async (resourceType, outcome) => {
            const old = new Date();
            old.setUTCMonth(old.getUTCMonth() - 14);
            await clickHouseClientManager.insertAsync({
                table: TABLE,
                values: [
                    row({
                        resource_type: resourceType,
                        _uuid: 'synthetic-old',
                        _recorded: toClickHouseTime(old)
                    })
                ]
            });

            await clickHouseClientManager.queryAsync({ query: `OPTIMIZE TABLE ${TABLE} FINAL` });
            const rows = await selectAsync(`SELECT _uuid FROM ${TABLE}`);

            expect(rows).toHaveLength(outcome === 'kept' ? 1 : 0);
        }, 60000);
    });
});
