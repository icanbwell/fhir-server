'use strict';

/**
 * Recycles a worker whose MongoDB connection pool is wedged.
 *
 * # Why this exists
 *
 * A worker whose pooled connections are all pinned (for example by cursors that are never
 * closed) cannot recover on its own: every request waits for a checkout that will not come.
 * Once `waitQueueTimeoutMS` is set, each of those waits ends in a `connectionCheckOutFailed`
 * CMAP event with reason `timeout`. When a pool produces enough of them back to back, with no
 * successful checkout in between, the worker shuts down through the normal graceful path and
 * exits non-zero so that a fresh process with a fresh pool replaces it.
 *
 * Without `waitQueueTimeoutMS` the driver waits forever and never emits a timeout, so this
 * tracker never fires.
 *
 * Only the primary request-path pool is tracked (see MongoDatabaseManager.connectAsync). The
 * background pools (audit-event, online-archive, access-logs, resource-history) have their own
 * longer wait-queue timeout, and a saturated background pool must not restart workers.
 *
 * # Who replaces the worker
 *
 * - Cluster mode (WORKER_COUNT > 1): the cluster primary in src/index.js re-forks any worker
 *   that exits while the primary is not itself shutting down. Only the wedged worker restarts;
 *   its siblings keep serving.
 * - Single-process mode (WORKER_COUNT = 1 or unset): there is no primary, so the exit ends the
 *   container's main process and Kubernetes restarts the container (restartPolicy Always). The
 *   pod's restart count goes up, and while the process drains, /ready answers with the
 *   shutdown status so the pod is taken out of the Service endpoints.
 *
 * # Configuration
 *
 * - MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD: consecutive checkout timeouts on one pool that
 *   trigger the exit. Default 5. Set to 0 to disable.
 * - MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS: the consecutive timeouts must all fall within this
 *   many milliseconds. Default 120000 (2 minutes). Must be above 0 when the threshold is.
 * - MONGO_CHECKOUT_TIMEOUT_EXIT_MIN_SPAN_MS: the run must also stretch over at least this many
 *   milliseconds, first timeout to last. Default 60000, or half the window when that is smaller, so a
 *   shorter window alone never fails startup. Size it to at least two of your deployment's
 *   `waitQueueTimeoutMS` (set in the connection options; the driver default is unlimited). Requests
 *   that queued together behind busy but healthy connections all time out within milliseconds of
 *   each other, so a count alone would recycle a worker that is merely saturated. Must be below
 *   the window.
 *
 * Runs are kept per server address: a MongoClient holds one pool per replica-set member and a
 * successful checkout on a healthy secondary must not hide a wedged primary.
 */

const { recordMongoCheckoutTimeoutSelfExit } = require('./metrics');

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_MIN_SPAN_MS = 60 * 1000;
const SELF_EXIT_CODE = 1;
// Bounds memory when timeouts pile up; far above any sensible threshold.
const MAX_RUN_LENGTH = 1000;

/**
 * @typedef {Object} CheckoutTimeoutThresholdDetails
 * @property {string} poolName
 * @property {number} consecutiveTimeouts
 * @property {number} windowMs
 */

const UNKNOWN_ADDRESS = 'unknown';

/**
 * Counts consecutive checkout timeouts per server address and calls `onThresholdReached` once
 * when `threshold` of them land within `windowMs` and span at least `minSpanMs`. A successful
 * checkout resets the run for its own address only.
 */
class MongoCheckoutTimeoutTracker {
    /**
     * @param {Object} params
     * @param {string} params.poolName
     * @param {number} params.threshold Consecutive timeouts that trigger. 0 disables.
     * @param {number} params.windowMs
     * @param {number} [params.minSpanMs] Minimum time from the first to the last timeout of a run.
     * @param {() => number} params.now Clock in milliseconds.
     * @param {(details: CheckoutTimeoutThresholdDetails) => void} params.onThresholdReached
     */
    constructor ({ poolName, threshold, windowMs, minSpanMs = 0, now, onThresholdReached }) {
        this.poolName = poolName;
        this.threshold = threshold;
        this.windowMs = windowMs;
        this.minSpanMs = minSpanMs;
        this.now = now;
        this.onThresholdReached = onThresholdReached;
        /**
         * Timestamps of the current run of timeouts per server address, oldest first. Entries
         * older than the window are dropped, and a run never holds more than MAX_RUN_LENGTH.
         * @type {Map<string, number[]>}
         */
        this.timeoutTimestampsByAddress = new Map();
        this.triggered = false;
    }

    /**
     * @returns {boolean}
     */
    isEnabled () {
        return this.threshold > 0;
    }

