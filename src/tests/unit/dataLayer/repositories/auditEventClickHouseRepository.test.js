'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../constants/clickHouseConstants', () => ({
    TABLES: { AUDIT_EVENT: 'fhir.AuditEvent_4_0_0' },
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

const { AuditEventClickHouseRepository } = require('../../../../dataLayer/repositories/auditEventClickHouseRepository');
const { RethrownError } = require('../../../../utils/rethrownError');
const { logWarn } = require('../../../../operations/common/logging');

describe('AuditEventClickHouseRepository', () => {
    let repo;
    let mockClickHouseClientManager;

    beforeEach(() => {
        jestObj.clearAllMocks();
        jestObj.useFakeTimers();
        mockClickHouseClientManager = {
            insertAsync: jestObj.fn()
        };
        repo = new AuditEventClickHouseRepository({
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
            const customRepo = new AuditEventClickHouseRepository({
                clickHouseClientManager: mockClickHouseClientManager,
                maxRetries: 5,
                initialRetryDelayMs: 1000
            });
            expect(customRepo.maxRetries).toBe(5);
            expect(customRepo.initialRetryDelayMs).toBe(1000);
        });
    });

    describe('insertBatchAsync', () => {
        test('returns immediately for null rows', async () => {
            await repo.insertBatchAsync(null);
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('returns immediately for undefined rows', async () => {
            await repo.insertBatchAsync(undefined);
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('returns immediately for empty array', async () => {
            await repo.insertBatchAsync([]);
            expect(mockClickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('succeeds on first attempt', async () => {
            mockClickHouseClientManager.insertAsync.mockResolvedValue(undefined);
            const rows = [{ event: 'data' }];

            await repo.insertBatchAsync(rows);

            expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(1);
            expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledWith({
                table: 'fhir.AuditEvent_4_0_0',
                values: rows,
                format: 'JSONEachRow',
                clickhouse_settings: {
                    async_insert: 1,
                    wait_for_async_insert: 1
                }
            });
        });

        test('retries and succeeds on 2nd attempt', async () => {
            mockClickHouseClientManager.insertAsync
                .mockRejectedValueOnce(new Error('temporary failure'))
                .mockResolvedValueOnce(undefined);
            const rows = [{ event: 'data' }];

            const promise = repo.insertBatchAsync(rows);
            // Advance past the first retry delay (2000ms)
            await jestObj.advanceTimersByTimeAsync(2000);
            await promise;

            expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(2);
            expect(logWarn).toHaveBeenCalledWith(
                'ClickHouse AuditEvent insert failed, retrying',
                expect.objectContaining({
                    attempt: 1,
                    maxRetries: 3,
                    delay: 2000
                })
            );
        });

        test('throws RethrownError after all retries exhausted', async () => {
            const originalError = new Error('persistent failure');
            mockClickHouseClientManager.insertAsync.mockRejectedValue(originalError);
            const rows = [{ event: 'data' }, { event: 'data2' }];

            let caughtError;
            const promise = repo.insertBatchAsync(rows).catch(e => { caughtError = e; });
            // Advance through all retry delays: 2000 + 4000 + 8000
            await jestObj.advanceTimersByTimeAsync(2000);
            await jestObj.advanceTimersByTimeAsync(4000);
            await jestObj.advanceTimersByTimeAsync(8000);
            await promise;

            expect(caughtError).toBeInstanceOf(RethrownError);
            expect(caughtError.message).toBe(
                'ClickHouse AuditEvent insert failed after 3 retries (batch size 2)'
            );
        });

        test('delay doubles exponentially between retries', async () => {
            mockClickHouseClientManager.insertAsync
                .mockRejectedValueOnce(new Error('fail1'))
                .mockRejectedValueOnce(new Error('fail2'))
                .mockResolvedValueOnce(undefined);
            const rows = [{ event: 'data' }];

            const promise = repo.insertBatchAsync(rows);

            // First retry delay: 2000ms
            await jestObj.advanceTimersByTimeAsync(2000);
            expect(logWarn).toHaveBeenCalledWith(
                'ClickHouse AuditEvent insert failed, retrying',
                expect.objectContaining({ attempt: 1, delay: 2000 })
            );

            // Second retry delay: 4000ms (doubled)
            await jestObj.advanceTimersByTimeAsync(4000);
            expect(logWarn).toHaveBeenCalledWith(
                'ClickHouse AuditEvent insert failed, retrying',
                expect.objectContaining({ attempt: 2, delay: 4000 })
            );

            await promise;
            expect(mockClickHouseClientManager.insertAsync).toHaveBeenCalledTimes(3);
        });

        test('does not log warning on first attempt', async () => {
            mockClickHouseClientManager.insertAsync.mockResolvedValue(undefined);
            await repo.insertBatchAsync([{ event: 'data' }]);
            expect(logWarn).not.toHaveBeenCalled();
        });
    });
});
