'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../constants/clickHouseConstants', () => ({
    TABLES: { ACCESS_LOG: 'fhir.AccessLog' },
    QUERY_FORMAT: { JSON_EACH_ROW: 'JSONEachRow' }
}));

jestObj.mock('../../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args }) {
            super(message);
            this.innerError = error;
            this.args = args;
        }
    }
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logWarn: jestObj.fn()
}));

jestObj.mock('../../../../utils/retryWithBackoff', () => ({
    retryWithBackoff: jestObj.fn()
}));

const { AccessLogClickHouseRepository } = require('../../../../dataLayer/repositories/accessLogClickHouseRepository');
const { retryWithBackoff } = require('../../../../utils/retryWithBackoff');
const { RethrownError } = require('../../../../utils/rethrownError');

describe('AccessLogClickHouseRepository', () => {
    let repo;
    let mockClickHouseClientManager;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockClickHouseClientManager = {
            insertAsync: jestObj.fn()
        };
        repo = new AccessLogClickHouseRepository({
            clickHouseClientManager: mockClickHouseClientManager
        });
    });

    describe('constructor', () => {
        test('stores clickHouseClientManager and defaults', () => {
            expect(repo.clickHouseClientManager).toBe(mockClickHouseClientManager);
            expect(repo.maxRetries).toBe(3);
            expect(repo.initialRetryDelayMs).toBe(2000);
        });

        test('accepts custom maxRetries and initialRetryDelayMs', () => {
            const customRepo = new AccessLogClickHouseRepository({
                clickHouseClientManager: mockClickHouseClientManager,
                maxRetries: 5,
                initialRetryDelayMs: 500
            });
            expect(customRepo.maxRetries).toBe(5);
            expect(customRepo.initialRetryDelayMs).toBe(500);
        });
    });

    describe('insertBatchAsync', () => {
        test('returns immediately for null rows', async () => {
            await repo.insertBatchAsync(null);
            expect(retryWithBackoff).not.toHaveBeenCalled();
        });

        test('returns immediately for undefined rows', async () => {
            await repo.insertBatchAsync(undefined);
            expect(retryWithBackoff).not.toHaveBeenCalled();
        });

        test('returns immediately for empty array', async () => {
            await repo.insertBatchAsync([]);
            expect(retryWithBackoff).not.toHaveBeenCalled();
        });

        test('calls retryWithBackoff with correct params', async () => {
            retryWithBackoff.mockResolvedValue(undefined);
            const rows = [{ field: 'value1' }, { field: 'value2' }];

            await repo.insertBatchAsync(rows);

            expect(retryWithBackoff).toHaveBeenCalledTimes(1);
            const callArgs = retryWithBackoff.mock.calls[0][0];
            expect(callArgs.maxRetries).toBe(3);
            expect(callArgs.initialDelayMs).toBe(2000);
            expect(typeof callArgs.fn).toBe('function');
            expect(typeof callArgs.onRetry).toBe('function');
        });

        test('fn passed to retryWithBackoff calls insertAsync with correct insert params', async () => {
            retryWithBackoff.mockImplementation(async ({ fn }) => fn());
            const rows = [{ field: 'value1' }];

            await repo.insertBatchAsync(rows);

            expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledWith({
                table: 'fhir.AccessLog',
                values: rows,
                format: 'JSONEachRow',
                clickhouse_settings: {
                    async_insert: 1,
                    wait_for_async_insert: 0,
                    insert_deduplicate: 0
                }
            });
        });

        test('throws RethrownError when retries exhausted', async () => {
            const originalError = new Error('Connection refused');
            retryWithBackoff.mockRejectedValue(originalError);
            const rows = [{ field: 'value' }];

            await expect(repo.insertBatchAsync(rows)).rejects.toThrow(RethrownError);
            await expect(repo.insertBatchAsync(rows)).rejects.toThrow(
                'ClickHouse AccessLog insert failed after 3 retries (batch size 1)'
            );
        });

        test('onRetry callback logs warning with correct context', async () => {
            const { logWarn } = require('../../../../operations/common/logging');
            retryWithBackoff.mockResolvedValue(undefined);
            const rows = [{ a: 1 }, { b: 2 }, { c: 3 }];

            await repo.insertBatchAsync(rows);

            const onRetry = retryWithBackoff.mock.calls[0][0].onRetry;
            onRetry({ attempt: 1, delay: 2000 });

            expect(logWarn).toHaveBeenCalledWith(
                'ClickHouse AccessLog insert failed, retrying',
                {
                    attempt: 1,
                    maxRetries: 3,
                    batchSize: 3,
                    delay: 2000
                }
            );
        });
    });
});
