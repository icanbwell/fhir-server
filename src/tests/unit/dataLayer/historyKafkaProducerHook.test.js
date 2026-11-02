'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { retryWithBackoff } = require('../../../utils/retryWithBackoff');

// Both inserters share the same history flush seam (performBulkForResourceTypeAsync), so the
// parallel Kafka produce must behave identically on each.
describe.each([
    ['DatabaseBulkInserter', DatabaseBulkInserter],
    ['FastDatabaseBulkInserter', FastDatabaseBulkInserter]
])('%s history Kafka hook', (_name, InserterClass) => {
    const build = () => {
        const order = [];
        const executor = {
            canHandle: () => true,
            executeBulkAsync: jest.fn(async () => {
                order.push('mongo');
                return { mergeResultEntries: [], error: null };
            })
        };
        const historyKafkaProducer = {
            isEnabledFor: jest.fn(() => true),
            isMongoWriteDisabledFor: jest.fn(() => false),
            produceAsync: jest.fn(async () => {
                order.push('kafka');
            }),
            produceWithMongoFallbackAsync: jest.fn(async () => {
                order.push('kafka');
                return [];
            })
        };
        const inserter = Object.create(InserterClass.prototype);
        Object.assign(inserter, { bulkWriteExecutors: [executor], historyKafkaProducer });
        return { inserter, executor, historyKafkaProducer, order };
    };
    const call = (inserter, useHistoryCollection, extra = {}) => inserter.performBulkForResourceTypeAsync({
        ...extra,
        resourceType: 'Observation',
        base_version: '4_0_0',
        useHistoryCollection,
        operations: [{ uuid: 'u1' }],
        requestInfo: { requestId: 'r1' }
    });

    test('produces after the Mongo history write', async () => {
        const { inserter, historyKafkaProducer, order } = build();
        const result = await call(inserter, true);
        expect(order).toEqual(['mongo', 'kafka']);
        expect(historyKafkaProducer.produceAsync).toHaveBeenCalledWith({
            resourceType: 'Observation', operations: [{ uuid: 'u1' }], requestId: 'r1'
        });
        expect(result).toEqual({ mergeResultEntries: [], error: null });
    });

    test.each([[false], [null]])('does not produce when useHistoryCollection=%s', async (flag) => {
        const { inserter, executor, historyKafkaProducer } = build();
        await call(inserter, flag);
        expect(executor.executeBulkAsync).toHaveBeenCalledTimes(1);
        expect(historyKafkaProducer.produceAsync).not.toHaveBeenCalled();
    });

    test('skips the produce when the Mongo history write reported an error', async () => {
        const { inserter, executor, historyKafkaProducer } = build();
        executor.executeBulkAsync.mockResolvedValue({ mergeResultEntries: [], error: new Error('size') });
        await call(inserter, true);
        expect(historyKafkaProducer.produceAsync).not.toHaveBeenCalled();
    });

    test('nothing is produced for a type that is not enabled', async () => {
        const { inserter, historyKafkaProducer } = build();
        historyKafkaProducer.isEnabledFor.mockReturnValue(false);
        await call(inserter, true);
        expect(historyKafkaProducer.isEnabledFor).toHaveBeenCalledWith('Observation');
        expect(historyKafkaProducer.produceAsync).not.toHaveBeenCalled();
    });

    describe('Mongo history write disabled for the type', () => {
        test('Kafka accepted everything: Mongo is not written and nothing is produced twice', async () => {
            const { inserter, executor, historyKafkaProducer } = build();
            historyKafkaProducer.isMongoWriteDisabledFor.mockReturnValue(true);
            const result = await call(inserter, true);
            expect(historyKafkaProducer.produceWithMongoFallbackAsync).toHaveBeenCalledWith({
                resourceType: 'Observation', operations: [{ uuid: 'u1' }], requestId: 'r1'
            });
            expect(executor.executeBulkAsync).not.toHaveBeenCalled();
            expect(historyKafkaProducer.produceAsync).not.toHaveBeenCalled();
            expect(result).toEqual({ resourceType: 'Observation', mergeResult: undefined, error: null, mergeResultEntries: [] });
        });

        test('Kafka rejected some: only those are written to Mongo, and they are not re-produced', async () => {
            const { inserter, executor, historyKafkaProducer } = build();
            historyKafkaProducer.isMongoWriteDisabledFor.mockReturnValue(true);
            historyKafkaProducer.produceWithMongoFallbackAsync.mockResolvedValue([{ uuid: 'u2' }]);
            await inserter.performBulkForResourceTypeAsync({
                resourceType: 'Observation',
                base_version: '4_0_0',
                useHistoryCollection: true,
                operations: [{ uuid: 'u1' }, { uuid: 'u2' }],
                requestInfo: { requestId: 'r1' }
            });
            expect(executor.executeBulkAsync).toHaveBeenCalledTimes(1);
            expect(executor.executeBulkAsync.mock.calls[0][0].operations).toEqual([{ uuid: 'u2' }]);
            expect(historyKafkaProducer.produceAsync).not.toHaveBeenCalled();
        });

        test.each([[false], [null]])('is ignored for non-history writes (useHistoryCollection=%s)', async (flag) => {
            const { inserter, executor, historyKafkaProducer } = build();
            historyKafkaProducer.isMongoWriteDisabledFor.mockReturnValue(true);
            await call(inserter, flag);
            expect(historyKafkaProducer.produceWithMongoFallbackAsync).not.toHaveBeenCalled();
            expect(executor.executeBulkAsync).toHaveBeenCalledTimes(1);
        });
    });

    test('works without a producer configured', async () => {
        const { inserter, executor } = build();
        inserter.historyKafkaProducer = null;
        await call(inserter, true);
        expect(executor.executeBulkAsync).toHaveBeenCalledTimes(1);
    });
});

describe('retryWithBackoff jitter', () => {
    test('waits between 50% and 100% of the backoff delay when jitter is on', async () => {
        const delays = [];
        await expect(retryWithBackoff({
            fn: async () => { throw new Error('x'); },
            maxRetries: 2,
            initialDelayMs: 2,
            jitter: true,
            onRetry: ({ delay }) => delays.push(delay)
        })).rejects.toThrow('x');
        expect(delays).toHaveLength(2);
        expect(delays[0]).toBeGreaterThanOrEqual(1);
        expect(delays[0]).toBeLessThanOrEqual(2);
        expect(delays[1]).toBeGreaterThanOrEqual(2);
        expect(delays[1]).toBeLessThanOrEqual(4);
    });
});
