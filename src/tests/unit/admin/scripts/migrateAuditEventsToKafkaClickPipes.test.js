'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * migrateAuditEventsToKafkaClickPipes.js exports its real logic as standalone functions
 * (parsePositiveInt, parseDateArg, formatElapsed, isKafkaPublishEnabled, publishWithRetryAsync,
 * processBatchAsync) and guards its `main()` invocation with `if (require.main === module)`, so
 * requiring the module in Jest never triggers the CLI/side-effecting path -- these are tested by
 * importing and calling the real exported functions directly, mocking only the Kafka client
 * boundary and Mongo collection.
 */

// The script requires ../../createContainer at module top-level (needed only by its un-exported
// main()). createContainer transitively pulls in an ESM-only dependency
// (@icanbwell/fhirpatientsummary via operations/summary/summary.js) that this jest config's
// transformIgnorePatterns does not allowlist -- the same class of gap already quarantined for
// adminExportManagerRequestInfo.test.js in jest.unit.config.js. Since none of the functions under
// test here call createContainer(), stub the module out so requiring the script doesn't drag in
// that untransformable chain.
jestGlobal.mock('../../../../createContainer', () => ({
    createContainer: jestGlobal.fn()
}));

const {
    parsePositiveInt,
    parseDateArg,
    formatElapsed,
    isKafkaPublishEnabled,
    publishWithRetryAsync,
    processBatchAsync
} = require('../../../../admin/scripts/migrateAuditEventsToKafkaClickPipes');
const { AuditEventTransformer } = require('../../../../dataLayer/clickHouse/auditEventTransformer');

class ProcessExitSignal extends Error {
    constructor (code) {
        super(`process.exit(${code})`);
        this.code = code;
    }
}

