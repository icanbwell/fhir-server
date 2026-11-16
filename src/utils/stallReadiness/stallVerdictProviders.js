'use strict';

const { StallVerdict } = require('./stallReadinessPolicy');
const { STALL_MESSAGE_TYPE } = require('./podStallAggregator');

/**
 * Every provider exposes the same small contract used by the /ready handler:
 *   start(): void   begin any background work (no-op where there is none)
 *   stop(): void    end it
 *   getVerdict(): StallVerdict
 * @typedef {{start: () => void, stop: () => void, getVerdict: () => StallVerdict}} StallVerdictProvider
 */

/**
 * Used when READINESS_STALL_CHECK_ENABLED is off: always ready.
 * @implements {StallVerdictProvider}
 */
class DisabledStallVerdictProvider {
    start () {}

    stop () {}

    getVerdict () {
        return StallVerdict.DISABLED;
    }
}

/**
 * Single-process mode: this process serves every request, so its own tracker is the pod.
 * @implements {StallVerdictProvider}
 */
class LocalStallVerdictProvider {
    /**
     * @param {Object} params
     * @param {import('./requestStallTracker').RequestStallTracker} params.tracker
     * @param {import('./stallReadinessPolicy').StallReadinessPolicy} params.policy
     */
    constructor ({ tracker, policy }) {
        this.tracker = tracker;
        this.policy = policy;
    }

    start () {}

    stop () {}

    getVerdict () {
        return this.policy.evaluate(this.tracker.getSnapshot());
    }
}

/**
 * Cluster worker: reports its snapshot to the primary on a timer and answers /ready
 * with the pod-level verdict the primary sends back. If no verdict has arrived recently
 * (primary not running the aggregator, or IPC delayed), it falls back to its own
 * snapshot so the check still works for this worker.
 * @implements {StallVerdictProvider}
 */
class ClusterWorkerStallVerdictProvider {
    /**
     * @param {Object} params
     * @param {import('./requestStallTracker').RequestStallTracker} params.tracker
     * @param {import('./stallReadinessPolicy').StallReadinessPolicy} params.policy
     * @param {{send?: Function, on: Function, off: Function, connected?: boolean}} params.ipc the worker's process object
     * @param {number} params.reportIntervalMs
     * @param {number} params.verdictStaleAfterMs
     * @param {() => number} [params.now]
     */
    constructor ({ tracker, policy, ipc, reportIntervalMs, verdictStaleAfterMs, now = Date.now }) {
        this.tracker = tracker;
        this.policy = policy;
        this.ipc = ipc;
        this.reportIntervalMs = reportIntervalMs;
        this.verdictStaleAfterMs = verdictStaleAfterMs;
        this.now = now;
        /** @type {StallVerdict|null} */
        this.podVerdict = null;
        this.podVerdictAt = 0;
        this.timer = null;
        this.onMessage = (message) => this.handleMessage(message);
    }

    start () {
        if (this.timer) {
            return;
        }
        this.ipc.on('message', this.onMessage);
        this.timer = setInterval(() => this.report(), this.reportIntervalMs);
        this.timer.unref();
    }

    stop () {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.ipc.off('message', this.onMessage);
    }

    report () {
        if (typeof this.ipc.send !== 'function' || this.ipc.connected === false) {
            return;
        }
        const message = { type: STALL_MESSAGE_TYPE.REPORT, snapshot: { ...this.tracker.getSnapshot() } };
        this.ipc.send(message, () => {});
    }

    /**
     * @param {unknown} message
     */
    handleMessage (message) {
        if (!message || message.type !== STALL_MESSAGE_TYPE.VERDICT) {
            return;
        }
        const verdict = StallVerdict.fromPlain(message.verdict);
        if (verdict) {
            this.podVerdict = verdict;
            this.podVerdictAt = this.now();
        }
    }

    getVerdict () {
        if (this.podVerdict && this.now() - this.podVerdictAt <= this.verdictStaleAfterMs) {
            return this.podVerdict;
        }
        return this.policy.evaluate(this.tracker.getSnapshot());
    }
}

module.exports = {
    DisabledStallVerdictProvider,
    LocalStallVerdictProvider,
    ClusterWorkerStallVerdictProvider
};
