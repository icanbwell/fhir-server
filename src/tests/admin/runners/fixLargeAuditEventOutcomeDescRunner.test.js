// Integration test: runs against the shared ClickHouse container started by
// jestGlobalSetup (clickHouseTestRunner). No mocks — real inserts, real
// ALTER ... UPDATE mutation, real read-back.
const { describe, test, expect, beforeAll, afterAll, afterEach } = require('@jest/globals');
const { FixLargeAuditEventOutcomeDescRunner } = require('../../../admin/runners/fixLargeAuditEventOutcomeDescRunner');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { ConfigManager } = require('../../../utils/configManager');
const { AdminLogger } = require('../../../admin/adminLogger');
const { TABLES } = require('../../../constants/clickHouseConstants');

// Dedicated recorded window far from any real/other-test data, so this file's
// rows are isolated and easy to clean up.
const WINDOW_FROM = '2031-03-01';
const WINDOW_TO = '2031-03-04'; // exclusive; covers 03-01, 03-02, 03-03
const BIG = 'x'.repeat(1024 * 1024 + 1000); // > 1 MB so length(toString(resource)) clears the threshold

describe('FixLargeAuditEventOutcomeDescRunner (integration)', () => {
    /** @type {ClickHouseClientManager} */
    let manager;
    /** @type {MongoDatabaseManager} */
    let mongoDatabaseManager;

    function buildRow ({ id, recorded, action, outcome, desc }) {
        return {
            id,
            _uuid: id,
            recorded,
            action,
            resource: {
                resourceType: 'AuditEvent',
                id,
                action,
                outcome,
                outcomeDesc: desc
            }
        };
    }

    async function insertRows (rows) {
        await manager.insertAsync({ table: TABLES.AUDIT_EVENT, values: rows, format: 'JSONEachRow' });
    }

    async function fetchByUuid (uuid) {
        const rows = await manager.queryAsync({
            query:
                `SELECT toString(resource.outcome) AS outcome, ` +
                `toString(resource.outcomeDesc) AS outcomeDesc, ` +
                `toString(resource.resourceType) AS resourceType, ` +
                `length(toString(resource)) AS len ` +
                `FROM ${TABLES.AUDIT_EVENT} WHERE _uuid = {u:String}`,
            query_params: { u: uuid }
        });
        return rows[0];
    }

    async function cleanWindow () {
        // ALTER ... DELETE mutation (not lightweight `DELETE FROM`): queryAsync
        // appends `FORMAT JSONEachRow`, which lightweight DELETE rejects but the
        // mutation form (with SETTINGS) tolerates.
        await manager.queryAsync({
            query:
                `ALTER TABLE ${TABLES.AUDIT_EVENT} ` +
                `DELETE WHERE recorded >= '${WINDOW_FROM}' AND recorded < '${WINDOW_TO}' ` +
                `SETTINGS mutations_sync = 1`
        });
    }

    function createRunner (overrides = {}) {
        return new FixLargeAuditEventOutcomeDescRunner({
            adminLogger: new AdminLogger(),
            mongoDatabaseManager,
            clickHouseClientManager: manager,
            from: WINDOW_FROM,
            to: WINDOW_TO,
            ...overrides
        });
    }

    beforeAll(async () => {
        manager = new ClickHouseClientManager({ configManager: new ConfigManager() });
        await manager.getClientAsync();
        mongoDatabaseManager = Object.create(MongoDatabaseManager.prototype);
    });

    afterEach(async () => {
        await cleanWindow();
    });

    afterAll(async () => {
        await manager.closeAsync();
    });

    test('rewrites outcomeDesc by outcome, preserving other fields; leaves non-error and small rows', async () => {
        await insertRows([
            buildRow({ id: 'big-500', recorded: '2031-03-01 01:00:00.000', action: 'E', outcome: '8', desc: BIG }),
            buildRow({ id: 'big-400', recorded: '2031-03-01 02:00:00.000', action: 'E', outcome: '4', desc: BIG }),
            buildRow({ id: 'small-400', recorded: '2031-03-01 03:00:00.000', action: 'E', outcome: '4', desc: 'short msg' }),
            buildRow({ id: 'big-read', recorded: '2031-03-01 04:00:00.000', action: 'R', outcome: '0', desc: BIG })
        ]);

        await createRunner().processAsync();

        const big500 = await fetchByUuid('big-500');
        const big400 = await fetchByUuid('big-400');
        const small400 = await fetchByUuid('small-400');
        const bigRead = await fetchByUuid('big-read');

        // rewritten by outcome, and the giant payload shrank
        expect(big500.outcomeDesc).toBe('Internal Server Error');
        expect(big500.resourceType).toBe('AuditEvent'); // other fields preserved
        expect(big500.outcome).toBe('8');
        expect(Number(big500.len)).toBeLessThan(1000);

        expect(big400.outcomeDesc).toBe('Bad Request');
        expect(Number(big400.len)).toBeLessThan(1000);

        // untouched
        expect(small400.outcomeDesc).toBe('short msg');
        expect(bigRead.outcomeDesc).toBe(BIG);
    });

    test('processes each day across the range', async () => {
        await insertRows([
            buildRow({ id: 'd1', recorded: '2031-03-01 05:00:00.000', action: 'E', outcome: '8', desc: BIG }),
            buildRow({ id: 'd2', recorded: '2031-03-02 05:00:00.000', action: 'E', outcome: '4', desc: BIG }),
            buildRow({ id: 'd3', recorded: '2031-03-03 05:00:00.000', action: 'E', outcome: '8', desc: BIG })
        ]);

        await createRunner().processAsync();

        expect((await fetchByUuid('d1')).outcomeDesc).toBe('Internal Server Error');
        expect((await fetchByUuid('d2')).outcomeDesc).toBe('Bad Request');
        expect((await fetchByUuid('d3')).outcomeDesc).toBe('Internal Server Error');
    });

    test('dryRun does not modify any documents', async () => {
        await insertRows([
            buildRow({ id: 'dry-1', recorded: '2031-03-01 06:00:00.000', action: 'E', outcome: '8', desc: BIG })
        ]);

        await createRunner({ dryRun: true }).processAsync();

        const row = await fetchByUuid('dry-1');
        expect(row.outcomeDesc).toBe(BIG);
        expect(Number(row.len)).toBeGreaterThan(1024 * 1024);
    });

    test('honors a custom minSize (only larger docs are rewritten)', async () => {
        const MID = 'y'.repeat(1024 * 1024 + 1000); // ~1 MB: above default, below 2 MB
        await insertRows([
            buildRow({ id: 'mid', recorded: '2031-03-01 07:00:00.000', action: 'E', outcome: '4', desc: MID })
        ]);

        // threshold 2 MB -> the ~1 MB doc should NOT match
        await createRunner({ minSizeBytes: 2 * 1024 * 1024 }).processAsync();

        expect((await fetchByUuid('mid')).outcomeDesc).toBe(MID);
    });

    test('rejects an invalid from date before issuing any query', async () => {
        await expect(createRunner({ from: '03-01-2031' }).processAsync()).rejects.toThrow(/Invalid from date/);
    });

    test('rejects a to date that is not after from', async () => {
        await expect(
            createRunner({ from: '2031-03-03', to: '2031-03-01' }).processAsync()
        ).rejects.toThrow(/must be after/);
    });

    test('throws when ClickHouse is unavailable', async () => {
        await expect(createRunner({ clickHouseClientManager: null }).processAsync()).rejects.toThrow(/unavailable/);
    });
});