    /**
     * Call on `connectionCheckOutFailed` with reason `timeout`.
     * @param {string} [address] Server whose pool timed out (`event.address`).
     */
    recordCheckoutTimeout (address) {
        if (!this.isEnabled() || this.triggered) {
            return;
        }
        // The driver always sets `address` on CMAP pool events; the fallback only keeps a
        // malformed event from throwing in an event handler.
        const key = address ?? UNKNOWN_ADDRESS;
        const now = this.now();
        const run = (this.timeoutTimestampsByAddress.get(key) ?? [])
            .concat(now)
            .filter((timestamp) => now - timestamp <= this.windowMs)
            .slice(-MAX_RUN_LENGTH);
        this.timeoutTimestampsByAddress.set(key, run);
        if (run.length >= this.threshold && now - run[0] >= this.minSpanMs) {
            this.triggered = true;
            this.onThresholdReached({
                poolName: this.poolName,
                consecutiveTimeouts: run.length,
                windowMs: this.windowMs
            });
        }
    }

    /**
     * Call on `connectionCheckedOut`. A server that can hand out a connection is not wedged.
     * @param {string} [address] Server that handed out the connection (`event.address`).
     */
    recordCheckoutSuccess (address) {
        this.timeoutTimestampsByAddress.delete(address ?? UNKNOWN_ADDRESS);
    }
}

/**
 * Parses a non-negative integer env var, failing fast on anything else so a typo cannot
 * silently disable or mis-tune the feature.
 * @param {Object<string, string|undefined>} env
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
function readNonNegativeInteger (env, name, defaultValue) {
    const raw = env[name];
    if (raw === undefined || raw === '') {
        return defaultValue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
    }
    return value;
}

/**
 * @param {Object<string, string|undefined>} env
 * @returns {{threshold: number, windowMs: number, minSpanMs: number}}
 */
function readCheckoutTimeoutExitSettings (env) {
    const threshold = readNonNegativeInteger(env, 'MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD', DEFAULT_THRESHOLD);
    const windowMs = readNonNegativeInteger(env, 'MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS', DEFAULT_WINDOW_MS);
    const minSpanMs = readNonNegativeInteger(
        env,
        'MONGO_CHECKOUT_TIMEOUT_EXIT_MIN_SPAN_MS',
        Math.min(DEFAULT_MIN_SPAN_MS, Math.floor(windowMs / 2))
    );
    // A window of 0 or a span the window cannot hold would quietly leave the feature on but
    // unable to ever fire. Threshold 0 is the documented off switch, so skip the checks then.
    if (threshold > 0) {
        if (windowMs <= 0) {
            throw new Error(
                `MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS must be greater than 0 when ` +
                `MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD is above 0, got "${windowMs}"`
            );
        }
        if (minSpanMs >= windowMs) {
            throw new Error(
                `MONGO_CHECKOUT_TIMEOUT_EXIT_MIN_SPAN_MS (${minSpanMs}) must be less than ` +
                `MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS (${windowMs})`
            );
        }
    }
    return { threshold, windowMs, minSpanMs };
}

/**
 * Builds the exit action for a tracker: log, count, then start the same graceful shutdown a
 * SIGTERM starts (terminus in src/server.js, as src/middleware/errorHandler.js does for an
 * uncaught exception). `process.exitCode` carries the non-zero code to terminus's onShutdown.
 * A timer forces the exit if the drain itself hangs, which it may when Mongo is the problem.
 * Runs at most once per process, however many pools trip.
 *
 * @param {Object} params
 * @param {{pid: number, exitCode: (number|undefined), kill: Function, exit: Function}} params.processRef
 * @param {(message: string, args: Object) => void} params.logError
 * @param {number} params.forceExitAfterMs
 * @param {(fn: Function, ms: number) => {unref?: Function}} params.setTimer
 * @returns {(details: CheckoutTimeoutThresholdDetails) => void}
 */
function createGracefulWorkerExit ({ processRef, logError, forceExitAfterMs, setTimer }) {
    let exiting = false;
    return ({ poolName, consecutiveTimeouts, windowMs }) => {
        if (exiting) {
            return;
        }
        exiting = true;
        logError('Mongo pool checkout timed out repeatedly; exiting worker so it is replaced', {
            method: 'mongoCheckoutTimeoutTracker',
            args: {
                pool: poolName,
                consecutiveTimeouts,
                windowMs,
                pid: processRef.pid,
                exitCode: SELF_EXIT_CODE
            }
        });
        recordMongoCheckoutTimeoutSelfExit(poolName);
        processRef.exitCode = SELF_EXIT_CODE;
        const timer = setTimer(() => processRef.exit(SELF_EXIT_CODE), forceExitAfterMs);
        timer?.unref?.();
        processRef.kill(processRef.pid, 'SIGTERM');
    };
}

module.exports = {
    MongoCheckoutTimeoutTracker,
    readCheckoutTimeoutExitSettings,
    createGracefulWorkerExit,
    DEFAULT_THRESHOLD,
    DEFAULT_WINDOW_MS,
    DEFAULT_MIN_SPAN_MS,
    SELF_EXIT_CODE
};
