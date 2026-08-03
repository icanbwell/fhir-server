'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../dataLayer/repositories/auditEventClickHouseRepository', () => ({
    AuditEventClickHouseRepository: class AuditEventClickHouseRepository {}
}));

jestObj.mock('../../../dataLayer/clickHouse/auditEventTransformer', () => ({
    AuditEventTransformer: class AuditEventTransformer {}
}));

const { AuditEventClickHouseWriter } = require('../../../utils/auditEventClickHouseWriter');
const { logError } = require('../../../operations/common/logging');

describe('AuditEventClickHouseWriter', () => {
    let writer;
    let mockRepository;
    let mockTransformer;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockRepository = {
            insertBatchAsync: jestObj.fn()
        };
        mockTransformer = {
            transformBatch: jestObj.fn()
        };
        writer = new AuditEventClickHouseWriter({
            auditEventClickHouseRepository: mockRepository,
            auditEventTransformer: mockTransformer
        });
    });

    describe('constructor', () => {
        test('stores repository and transformer', () => {
            expect(writer.repository).toBe(mockRepository);
            expect(writer.transformer).toBe(mockTransformer);
        });
    });

    describe('writeBatchAsync', () => {
        test('returns zeros on null docs', async () => {
            const result = await writer.writeBatchAsync(null);
            expect(result).toEqual({ inserted: 0, skipped: 0 });
            expect(mockTransformer.transformBatch).not.toHaveBeenCalled();
        });

        test('returns zeros on undefined docs', async () => {
            const result = await writer.writeBatchAsync(undefined);
            expect(result).toEqual({ inserted: 0, skipped: 0 });
        });

        test('returns zeros on empty array', async () => {
            const result = await writer.writeBatchAsync([]);
            expect(result).toEqual({ inserted: 0, skipped: 0 });
        });

        test('returns inserted 0 and skipped count when all rows are skipped', async () => {
            mockTransformer.transformBatch.mockReturnValue({ rows: [], skipped: 4 });
            const docs = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];

            const result = await writer.writeBatchAsync(docs);

            expect(result).toEqual({ inserted: 0, skipped: 4 });
            expect(mockRepository.insertBatchAsync).not.toHaveBeenCalled();
        });

        test('transforms and inserts docs, returns correct counts', async () => {
            const transformedRows = [{ row: 1 }, { row: 2 }, { row: 3 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 2 });
            mockRepository.insertBatchAsync.mockResolvedValue(undefined);
            const docs = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];

            const result = await writer.writeBatchAsync(docs);

            expect(mockTransformer.transformBatch).toHaveBeenCalledWith(docs);
            expect(mockRepository.insertBatchAsync).toHaveBeenCalledWith(transformedRows);
            expect(result).toEqual({ inserted: 3, skipped: 2 });
        });

        test('re-throws error on insert failure (unlike AccessLogWriter)', async () => {
            const transformedRows = [{ row: 1 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 0 });
            const error = new Error('ClickHouse unavailable');
            mockRepository.insertBatchAsync.mockRejectedValue(error);

            await expect(writer.writeBatchAsync([{ id: '1' }])).rejects.toThrow('ClickHouse unavailable');
        });

        test('logs error before re-throwing', async () => {
            const transformedRows = [{ row: 1 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 0 });
            mockRepository.insertBatchAsync.mockRejectedValue(new Error('CH down'));
            const docs = [{ _uuid: 'uuid-123', id: 'event-1' }];

            await expect(writer.writeBatchAsync(docs)).rejects.toThrow();

            expect(logError).toHaveBeenCalledWith(
                'AuditEventClickHouseWriter: batch write failed',
                expect.objectContaining({
                    source: 'AuditEventClickHouseWriter.writeBatchAsync',
                    args: expect.objectContaining({
                        batchSize: 1,
                        transformedRows: 1,
                        skipped: 0,
                        firstDocId: 'uuid-123'
                    })
                })
            );
        });

        test('re-throws the exact same error object', async () => {
            const transformedRows = [{ row: 1 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 0 });
            const originalError = new Error('specific error');
            mockRepository.insertBatchAsync.mockRejectedValue(originalError);

            try {
                await writer.writeBatchAsync([{ id: '1' }]);
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBe(originalError);
            }
        });
    });
});
