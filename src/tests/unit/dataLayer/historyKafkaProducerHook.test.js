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
            produceAsync: jest.fn(async () => {
                order.push('kafka');
            })
        };
        const inserter = Object.create(InserterClass.prototype);
        Object.assign(inserter, { bulkWriteExecutors: [executor], historyKafkaProducer });
        return { inserter, executor, historyKafkaProducer, order };
    };
    const call = (inserter, useHistoryCollection) => inserter.performBulkForResourceTypeAsync({
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
