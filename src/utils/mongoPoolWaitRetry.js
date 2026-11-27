const { logWarn } = require('../operations/common/logging');
const { retryWithBackoff } = require('./retryWithBackoff');

const WAIT_QUEUE_TIMEOUT_ERROR_NAME = 'MongoWaitQueueTimeoutError';
const MAX_ERROR_CAUSE_DEPTH = 5;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
// each attempt can itself wait the pool's wait-queue timeout (60s on background pools), so
// stop retrying once this much time has gone by instead of relying on the attempt count alone
const DEFAULT_MAX_ELAPSED_MS = 90 * 1000;

const POOL_CHECKOUT_TIMEOUT_MESSAGE = 'Timed out while checking out a connection from connection pool';
const BULK_WRITE_ERROR_NAME = 'MongoBulkWriteError';
const APPLIED_COUNT_KEYS = ['insertedCount', 'matchedCount', 'modifiedCount', 'deletedCount', 'upsertedCount'];

/**
 * collection.bulkWrite does not throw the checkout error as it is: the driver wraps any
 * non-write error in a MongoBulkWriteError that keeps only the message, and drops the original
 * error. Matches that wrapper, and only when its result shows no operation was applied, because
 * a checkout that timed out on a later batch leaves earlier batches committed and replaying
 * them would fail on duplicate keys.
 * @param {Error} error
 * @returns {boolean}
 */
const isUnappliedBulkCheckoutTimeout = (error) => {
    if (error.name !== BULK_WRITE_ERROR_NAME || !String(error.message).startsWith(POOL_CHECKOUT_TIMEOUT_MESSAGE)) {
        return false;
    }
    const result = error.result;
    const nothingWritten = !result || APPLIED_COUNT_KEYS.every((key) => !result[key]);
    // an earlier batch can fail with write errors (zero counts) and still have been sent
    const hadWriteErrors = Boolean(result?.hasWriteErrors?.());
    return nothingWritten && !hadWriteErrors;
};

/**
 * True when the error, or an error it wraps, is a pool checkout timeout that is safe to retry:
 * the driver raises it before it sends a command on a connection, so the call that hit it did
 * not run.
 * @param {Error|undefined} error
 * @returns {boolean}
 */
const isPoolWaitTimeoutError = (error) => {
    let current = error;
    for (let depth = 0; current && depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
        if (current.name === WAIT_QUEUE_TIMEOUT_ERROR_NAME || isUnappliedBulkCheckoutTimeout(current)) {
            return true;
        }
        current = current.nested || current.original_error || current.cause;
    }
    return false;
};

/**
 * Runs one driver call again only when it failed because no pooled connection became free in
 * time. Use it around a single call, never around a multi-step task: steps that already
 * succeeded would run twice. A call the driver splits into batches is retried only if nothing
 * was written yet. Any other error is thrown at once; after the last attempt the timeout error
 * is thrown to the caller. Delays and attempts come from retryWithBackoff.
 * @template T
 * @param {Object} params
 * @param {function(): Promise<T>} params.fn the single driver call
 * @param {string} params.description used in the log line
 * @param {string} [params.requestId] correlates the log line with the request
 * @param {number} [params.maxAttempts] total attempts
 * @param {number} [params.baseDelayMs] base of the exponential backoff
 * @param {number} [params.maxElapsedMs] no new attempt starts once this much time has passed
 * @returns {Promise<T>}
 */
const retryOnPoolWaitTimeoutAsync = ({
    fn,
    description,
    requestId,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxElapsedMs = DEFAULT_MAX_ELAPSED_MS
}) => {
    const startedAt = Date.now();
    return retryWithBackoff({
        fn,
        maxRetries: maxAttempts - 1,
        initialDelayMs: baseDelayMs,
        jitter: true,
        shouldRetry: (error) => isPoolWaitTimeoutError(error) && Date.now() - startedAt < maxElapsedMs,
        onRetry: ({ attempt, delay }) => logWarn('Retrying after Mongo pool wait timeout', {
            description,
            requestId,
            attempt,
            maxAttempts,
            delayMs: delay
        })
    });
};

module.exports = { retryOnPoolWaitTimeoutAsync, isPoolWaitTimeoutError };
