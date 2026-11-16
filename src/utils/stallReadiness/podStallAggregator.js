'use strict';

const { StallSnapshot } = require('./requestStallTracker');

/**
 * IPC message types between cluster workers and the primary.
 * Workers send REPORT with their snapshot; the primary answers every worker with VERDICT.
 */
const STALL_MESSAGE_TYPE = Object.freeze({
    REPORT: 'fhir.readiness.stallReport',
    VERDICT: 'fhir.readiness.stallVerdict'
});

/**
 * Sums the latest snapshot from each worker into one pod-level verdict.
 * Pure state, no cluster or process access, so it can be tested on its own.
 */
class PodStallAggregator {
    /**
     * @param {Object} params
     * @param {import('./stallReadinessPolicy').StallReadinessPolicy} params.policy
     * @param {number} params.staleAfterMs reports older than this are left out of the sum
     * @param {() => number} [params.now]
     */
    constructor ({ policy, staleAfterMs, now = Date.now }) {
        this.policy = policy;
        this.staleAfterMs = staleAfterMs;
        this.now = now;
        /** @type {Map<string, {snapshot: StallSnapshot, reportedAt: number}>} */
        this.reports = new Map();
    }

    /**
     * @param {string} workerId
     * @param {StallSnapshot} snapshot
     */
    recordWorkerReport (workerId, snapshot) {
        this.reports.set(workerId, { snapshot, reportedAt: this.now() });
    }

    /**
     * @param {string} workerId
     */
    removeWorker (workerId) {
        this.reports.delete(workerId);
    }

    /**
     * @returns {import('./stallReadinessPolicy').StallVerdict}
     */
    evaluate () {
        const cutoff = this.now() - this.staleAfterMs;
        let podSnapshot = StallSnapshot.EMPTY;
        for (const [workerId, { snapshot, reportedAt }] of this.reports) {
            if (reportedAt < cutoff) {
                this.reports.delete(workerId);
                continue;
            }
            podSnapshot = podSnapshot.plus(snapshot);
        }
        return this.policy.evaluate(podSnapshot);
    }
}

/**
 * Default primary-side logger. The cluster primary does not initialize winston, so it
 * logs structured JSON to stdout the same way src/index.js does.
 * @param {string} message
 * @param {Object} args
 */
function logToConsole (message, args) {
    console.log(JSON.stringify({ message, ...args }));
}

/**
 * Wires a PodStallAggregator to the cluster primary: collects REPORT messages from
 * workers, forgets workers that exit, and sends the pod-level VERDICT back to every
 * worker after each report, so whichever worker answers /ready gives the pod's answer.
 */
class PrimaryStallCoordinator {
    /**
     * @param {Object} params
     * @param {PodStallAggregator} params.aggregator
     * @param {import('cluster').Cluster} params.cluster
     * @param {(message: string, args: Object) => void} [params.log]
     */
    constructor ({ aggregator, cluster, log = logToConsole }) {
        this.aggregator = aggregator;
        this.cluster = cluster;
        this.log = log;
        this.lastReady = true;
    }

    attach () {
        this.cluster.on('message', (worker, message) => this.handleMessage(worker, message));
        this.cluster.on('exit', (worker) => this.aggregator.removeWorker(String(worker.id)));
    }

    /**
     * @param {import('cluster').Worker} worker
     * @param {unknown} message
     */
    handleMessage (worker, message) {
        if (!message || message.type !== STALL_MESSAGE_TYPE.REPORT) {
            return;
        }
        const snapshot = StallSnapshot.fromPlain(message.snapshot);
        if (!snapshot) {
            return;
        }
        this.aggregator.recordWorkerReport(String(worker.id), snapshot);
        this.broadcast(this.aggregator.evaluate());
    }

    /**
     * @param {import('./stallReadinessPolicy').StallVerdict} verdict
     */
    broadcast (verdict) {
        if (verdict.ready !== this.lastReady) {
            this.log('Pod stall readiness changed', {
                ready: verdict.ready,
                reason: verdict.reason,
                stalledRequests: verdict.stalled,
                totalRequests: verdict.total,
                pid: process.pid
            });
            this.lastReady = verdict.ready;
        }
        const message = { type: STALL_MESSAGE_TYPE.VERDICT, verdict: { ...verdict } };
        for (const worker of Object.values(this.cluster.workers || {})) {
            if (worker && worker.isConnected()) {
                // The callback swallows send errors from a worker that is shutting down;
                // it will be dropped from the aggregate when its exit event arrives.
                worker.send(message, () => {});
            }
        }
    }
}

module.exports = {
    STALL_MESSAGE_TYPE,
    PodStallAggregator,
    PrimaryStallCoordinator
};
