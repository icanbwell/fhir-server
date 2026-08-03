'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../dataLayer/repositories/accessLogClickHouseRepository', () => ({
    AccessLogClickHouseRepository: class AccessLogClickHouseRepository {}
}));

jestObj.mock('../../../dataLayer/clickHouse/accessLogTransformer', () => ({
    AccessLogTransformer: class AccessLogTransformer {}
}));

const { AccessLogClickHouseWriter } = require('../../../utils/accessLogClickHouseWriter');
const { logError } = require('../../../operations/common/logging');

describe('AccessLogClickHouseWriter', () => {
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
        writer = new AccessLogClickHouseWriter({
            accessLogClickHouseRepository: mockRepository,
            accessLogTransformer: mockTransformer
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
            mockTransformer.transformBatch.mockReturnValue({ rows: [], skipped: 3 });
            const docs = [{ id: '1' }, { id: '2' }, { id: '3' }];

            const result = await writer.writeBatchAsync(docs);

            expect(result).toEqual({ inserted: 0, skipped: 3 });
            expect(mockRepository.insertBatchAsync).not.toHaveBeenCalled();
        });

        test('transforms and inserts docs, returns correct counts', async () => {
            const transformedRows = [{ row: 1 }, { row: 2 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 1 });
            mockRepository.insertBatchAsync.mockResolvedValue(undefined);
            const docs = [{ id: '1' }, { id: '2' }, { id: '3' }];

            const result = await writer.writeBatchAsync(docs);

            expect(mockTransformer.transformBatch).toHaveBeenCalledWith(docs);
            expect(mockRepository.insertBatchAsync).toHaveBeenCalledWith(transformedRows);
            expect(result).toEqual({ inserted: 2, skipped: 1 });
        });

        test('swallows errors and returns skipped count equal to docs.length', async () => {
            const transformedRows = [{ row: 1 }, { row: 2 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 1 });
            mockRepository.insertBatchAsync.mockRejectedValue(new Error('write failed'));
            const docs = [{ id: '1' }, { id: '2' }, { id: '3' }];

            const result = await writer.writeBatchAsync(docs);

            expect(result).toEqual({ inserted: 0, skipped: 3 });
        });

        test('logs error with context when insert fails', async () => {
            const transformedRows = [{ row: 1 }];
            mockTransformer.transformBatch.mockReturnValue({ rows: transformedRows, skipped: 0 });
            mockRepository.insertBatchAsync.mockRejectedValue(new Error('CH down'));
            const docs = [{ id: '1', request: { id: 'req-abc' } }];

            await writer.writeBatchAsync(docs);

            expect(logError).toHaveBeenCalledWith(
                'AccessLogClickHouseWriter: batch write failed',
                expect.objectContaining({
                    source: 'AccessLogClickHouseWriter.writeBatchAsync',
                    args: expect.objectContaining({
                        batchSize: 1,
                        transformedRows: 1,
                        skipped: 0,
                        firstRequestId: 'req-abc'
                    })
                })
            );
        });

        test('does not throw on insert failure', async () => {
            mockTransformer.transformBatch.mockReturnValue({ rows: [{ r: 1 }], skipped: 0 });
            mockRepository.insertBatchAsync.mockRejectedValue(new Error('fail'));

            await expect(writer.writeBatchAsync([{ id: '1' }])).resolves.not.toThrow();
        });
    });
});
