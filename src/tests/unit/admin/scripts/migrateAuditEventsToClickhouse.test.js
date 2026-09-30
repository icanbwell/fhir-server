'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

// The script requires ../../createContainer at module top-level (needed only by its un-exported
// main()). createContainer transitively pulls in an ESM-only dependency
// (@icanbwell/fhirpatientsummary via operations/summary/summary.js) that this jest config's
// transformIgnorePatterns does not allowlist -- the same class of gap already quarantined for
// adminExportManagerRequestInfo.test.js in jest.unit.config.js. None of the functions under test
// here call createContainer(), so stub the module out to avoid dragging in that chain.
jestGlobal.mock('../../../../createContainer', () => ({
    createContainer: jestGlobal.fn()
}));

/**
 * migrateAuditEventsToClickhouse.js exports its real logic as standalone functions
 * (parsePositiveInt, formatElapsed, insertWithRetryAsync, processBatchAsync) and guards its
 * `main()` invocation with `if (require.main === module)`, so requiring the module in Jest never
 * triggers the CLI/side-effecting path.
 */
const {
    parsePositiveInt,
    formatElapsed,
    insertWithRetryAsync,
    processBatchAsync
} = require('../../../../admin/scripts/migrateAuditEventsToClickhouse');
const { AuditEventTransformer } = require('../../../../dataLayer/clickHouse/auditEventTransformer');

class ProcessExitSignal extends Error {
    constructor (code) {
        super(`process.exit(${code})`);
        this.code = code;
    }
}

