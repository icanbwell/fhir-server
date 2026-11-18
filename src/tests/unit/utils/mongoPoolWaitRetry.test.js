const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { MongoBulkWriteError } = require('mongodb');
const { retryOnPoolWaitTimeoutAsync } = require('../../../utils/mongoPoolWaitRetry');

jestGlobal.mock('../../../operations/common/logging', () => ({
    logWarn: jestGlobal.fn()
}));

const TIMEOUT_MESSAGE = 'Timed out while checking out a connection from connection pool: maxPoolSize: 5';
const NOTHING_APPLIED = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };

const waitQueueError = () => {
    const e = new Error(TIMEOUT_MESSAGE);
    e.name = 'MongoWaitQueueTimeoutError';
    return e;
};

/**
 * What collection.bulkWrite actually throws when the pool checkout times out: the driver wraps the
 * original error in a MongoBulkWriteError that keeps only its message.
 */
const driverWrappedTimeout = (result = {}) => new MongoBulkWriteError(
    new Error(TIMEOUT_MESSAGE),
    { ...NOTHING_APPLIED, hasWriteErrors: () => false, ...result }
);

const wrapped = (inner) => Object.assign(new Error('wrapped'), { nested: inner });

describe('retryOnPoolWaitTimeoutAsync', () => {
    const run = (fn, extra = {}) =>
        retryOnPoolWaitTimeoutAsync({ fn, description: 'test', maxAttempts: 3, baseDelayMs: 1, ...extra });

    test('returns the result on the first call when it succeeds', async () => {
        const fn = jestGlobal.fn().mockResolvedValue('ok');

        await expect(run(fn)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['the pool wait timeout error', waitQueueError, true],
        ['the timeout error wrapped in another error', () => wrapped(waitQueueError()), true],
        ['the bulk write error the driver throws, nothing written', () => driverWrappedTimeout(), true],
        ['a bulk write error after an earlier batch was written', () => driverWrappedTimeout({ insertedCount: 100 }), false],
        ['a bulk write error after an earlier batch had write errors', () => driverWrappedTimeout({ hasWriteErrors: () => true }), false],
        ['a bulk write error for another reason', () => new MongoBulkWriteError(new Error('E11000 duplicate key'), { ...NOTHING_APPLIED }), false],
        ['an unrelated error', () => new Error('boom'), false]
    ])('on %s: calls again = %s', async (_label, makeError, expectedRetry) => {
        const fn = jestGlobal.fn().mockRejectedValueOnce(makeError()).mockResolvedValue('ok');

        const outcome = run(fn);

        if (expectedRetry) {
            await expect(outcome).resolves.toBe('ok');
        } else {
            await expect(outcome).rejects.toThrow();
        }
        expect(fn).toHaveBeenCalledTimes(expectedRetry ? 2 : 1);
    });

    test('throws the timeout error after maxAttempts', async () => {
        const fn = jestGlobal.fn().mockRejectedValue(waitQueueError());

        await expect(run(fn)).rejects.toThrow('checking out a connection');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('stops retrying once the elapsed budget is used up', async () => {
        const fn = jestGlobal.fn().mockRejectedValue(waitQueueError());

        await expect(run(fn, { maxElapsedMs: 0 })).rejects.toThrow('checking out a connection');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
