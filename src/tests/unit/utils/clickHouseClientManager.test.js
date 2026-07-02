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
});
