const { describe, test, expect, jest, beforeEach } = require('@jest/globals');
const { AuditEventClickHouseRepository } = require('../../../dataLayer/repositories/auditEventClickHouseRepository');
const { TABLES, QUERY_FORMAT } = require('../../../constants/clickHouseConstants');

describe('AuditEventClickHouseRepository', () => {
    let mockClickHouseClientManager;

    beforeEach(() => {
        mockClickHouseClientManager = {
            insertAsync: jest.fn().mockResolvedValue(undefined)
        };
    });

    function createRepository (overrides = {}) {
        return new AuditEventClickHouseRepository({
            clickHouseClientManager: mockClickHouseClientManager,
            maxRetries: overrides.maxRetries ?? 3,
            initialRetryDelayMs: overrides.initialRetryDelayMs ?? 10 // fast for tests
        });
    }

    test('inserts rows with correct table and format', async () => {
        const repository = createRepository();
        const rows = [
            { id: 'audit-001', _uuid: 'uuid-001', recorded: '2024-06-15 10:30:00.000' },
            { id: 'audit-002', _uuid: 'uuid-002', recorded: '2024-06-15 11:00:00.000' }
        ];

        await repository.insertBatchAsync(rows);

        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(1);
        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledWith({
            table: TABLES.AUDIT_EVENT,
            values: rows,
            format: QUERY_FORMAT.JSON_EACH_ROW,
            clickhouse_settings: {
                async_insert: 1,
                wait_for_async_insert: 1
            }
        });
    });

    test('does nothing for empty array', async () => {
        const repository = createRepository();
        await repository.insertBatchAsync([]);

        expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
    });

    test('does nothing for null input', async () => {
        const repository = createRepository();
        await repository.insertBatchAsync(null);

        expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
    });

    test('retries on failure and succeeds', async () => {
        const error = new Error('Connection refused');
        mockClickHouseClientManager.insertAsync
            .mockRejectedValueOnce(error)
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(undefined);

        const repository = createRepository();
        const rows = [{ id: 'audit-001', _uuid: 'uuid-001', recorded: '2024-06-15 10:30:00.000' }];

        await repository.insertBatchAsync(rows);

        // Initial attempt + 2 retries = 3 calls total
        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(3);
    });

    test('throws after all retries exhausted', async () => {
        const error = new Error('Connection refused');
        mockClickHouseClientManager.insertAsync.mockRejectedValue(error);

        const repository = createRepository({ maxRetries: 3 });
        const rows = [{ id: 'audit-001', _uuid: 'uuid-001', recorded: '2024-06-15 10:30:00.000' }];

        await expect(repository.insertBatchAsync(rows)).rejects.toThrow(
            'ClickHouse AuditEvent insert failed after 3 retries (batch size 1)'
        );

        // Initial attempt + 3 retries = 4 calls total
        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(4);
    });

    test('succeeds on first retry after initial failure', async () => {
        const error = new Error('Temporary error');
        mockClickHouseClientManager.insertAsync
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(undefined);

        const repository = createRepository();
        const rows = [{ id: 'audit-001', _uuid: 'uuid-001', recorded: '2024-06-15 10:30:00.000' }];

        await repository.insertBatchAsync(rows);

        // Initial attempt + 1 retry = 2 calls
        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(2);
    });

    test('uses exponential backoff for retry delays', async () => {
        const error = new Error('Connection refused');
        mockClickHouseClientManager.insertAsync.mockRejectedValue(error);

        const repository = createRepository({ maxRetries: 2, initialRetryDelayMs: 50 });
        const rows = [{ id: 'audit-001', _uuid: 'uuid-001', recorded: '2024-06-15 10:30:00.000' }];

        const start = Date.now();
        await expect(repository.insertBatchAsync(rows)).rejects.toThrow();
        const elapsed = Date.now() - start;

        // 50ms + 100ms = 150ms minimum delay (with some tolerance)
        expect(elapsed).toBeGreaterThanOrEqual(100);
    });
});
