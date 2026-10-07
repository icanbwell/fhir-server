'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');

/**
 * src/scripts/migrate_mongodb_members_to_clickhouse.js exports nothing and self-invokes
 * `migrateMongoDBMembersToClickHouse().then(...).catch(...)` at require time -- there is no
 * `require.main === module` guard. To exercise its internal logic (extractEntityType,
 * convertToClickHouseDateTime, batching, dry-run gating) we mock its three infrastructure
 * dependencies (`mongodb`, ClickHouseClientManager, ConfigManager), require the module fresh per
 * test, and inspect what actually flowed into the mocked ClickHouse/Mongo calls. This is a narrow
 * integration test: real internal transformation logic, mocked I/O boundaries.
 *
 * Tests below mock ConfigManager to supply `mongoUrl`/`dbName` so the rest of the pipeline is
 * reachable.
 */

const SCRIPT_PATH = '../../../scripts/migrate_mongodb_members_to_clickhouse';
const MONGODB_PATH = 'mongodb';
const CLICKHOUSE_PATH = '../../../utils/clickHouseClientManager';
const CONFIG_MANAGER_PATH = '../../../utils/configManager';

function buildMocks ({ groups = [], remainingCount = 0, eventCount = 0 } = {}) {
    const updateOne = jest.fn().mockResolvedValue({});
    const findCalls = [];
    const collection = {
        find: jest.fn((query, options) => {
            findCalls.push({ query, options });
            return {
                toArray: jest.fn().mockResolvedValue(groups),
                count: jest.fn().mockResolvedValue(remainingCount)
            };
        }),
        updateOne
    };
    const db = { collection: jest.fn(() => collection) };
    const close = jest.fn().mockResolvedValue(undefined);
    const mongoClient = { db: jest.fn(() => db), close };
    const connect = jest.fn().mockResolvedValue(mongoClient);

    const insertAsync = jest.fn().mockResolvedValue(undefined);
    const queryAsync = jest.fn().mockResolvedValue([{ count: eventCount }]);
    const closeAsync = jest.fn().mockResolvedValue(undefined);
    const getClientAsync = jest.fn().mockResolvedValue({});
    const clickHouseManagerInstance = { getClientAsync, insertAsync, queryAsync, closeAsync };

    return { connect, mongoClient, db, collection, updateOne, findCalls, clickHouseManagerInstance, insertAsync, queryAsync, closeAsync, mongoClientClose: close };
}

async function flushAsync (times = 30) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

async function runScript (argv, mocks) {
    jest.resetModules();
    process.argv = ['node', 'migrate_mongodb_members_to_clickhouse.js', ...argv];

    jest.doMock(MONGODB_PATH, () => ({ MongoClient: { connect: mocks.connect } }));
    jest.doMock(CLICKHOUSE_PATH, () => ({
        ClickHouseClientManager: jest.fn().mockImplementation(() => mocks.clickHouseManagerInstance)
    }));
    jest.doMock(CONFIG_MANAGER_PATH, () => ({
        ConfigManager: jest.fn().mockImplementation(() => ({ mongoUrl: 'mongodb://fake-host:27017', dbName: 'fake_db' }))
    }));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { logSpy, errorSpy, exitSpy };
}

function buildGroup (id, members, meta = {}) {
    return { id, member: members, meta };
}