describe('migrateAuditEventsToKafkaClickPipes.js', () => {
    let exitSpy;
    let setTimeoutSpy;

    beforeEach(() => {
        exitSpy = jestGlobal.spyOn(process, 'exit').mockImplementation((code) => {
            throw new ProcessExitSignal(code);
        });
        // Collapse the real exponential-backoff delays so retry tests run instantly.
        setTimeoutSpy = jestGlobal.spyOn(global, 'setTimeout').mockImplementation((fn) => {
            fn();
            return 0;
        });
    });

    afterEach(() => {
        exitSpy.mockRestore();
        setTimeoutSpy.mockRestore();
    });

    describe('parsePositiveInt', () => {
        test('parses a valid positive integer string', () => {
            expect(parsePositiveInt('--batch-size', '500')).toBe(500);
        });

        test('exits(1) when the argument is missing', () => {
            expect(() => parsePositiveInt('--batch-size', undefined)).toThrow(ProcessExitSignal);
            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        test('exits(1) when the "argument" is actually the next flag (e.g. --batch-size --start-from)', () => {
            expect(() => parsePositiveInt('--batch-size', '--start-from')).toThrow(ProcessExitSignal);
        });

        test('exits(1) for zero or negative values', () => {
            expect(() => parsePositiveInt('--batch-size', '0')).toThrow(ProcessExitSignal);
            exitSpy.mockClear();
            expect(() => parsePositiveInt('--batch-size', '-5')).toThrow(ProcessExitSignal);
        });

        test('exits(1) for a non-numeric string', () => {
            expect(() => parsePositiveInt('--batch-size', 'abc')).toThrow(ProcessExitSignal);
        });
    });

    describe('parseDateArg', () => {
        test('parses a valid ISO date string into a Date', () => {
            const result = parseDateArg('--start-from', '2024-01-01T00:00:00Z');
            expect(result).toBeInstanceOf(Date);
            expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
        });

        test('exits(1) when the argument is missing', () => {
            expect(() => parseDateArg('--start-from', undefined)).toThrow(ProcessExitSignal);
        });

        test('exits(1) for an unparseable date string', () => {
            expect(() => parseDateArg('--start-from', 'not-a-date')).toThrow(ProcessExitSignal);
        });
    });

    describe('formatElapsed', () => {
        test('formats sub-minute durations as 00:00:SS', () => {
            expect(formatElapsed(45000)).toBe('00:00:45');
        });

        test('formats hours/minutes/seconds correctly for a multi-hour duration', () => {
            // 1h 2m 3s = 3723000 ms
            expect(formatElapsed(3723000)).toBe('01:02:03');
        });

        test('formats zero elapsed time as 00:00:00', () => {
            expect(formatElapsed(0)).toBe('00:00:00');
        });
    });

    describe('isKafkaPublishEnabled', () => {
        test('returns true when kafkaV2EnableEvents is truthy', () => {
            expect(isKafkaPublishEnabled({ kafkaV2EnableEvents: '1' })).toBe(true);
        });

        test('returns false when kafkaV2EnableEvents is falsy/undefined', () => {
            expect(isKafkaPublishEnabled({ kafkaV2EnableEvents: undefined })).toBe(false);
            expect(isKafkaPublishEnabled({ kafkaV2EnableEvents: '' })).toBe(false);
        });
    });

    describe('publishWithRetryAsync', () => {
        test('publishes once and returns without retrying on first-attempt success', async () => {
            const kafkaClientV2 = { sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            await publishWithRetryAsync(kafkaClientV2, 'topic-a', [{ key: 'k', value: 'v' }]);
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledWith({
                topic: 'topic-a',
                messages: [{ key: 'k', value: 'v' }]
            });
        });

        test('retries with backoff and eventually succeeds', async () => {
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jestGlobal
                    .fn()
                    .mockRejectedValueOnce(new Error('broker unavailable'))
                    .mockResolvedValueOnce(undefined)
            };
            await publishWithRetryAsync(kafkaClientV2, 'topic-a', []);
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
        });

        test('throws a descriptive error after exhausting all retry attempts', async () => {
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jestGlobal.fn().mockRejectedValue(new Error('oversized message'))
            };
            await expect(publishWithRetryAsync(kafkaClientV2, 'topic-a', [1, 2, 3])).rejects.toThrow(
                /Kafka publish failed after 3 attempts \(batch size 3\): oversized message/
            );
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
        });
    });

    describe('processBatchAsync', () => {
        function makeCollection (deletedCount) {
            return { deleteMany: jestGlobal.fn().mockResolvedValue({ deletedCount }) };
        }

        test('publishes and deletes all docs when every doc is valid (happy path, N>1 docs)', async () => {
            const transformer = new AuditEventTransformer();
            const docs = [
                { _id: 'a', _uuid: 'uuid-a', recorded: new Date('2024-01-01T00:00:00Z') },
                { _id: 'b', _uuid: 'uuid-b', recorded: new Date('2024-01-02T00:00:00Z') }
            ];
            const kafkaClientV2 = { sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            const collection = makeCollection(2);

            const result = await processBatchAsync({
                docs,
                collection,
                kafkaClientV2,
                topic: 'audit-topic',
                transformer,
                batchNo: 1
            });

            expect(result).toEqual({ inserted: 2, deleted: 2, failed: 0 });
            expect(kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            const publishedMessages = kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages;
            expect(publishedMessages).toHaveLength(2);
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['a', 'b'] } });
        });

        test('a single malformed doc (missing recorded/transform throws) is skipped without aborting the rest of the batch', async () => {
            const transformer = new AuditEventTransformer();
            const goodDoc = { _id: 'good', _uuid: 'uuid-good', recorded: new Date('2024-01-01T00:00:00Z') };
            const badDoc = { _id: 'bad' }; // missing recorded -> transformDocument throws
            const kafkaClientV2 = { sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            const collection = makeCollection(1);

            const result = await processBatchAsync({
                docs: [goodDoc, badDoc],
                collection,
                kafkaClientV2,
                topic: 'audit-topic',
                transformer,
                batchNo: 2
            });

            expect(result).toEqual({ inserted: 1, deleted: 1, failed: 1 });
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['good'] } });
        });

        test('a doc that transforms cleanly but fails assertValidRow (missing _uuid) is skipped, not fatal', async () => {
            const transformer = new AuditEventTransformer();
            const missingUuidDoc = { _id: 'no-uuid', recorded: new Date('2024-01-01T00:00:00Z') };
            const kafkaClientV2 = { sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            const collection = makeCollection(0);

            const result = await processBatchAsync({
                docs: [missingUuidDoc],
                collection,
                kafkaClientV2,
                topic: 'audit-topic',
                transformer,
                batchNo: 3
            });

            expect(result).toEqual({ inserted: 0, deleted: 0, failed: 1 });
            expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
            expect(collection.deleteMany).not.toHaveBeenCalled();
        });

        test('when the Kafka publish exhausts retries, none of the batch is deleted from Mongo', async () => {
            const transformer = new AuditEventTransformer();
            const docs = [{ _id: 'a', _uuid: 'uuid-a', recorded: new Date('2024-01-01T00:00:00Z') }];
            const kafkaClientV2 = {
                sendCloudEventMessageAsync: jestGlobal.fn().mockRejectedValue(new Error('too big'))
            };
            const collection = makeCollection(0);

            const result = await processBatchAsync({
                docs,
                collection,
                kafkaClientV2,
                topic: 'audit-topic',
                transformer,
                batchNo: 4
            });

            expect(result.inserted).toBe(0);
            expect(result.deleted).toBe(0);
            expect(result.failed).toBe(1);
            expect(collection.deleteMany).not.toHaveBeenCalled();
        });

        test('empty docs array publishes nothing and deletes nothing', async () => {
            const transformer = new AuditEventTransformer();
            const kafkaClientV2 = { sendCloudEventMessageAsync: jestGlobal.fn() };
            const collection = makeCollection(0);

            const result = await processBatchAsync({
                docs: [],
                collection,
                kafkaClientV2,
                topic: 'audit-topic',
                transformer,
                batchNo: 5
            });

            expect(result).toEqual({ inserted: 0, deleted: 0, failed: 0 });
            expect(kafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
            expect(collection.deleteMany).not.toHaveBeenCalled();
        });
    });
});
