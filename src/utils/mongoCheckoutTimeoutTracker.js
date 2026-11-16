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
 *   many milliseconds. Default 120000 (2 minutes).
 */

const { recordMongoCheckoutTimeoutSelfExit } = require('./metrics');

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 2 * 60 * 1000;
const SELF_EXIT_CODE = 1;

/**
 * @typedef {Object} CheckoutTimeoutThresholdDetails
 * @property {string} poolName
 * @property {number} consecutiveTimeouts
 * @property {number} windowMs
 */

/**
 * Counts consecutive checkout timeouts on one pool and calls `onThresholdReached` once when
 * `threshold` of them land within `windowMs`. Any successful checkout resets the count.
 */
class MongoCheckoutTimeoutTracker {
    /**
     * @param {Object} params
     * @param {string} params.poolName
     * @param {number} params.threshold Consecutive timeouts that trigger. 0 disables.
     * @param {number} params.windowMs
     * @param {() => number} params.now Clock in milliseconds.
     * @param {(details: CheckoutTimeoutThresholdDetails) => void} params.onThresholdReached
     */
    constructor ({ poolName, threshold, windowMs, now, onThresholdReached }) {
        this.poolName = poolName;
        this.threshold = threshold;
        this.windowMs = windowMs;
        this.now = now;
        this.onThresholdReached = onThresholdReached;
        /**
         * Timestamps of the current run of timeouts, oldest first. Never longer than threshold.
         * @type {number[]}
         */
        this.timeoutTimestamps = [];
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
     */
    recordCheckoutTimeout () {
        if (!this.isEnabled() || this.triggered) {
            return;
        }
        const now = this.now();
        this.timeoutTimestamps.push(now);
        this.timeoutTimestamps = this.timeoutTimestamps
            .filter((timestamp) => now - timestamp <= this.windowMs)
            .slice(-this.threshold);
        if (this.timeoutTimestamps.length >= this.threshold) {
            this.triggered = true;
            this.onThresholdReached({
                poolName: this.poolName,
                consecutiveTimeouts: this.timeoutTimestamps.length,
                windowMs: this.windowMs
            });
        }
    }

    /**
     * Call on `connectionCheckedOut`. A pool that can hand out a connection is not wedged.
     */
    recordCheckoutSuccess () {
        this.timeoutTimestamps = [];
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
 * @returns {{threshold: number, windowMs: number}}
 */
function readCheckoutTimeoutExitSettings (env) {
    return {
        threshold: readNonNegativeInteger(env, 'MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD', DEFAULT_THRESHOLD),
        windowMs: readNonNegativeInteger(env, 'MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS', DEFAULT_WINDOW_MS)
    };
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
    SELF_EXIT_CODE
};