describe('scripts/migrate_mongodb_members_to_clickhouse.js', () => {
    const originalArgv = process.argv;

    afterEach(() => {
        jest.restoreAllMocks();
        process.argv = originalArgv;
    });

    test('extracts entity type from a relative reference (Patient/123 -> Patient)', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/123' } }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        expect(mocks.insertAsync).toHaveBeenCalledTimes(1);
        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].entity_type).toBe('Patient');
        expect(values[0].entity_reference).toBe('Patient/123');
    });

    test('extracts entity type from an absolute URL reference', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'https://example.com/fhir/Patient/123' } }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].entity_type).toBe('Patient');
    });

    test('extracts "Unknown" entity type from a urn: reference', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'urn:uuid:abc-123' } }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].entity_type).toBe('Unknown');
    });

    test('extracts "Unknown" entity type from a missing/non-string reference', async () => {
        const group = buildGroup('g1', [{ entity: {} }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].entity_type).toBe('Unknown');
    });

    test('converts group.meta.lastUpdated ISO date to ClickHouse DateTime format', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }], { lastUpdated: '2024-01-01T00:00:00Z' });
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].event_time).toBe('2024-01-01 00:00:00.000');
    });

    test('converts member.period.start/end to ClickHouse format, or null when absent', async () => {
        const group = buildGroup('g1', [
            { entity: { reference: 'Patient/1' }, period: { start: '2023-05-01T00:00:00Z' } }
        ]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].period_start).toBe('2023-05-01 00:00:00.000');
        expect(values[0].period_end).toBeNull();
    });

    test('maps member.inactive to 1/0 instead of boolean', async () => {
        const group = buildGroup('g1', [
            { entity: { reference: 'Patient/1' }, inactive: true },
            { entity: { reference: 'Patient/2' }, inactive: false }
        ]);
        const mocks = buildMocks({ groups: [group] });
        await runScript(['--batch-size', '10'], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].inactive).toBe(1);
        expect(values[1].inactive).toBe(0);
    });

    test('extracts access_tags and owner_tags from meta.security by system substring, without cross-contamination', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }], {
            security: [
                { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                { system: 'https://www.icanbwell.com/owner', code: 'bwell' }
            ]
        });
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        const values = mocks.insertAsync.mock.calls[0][0].values;
        expect(values[0].access_tags).toEqual(['client-a']);
        expect(values[0].owner_tags).toEqual(['bwell']);
    });

    test('--dry-run does not call insertAsync or updateOne', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript(['--dry-run'], mocks);

        expect(mocks.insertAsync).not.toHaveBeenCalled();
        expect(mocks.updateOne).not.toHaveBeenCalled();
    });

    test('live mode calls insertAsync and updateOne (removing the member array, stamping lastUpdated)', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        expect(mocks.insertAsync).toHaveBeenCalledTimes(1);
        expect(mocks.updateOne).toHaveBeenCalledWith(
            { id: 'g1' },
            expect.objectContaining({
                $unset: { member: '' },
                $set: expect.objectContaining({ 'meta.lastUpdated': expect.any(String) })
            })
        );
    });

    test('batches ClickHouse inserts at the --batch-size boundary: 5 members at batchSize 2 -> chunks of [2, 2, 1]', async () => {
        const members = Array.from({ length: 5 }, (_, i) => ({ entity: { reference: `Patient/${i}` } }));
        const group = buildGroup('g1', members);
        const mocks = buildMocks({ groups: [group] });
        await runScript(['--batch-size', '2'], mocks);

        expect(mocks.insertAsync).toHaveBeenCalledTimes(3);
        expect(mocks.insertAsync.mock.calls[0][0].values).toHaveLength(2);
        expect(mocks.insertAsync.mock.calls[1][0].values).toHaveLength(2);
        expect(mocks.insertAsync.mock.calls[2][0].values).toHaveLength(1);
    });

    test('--limit is forwarded into the Mongo find() query options', async () => {
        const mocks = buildMocks({ groups: [] });
        await runScript(['--limit', '10'], mocks);

        expect(mocks.findCalls[0].options).toEqual({ limit: 10 });
    });

    test('no matching groups: logs and exits early without ClickHouse inserts, closing both connections', async () => {
        const mocks = buildMocks({ groups: [] });
        await runScript([], mocks);

        expect(mocks.insertAsync).not.toHaveBeenCalled();
        expect(mocks.mongoClientClose).toHaveBeenCalledTimes(1);
        expect(mocks.closeAsync).toHaveBeenCalledTimes(1);
        // Verification block (a second find()) must not run when there were no groups to begin with.
        expect(mocks.findCalls).toHaveLength(1);
    });

    test('after a live migration, logs success when no Groups still have member arrays', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }]);
        const mocks = buildMocks({ groups: [group], remainingCount: 0, eventCount: 1 });
        const { logSpy } = await runScript([], mocks);

        const messages = logSpy.mock.calls.map((call) => call.join(' '));
        expect(messages.some((m) => m.includes('Migration successful'))).toBe(true);
    });

    test('after a live migration, logs a warning when Groups still have member arrays remaining', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }]);
        const mocks = buildMocks({ groups: [group], remainingCount: 3, eventCount: 1 });
        const { logSpy } = await runScript([], mocks);

        const messages = logSpy.mock.calls.map((call) => call.join(' '));
        expect(messages.some((m) => m.includes('Warning') && m.includes('3'))).toBe(true);
    });

    test('closes both the Mongo client and the ClickHouse manager after a successful live run', async () => {
        const group = buildGroup('g1', [{ entity: { reference: 'Patient/1' } }]);
        const mocks = buildMocks({ groups: [group] });
        await runScript([], mocks);

        expect(mocks.mongoClientClose).toHaveBeenCalledTimes(1);
        expect(mocks.closeAsync).toHaveBeenCalledTimes(1);
    });
});
