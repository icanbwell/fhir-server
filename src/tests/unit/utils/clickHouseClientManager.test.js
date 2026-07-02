const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');

/**
 * Unit coverage for the response-stream draining invariant on the ClickHouse client.
 *
 * The client library reuses keep-alive sockets. A result set whose body is never fully
 * read (or read then left open) can strand a socket that the server later half-closes,
 * which surfaces as intermittent ECONNRESET/EPIPE under load. The manager therefore closes
 * the result set in a finally block on every read path, including the error path. These
 * tests assert that invariant directly (mocking only the client boundary).
 */
describe('ClickHouseClientManager drains the response stream', () => {
    process.env.LOGLEVEL = 'SILENT';

    /** Build a manager with a pre-injected fake client so no real connection is made. */
    function makeManager(client) {
        const manager = new ClickHouseClientManager({ configManager: {} });
        manager.client = client;
        manager.isConnected = true;
        return manager;
    }

    /** A fake @clickhouse/client ResultSet with a close() spy. */
    function makeResultSet(jsonImpl) {
        return {
            json: jsonImpl || jestGlobal.fn(async () => []),
            text: jestGlobal.fn(async () => ''),
            close: jestGlobal.fn()
        };
    }

    test('queryAsync closes the result set after a successful read', async () => {
        const resultSet = makeResultSet(jestGlobal.fn(async () => [{ n: 1 }]));
        const client = { query: jestGlobal.fn(async () => resultSet) };
        const manager = makeManager(client);

        const rows = await manager.queryAsync({ query: 'SELECT 1 AS n' });

        expect(rows).toEqual([{ n: 1 }]);
        expect(resultSet.close).toHaveBeenCalledTimes(1);
    });

    test('queryAsync still closes the result set when reading the body throws', async () => {
        const resultSet = makeResultSet(jestGlobal.fn(async () => {
            throw new Error('stream read failed');
        }));
        const client = { query: jestGlobal.fn(async () => resultSet) };
        const manager = makeManager(client);

        await expect(manager.queryAsync({ query: 'SELECT 1' })).rejects.toThrow();

        // The un-drained socket that used to cause ECONNRESET/EPIPE is closed in finally.
        expect(resultSet.close).toHaveBeenCalledTimes(1);
    });

    test('pingAsync closes the result set on success', async () => {
        const resultSet = makeResultSet(jestGlobal.fn(async () => [{ ping: 1 }]));
        const client = { query: jestGlobal.fn(async () => resultSet) };
        const manager = makeManager(client);

        const ok = await manager.pingAsync();

        expect(ok).toBe(true);
        expect(resultSet.close).toHaveBeenCalledTimes(1);
    });

    test('executeBatchAsync closes every result set on success', async () => {
        const rs1 = makeResultSet(jestGlobal.fn(async () => [{ a: 1 }]));
        const rs2 = makeResultSet(jestGlobal.fn(async () => [{ b: 2 }]));
        const query = jestGlobal.fn().mockResolvedValueOnce(rs1).mockResolvedValueOnce(rs2);
        const manager = makeManager({ query });

        const results = await manager.executeBatchAsync([
            { query: 'SELECT 1 AS a' },
            { query: 'SELECT 2 AS b' }
        ]);

        expect(results).toEqual([[{ a: 1 }], [{ b: 2 }]]);
        expect(rs1.close).toHaveBeenCalledTimes(1);
        expect(rs2.close).toHaveBeenCalledTimes(1);
    });

    test('executeBatchAsync still closes result sets when a mid-batch query throws', async () => {
        const rs1 = makeResultSet(jestGlobal.fn(async () => [{ a: 1 }]));
        const rs2 = makeResultSet(jestGlobal.fn(async () => {
            throw new Error('second statement failed');
        }));
        const query = jestGlobal.fn().mockResolvedValueOnce(rs1).mockResolvedValueOnce(rs2);
        const manager = makeManager({ query });

        await expect(manager.executeBatchAsync([
            { query: 'SELECT 1 AS a' },
            { query: 'SELECT 2 AS b' }
        ])).rejects.toThrow();

        // An aborted batch must not strand a partially-read socket: the completed
        // statement and the failing one both drain in their finally blocks.
        expect(rs1.close).toHaveBeenCalledTimes(1);
        expect(rs2.close).toHaveBeenCalledTimes(1);
    });

    test('pingAsync returns false and still closes the result set when the read throws', async () => {
        const resultSet = makeResultSet(jestGlobal.fn(async () => {
            throw new Error('ping read failed');
        }));
        const client = { query: jestGlobal.fn(async () => resultSet) };
        const manager = makeManager(client);

        const ok = await manager.pingAsync();

        expect(ok).toBe(false);
        expect(resultSet.close).toHaveBeenCalledTimes(1);
    });
});