describe('migrateAuditEventsToClickhouse.js', () => {
    let exitSpy;
    let setTimeoutSpy;

    beforeEach(() => {
        exitSpy = jestGlobal.spyOn(process, 'exit').mockImplementation((code) => {
            throw new ProcessExitSignal(code);
        });
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
            expect(parsePositiveInt('--batch-size', '1234')).toBe(1234);
        });

        test('exits(1) when the argument is missing', () => {
            expect(() => parsePositiveInt('--batch-size', undefined)).toThrow(ProcessExitSignal);
            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        test('exits(1) for a zero/negative value', () => {
            expect(() => parsePositiveInt('--batch-size', '0')).toThrow(ProcessExitSignal);
        });

        test('exits(1) for a non-numeric string', () => {
            expect(() => parsePositiveInt('--batch-size', 'nope')).toThrow(ProcessExitSignal);
        });
    });

    describe('formatElapsed', () => {
        test('formats sub-minute durations as 00:00:SS', () => {
            expect(formatElapsed(9000)).toBe('00:00:09');
        });

        test('formats hours/minutes/seconds for a multi-hour duration', () => {
            expect(formatElapsed(7384000)).toBe('02:03:04');
        });
    });

    describe('insertWithRetryAsync', () => {
        test('inserts once and returns without retry on first-attempt success', async () => {
            const clickHouseClientManager = { insertAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            await insertWithRetryAsync(clickHouseClientManager, [{ a: 1 }]);
            expect(clickHouseClientManager.insertAsync).toHaveBeenCalledTimes(1);
            expect(clickHouseClientManager.insertAsync).toHaveBeenCalledWith({
                table: 'fhir.AuditEvent_4_0_0',
                values: [{ a: 1 }],
                format: 'JSONEachRow'
            });
        });

        test('retries on a generic (non-size) error and eventually succeeds', async () => {
            const clickHouseClientManager = {
                insertAsync: jestGlobal
                    .fn()
                    .mockRejectedValueOnce(new Error('connection reset'))
                    .mockResolvedValueOnce(undefined)
            };
            await insertWithRetryAsync(clickHouseClientManager, [{ a: 1 }]);
            expect(clickHouseClientManager.insertAsync).toHaveBeenCalledTimes(2);
        });

        test('throws a descriptive error after exhausting all retries on a generic failure', async () => {
            const clickHouseClientManager = {
                insertAsync: jestGlobal.fn().mockRejectedValue(new Error('server down'))
            };
            await expect(insertWithRetryAsync(clickHouseClientManager, [1, 2])).rejects.toThrow(
                /ClickHouse insert failed after 3 attempts \(batch size 2\): server down/
            );
        });

        test('splits an over-large batch in half on a size-related error and inserts each half', async () => {
            const rows = new Array(2500).fill(0).map((_, i) => ({ i }));
            let callCount = 0;
            const clickHouseClientManager = {
                insertAsync: jestGlobal.fn().mockImplementation(({ values }) => {
                    callCount++;
                    if (callCount === 1 && values.length === rows.length) {
                        return Promise.reject(new Error('Invalid string length'));
                    }
                    return Promise.resolve(undefined);
                })
            };
            await insertWithRetryAsync(clickHouseClientManager, rows);
            // 1 failed full-size attempt + 2 successful half-size attempts
            expect(clickHouseClientManager.insertAsync).toHaveBeenCalledTimes(3);
            const halfSizes = clickHouseClientManager.insertAsync.mock.calls
                .slice(1)
                .map((call) => call[0].values.length);
            expect(halfSizes.reduce((a, b) => a + b, 0)).toBe(rows.length);
        });

        test('a size error on a batch already at/below MIN_CHUNK_SIZE does not split further (falls through to retry loop)', async () => {
            const rows = new Array(500).fill(0).map((_, i) => ({ i })); // below MIN_CHUNK_SIZE (1000)
            const clickHouseClientManager = {
                insertAsync: jestGlobal.fn().mockRejectedValue(new Error('Invalid string length'))
            };
            await expect(insertWithRetryAsync(clickHouseClientManager, rows)).rejects.toThrow(
                /ClickHouse insert failed after 3 attempts \(batch size 500\)/
            );
            // Never split (all calls kept the full 500-row batch size)
            for (const call of clickHouseClientManager.insertAsync.mock.calls) {
                expect(call[0].values.length).toBe(500);
            }
        });
    });

    describe('processBatchAsync', () => {
        function makeCollection (deletedCount) {
            return { deleteMany: jestGlobal.fn().mockResolvedValue({ deletedCount }) };
        }

        test('happy path: transforms, inserts and deletes all docs (N>1)', async () => {
            const transformer = new AuditEventTransformer();
            const docs = [
                { _id: 'a', _uuid: 'uuid-a', recorded: new Date('2024-01-01T00:00:00Z') },
                { _id: 'b', _uuid: 'uuid-b', recorded: new Date('2024-01-02T00:00:00Z') }
            ];
            const clickHouseClientManager = { insertAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            const collection = makeCollection(2);

            const result = await processBatchAsync({ docs, collection, clickHouseClientManager, transformer });

            expect(result).toEqual({ inserted: 2, deleted: 2 });
            expect(clickHouseClientManager.insertAsync).toHaveBeenCalledTimes(1);
            expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['a', 'b'] } });
        });

        test('empty docs array inserts nothing but still (no-op) deletes the (empty) id set', async () => {
            const transformer = new AuditEventTransformer();
            const clickHouseClientManager = { insertAsync: jestGlobal.fn() };
            const collection = makeCollection(0);

            const result = await processBatchAsync({ docs: [], collection, clickHouseClientManager, transformer });

            expect(result).toEqual({ inserted: 0, deleted: 0 });
            expect(clickHouseClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('does not delete from Mongo when the ClickHouse insert fails (no partial-success delete)', async () => {
            const transformer = new AuditEventTransformer();
            const docs = [{ _id: 'a', _uuid: 'uuid-a', recorded: new Date('2024-01-01T00:00:00Z') }];
            const clickHouseClientManager = {
                insertAsync: jestGlobal.fn().mockRejectedValue(new Error('insert failed'))
            };
            const collection = makeCollection(0);

            await expect(
                processBatchAsync({ docs, collection, clickHouseClientManager, transformer })
            ).rejects.toThrow(/insert failed|ClickHouse insert failed/);
            expect(collection.deleteMany).not.toHaveBeenCalled();
        });

        test('logs a warning but does not throw when Mongo deletes fewer docs than requested', async () => {
            const transformer = new AuditEventTransformer();
            const docs = [{ _id: 'a', _uuid: 'uuid-a', recorded: new Date('2024-01-01T00:00:00Z') }];
            const clickHouseClientManager = { insertAsync: jestGlobal.fn().mockResolvedValue(undefined) };
            const collection = makeCollection(0); // requested 1, deleted 0

            const result = await processBatchAsync({ docs, collection, clickHouseClientManager, transformer });
            expect(result).toEqual({ inserted: 1, deleted: 0 });
        });
    });
});
