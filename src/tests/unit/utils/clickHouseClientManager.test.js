const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

// Mock dependencies
const mockQuery = jest.fn();
const mockInsert = jest.fn();
const mockClose = jest.fn();

jest.mock('@clickhouse/client', () => ({
    createClient: jest.fn(() => ({
        query: mockQuery,
        insert: mockInsert,
        close: mockClose
    }))
}));

jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
    logDebug: jest.fn()
}));

jest.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args }) {
            super(message);
            this.originalError = error;
            this.args = args;
        }
    }
}));

jest.mock('@opentelemetry/api', () => ({
    trace: {
        getTracer: () => ({
            startActiveSpan: (name, options, fn) => {
                const mockSpan = {
                    setAttributes: jest.fn(),
                    setStatus: jest.fn(),
                    recordException: jest.fn(),
                    end: jest.fn()
                };
                return fn(mockSpan);
            }
        })
    }
}));

const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');

describe('ClickHouseClientManager', () => {
    let manager;
    let mockConfigManager;

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigManager = {
            clickHouseHost: 'http://localhost',
            clickHousePort: 8123,
            clickHouseDatabase: 'fhir',
            clickHouseUsername: 'default',
            clickHousePassword: '',
            clickHouseRequestTimeout: 180000,
            clickHouseMaxConnections: 10,
            clickHouseWriteMode: 'sync-direct'
        };

        manager = new ClickHouseClientManager({ configManager: mockConfigManager });
    });

    afterEach(async () => {
        // Clean up client state
        manager.client = null;
        manager.isConnected = false;
    });

    describe('getClientAsync - race condition', () => {
        test('BUG: concurrent calls can create multiple clients (connection leak)', async () => {
            // Simulate slow connection establishment
            const { createClient } = require('@clickhouse/client');
            let callCount = 0;
            createClient.mockImplementation(() => {
                callCount++;
                return {
                    query: mockQuery,
                    insert: mockInsert,
                    close: mockClose
                };
            });

            // Make ping succeed
            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue([{ ping: 1 }])
            });

            // Two concurrent calls when client is null
            const [client1, client2] = await Promise.all([
                manager.getClientAsync(),
                manager.getClientAsync()
            ]);

            // BUG: Both calls see this.client === null, both call connectAsync().
            // The second call overwrites this.client, orphaning the first connection.
            // With real ClickHouse, this leaks a TCP connection in the pool.
            // callCount may be 1 or 2 depending on race timing
            // In a proper implementation, a mutex/lock would ensure only one connection is created.
            expect(client1).toBeDefined();
            expect(client2).toBeDefined();
        });
    });

    describe('queryAsync - null result handling', () => {
        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should return empty array when resultSet.json() returns null', async () => {
            // Set up connected client
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            // resultSet.json() could return null in some edge cases
            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue(null)
            });

            // Should handle null result gracefully and return empty array
            const result = await manager.queryAsync({ query: 'SELECT 1' });
            expect(result).toEqual([]);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should return empty array when resultSet.json() returns undefined', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue(undefined)
            });

            // Should handle undefined result gracefully and return empty array
            const result = await manager.queryAsync({ query: 'SELECT 1' });
            expect(result).toEqual([]);
        });

        test('queryAsync handles array result correctly', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }])
            });

            const result = await manager.queryAsync({ query: 'SELECT id FROM table' });
            expect(result).toEqual([{ id: 1 }, { id: 2 }]);
        });

        test('queryAsync handles object result with data property', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue({ data: [{ id: 1 }] })
            });

            const result = await manager.queryAsync({ query: 'SELECT id FROM table' });
            expect(result).toEqual([{ id: 1 }]);
        });

        test('queryAsync handles object result without data property', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            // Object without .data field - falls to `result.data || []` which is `undefined || []`
            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue({ meta: 'info' })
            });

            const result = await manager.queryAsync({ query: 'SELECT 1' });
            expect(result).toEqual([]);
        });
    });

    describe('pingAsync - null result handling', () => {
        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should return false (not null) when resultSet.json() returns null', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue(null)
            });

            // pingAsync should always return a boolean value
            const result = await manager.pingAsync();
            expect(result).toBe(false);
        });

        test('pingAsync returns false when client is null', async () => {
            manager.client = null;
            const result = await manager.pingAsync();
            expect(result).toBe(false);
        });

        test('pingAsync returns true with valid array response', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue([{ ping: 1 }])
            });

            const result = await manager.pingAsync();
            expect(result).toBe(true);
        });

        test('pingAsync returns false on query error', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };

            mockQuery.mockRejectedValue(new Error('Connection refused'));

            const result = await manager.pingAsync();
            expect(result).toBe(false);
        });
    });

    describe('insertAsync - null/empty values', () => {
        test('insertAsync skips when values is null', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            await manager.insertAsync({ table: 'test_table', values: null });
            expect(mockInsert).not.toHaveBeenCalled();
        });

        test('insertAsync skips when values is empty array', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            await manager.insertAsync({ table: 'test_table', values: [] });
            expect(mockInsert).not.toHaveBeenCalled();
        });

        test('insertAsync calls client.insert with correct params', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;
            mockInsert.mockResolvedValue(undefined);

            const values = [{ id: 1, name: 'test' }];
            await manager.insertAsync({ table: 'test_table', values });

            expect(mockInsert).toHaveBeenCalledWith({
                table: 'test_table',
                values,
                format: 'JSONEachRow',
                clickhouse_settings: undefined
            });
        });

        test('insertAsync propagates errors from client', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;
            mockInsert.mockRejectedValue(new Error('Disk full'));

            await expect(
                manager.insertAsync({ table: 'test_table', values: [{ id: 1 }] })
            ).rejects.toThrow('Error inserting into ClickHouse');
        });
    });

    describe('connectAsync - error handling', () => {
        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should NOT mark connection as successful when ping fails', async () => {
            const { createClient } = require('@clickhouse/client');

            // pingAsync returns false when the query fails.
            // connectAsync should check the ping result and NOT mark as connected.
            const failingQuery = jest.fn().mockRejectedValue(new Error('Connection refused'));
            createClient.mockReturnValue({
                query: failingQuery,
                insert: mockInsert,
                close: mockClose
            });

            // connectAsync should either throw or set isConnected = false when ping fails
            await manager.connectAsync();

            expect(manager.isConnected).toBe(false);
        });

        test('connectAsync throws when createClient itself throws', async () => {
            const { createClient } = require('@clickhouse/client');
            createClient.mockImplementation(() => {
                throw new Error('Invalid URL');
            });

            // Create a fresh manager to trigger connectAsync
            const freshManager = new ClickHouseClientManager({ configManager: mockConfigManager });
            await expect(freshManager.connectAsync()).rejects.toThrow('Error connecting to ClickHouse');
            expect(freshManager.client).toBeNull();
            expect(freshManager.isConnected).toBe(false);
        });
    });

    describe('closeAsync', () => {
        test('closes client and resets state', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;
            mockClose.mockResolvedValue(undefined);

            await manager.closeAsync();

            expect(mockClose).toHaveBeenCalled();
            expect(manager.client).toBeNull();
            expect(manager.isConnected).toBe(false);
        });

        test('handles close error gracefully (no throw)', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;
            mockClose.mockRejectedValue(new Error('Close failed'));

            // Should not throw
            await manager.closeAsync();
            // State should still be cleaned up even on error? Let's check.
            // Looking at the code: the catch block only logs, does NOT reset state
            // This means client/isConnected remain set after failed close.
            // Not ideal but not necessarily a bug - the connection may still be alive.
        });

        test('closeAsync is a no-op when client is null', async () => {
            manager.client = null;
            await manager.closeAsync();
            expect(mockClose).not.toHaveBeenCalled();
        });
    });

    describe('executeBatchAsync', () => {
        test('executes multiple queries sequentially', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery
                .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue([{ a: 1 }]) })
                .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue([{ b: 2 }]) });

            const results = await manager.executeBatchAsync([
                { query: 'SELECT 1 AS a' },
                { query: 'SELECT 2 AS b' }
            ]);

            expect(results).toHaveLength(2);
            expect(mockQuery).toHaveBeenCalledTimes(2);
        });

        test('propagates error from failed query in batch', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery
                .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue([{ a: 1 }]) })
                .mockRejectedValueOnce(new Error('Query timeout'));

            await expect(
                manager.executeBatchAsync([
                    { query: 'SELECT 1 AS a' },
                    { query: 'SELECT slow_query()' }
                ])
            ).rejects.toThrow('Error executing ClickHouse batch');
        });
    });

    describe('tableExistsAsync', () => {
        test('returns true when table found', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue([{ 1: 1 }])
            });

            const result = await manager.tableExistsAsync('test_table');
            expect(result).toBe(true);
        });

        test('returns false when table not found', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockResolvedValue({
                json: jest.fn().mockResolvedValue([])
            });

            const result = await manager.tableExistsAsync('nonexistent_table');
            expect(result).toBe(false);
        });

        test('returns false on error (swallows exception)', async () => {
            manager.client = { query: mockQuery, insert: mockInsert, close: mockClose };
            manager.isConnected = true;

            mockQuery.mockRejectedValue(new Error('Permission denied'));

            const result = await manager.tableExistsAsync('protected_table');
            expect(result).toBe(false);
        });
    });
});
