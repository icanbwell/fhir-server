const { describe, test, expect, jest, beforeEach } = require('@jest/globals');
const { AccessLogClickHouseRepository } = require('../../../dataLayer/repositories/accessLogClickHouseRepository');
const { TABLES, QUERY_FORMAT } = require('../../../constants/clickHouseConstants');

describe('AccessLogClickHouseRepository', () => {
    let mockClickHouseClientManager;

    beforeEach(() => {
        mockClickHouseClientManager = {
            insertAsync: jest.fn().mockResolvedValue(undefined)
        };
    });

    function createRepository (overrides = {}) {
        return new AccessLogClickHouseRepository({
            clickHouseClientManager: mockClickHouseClientManager,
            maxRetries: overrides.maxRetries ?? 3,
            initialRetryDelayMs: overrides.initialRetryDelayMs ?? 10 // fast for tests
        });
    }

    const sampleRow = () => ({
        timestamp: '2024-06-15 10:30:00.000',
        outcome_desc: 'Success',
        agent: { altId: 'user-1', scopes: ['user/*.read'] },
        details: { host: 'fhir.example.com', originService: 'svc' },
        request: { id: 'req-1' },
        access_tags: ['admin']
    });

    test('inserts rows with correct table, format, and async settings', async () => {
        const repository = createRepository();
        const rows = [sampleRow(), sampleRow()];

        await repository.insertBatchAsync(rows);

        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(1);
        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledWith({
            table: TABLES.ACCESS_LOG,
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

    test('retries on failure and succeeds on attempt 3', async () => {
        const error = new Error('Connection refused');
        mockClickHouseClientManager.insertAsync
            .mockRejectedValueOnce(error)
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(undefined);

        const repository = createRepository();
        await repository.insertBatchAsync([sampleRow()]);

        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(3);
    });

    test('succeeds on first retry after initial failure', async () => {
        const error = new Error('Temporary error');
        mockClickHouseClientManager.insertAsync
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(undefined);

        const repository = createRepository();
        await repository.insertBatchAsync([sampleRow()]);

        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(2);
    });

    test('throws RethrownError after all retries exhausted', async () => {
        const error = new Error('Connection refused');
        mockClickHouseClientManager.insertAsync.mockRejectedValue(error);

        const repository = createRepository({ maxRetries: 3 });

        await expect(repository.insertBatchAsync([sampleRow()])).rejects.toThrow(
            'ClickHouse AccessLog insert failed after 3 retries (batch size 1)'
        );
        expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(4);
    });

    test('uses exponential backoff for retry delays', async () => {
        const error = new Error('Connection refused');
        mockClickHouseClientManager.insertAsync.mockRejectedValue(error);

        const repository = createRepository({ maxRetries: 2, initialRetryDelayMs: 50 });

        const start = Date.now();
        await expect(repository.insertBatchAsync([sampleRow()])).rejects.toThrow();
        const elapsed = Date.now() - start;

        // 50ms + 100ms = 150ms minimum delay (with some tolerance)
        expect(elapsed).toBeGreaterThanOrEqual(100);
    });
});
