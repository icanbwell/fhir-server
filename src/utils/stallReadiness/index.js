'use strict';

/**
 * Readiness check that fails when a share of the pod's recent requests are stalled.
 * See docs/adr/0005-pod-level-stall-readiness-over-cluster-ipc.md.
 */

const { StallReadinessConfig, STALL_READINESS_DEFAULTS } = require('./stallReadinessConfig');
const { StallSnapshot, RequestStallTracker, NoopRequestStallTracker } = require('./requestStallTracker');
const { StallReadinessPolicy, StallVerdict, VERDICT_REASON } = require('./stallReadinessPolicy');
const { STALL_MESSAGE_TYPE, PodStallAggregator, PrimaryStallCoordinator } = require('./podStallAggregator');
const {
    DisabledStallVerdictProvider,
    LocalStallVerdictProvider,
    ClusterWorkerStallVerdictProvider
} = require('./stallVerdictProviders');

/**
 * @param {StallReadinessConfig} config
 * @returns {RequestStallTracker|NoopRequestStallTracker}
 */
function createRequestStallTracker (config) {
    if (!config.enabled) {
        return new NoopRequestStallTracker();
    }
    return new RequestStallTracker({ windowMs: config.windowMs, stallThresholdMs: config.stallThresholdMs });
}

/**
 * Picks the verdict provider for this process.
 * @param {Object} params
 * @param {StallReadinessConfig} params.config
 * @param {RequestStallTracker|NoopRequestStallTracker} params.tracker
 * @param {boolean} params.isClusterWorker true when forked by the cluster primary
 * @param {Object} params.ipc the process object used for cluster IPC
 * @returns {import('./stallVerdictProviders').StallVerdictProvider}
 */
function createStallVerdictProvider ({ config, tracker, isClusterWorker, ipc }) {
    if (!config.enabled) {
        return new DisabledStallVerdictProvider();
    }
    const policy = new StallReadinessPolicy({ maxStalledRatio: config.maxStalledRatio, minSamples: config.minSamples });
    if (!isClusterWorker) {
        return new LocalStallVerdictProvider({ tracker, policy });
    }
    return new ClusterWorkerStallVerdictProvider({
        tracker,
        policy,
        ipc,
        reportIntervalMs: config.reportIntervalMs,
        verdictStaleAfterMs: config.staleAfterMs
    });
}

/**
 * Starts pod-level aggregation in the cluster primary. Does nothing when disabled.
 * @param {Object} params
 * @param {StallReadinessConfig} params.config
 * @param {import('cluster').Cluster} params.cluster
 * @returns {PrimaryStallCoordinator|null}
 */
function attachPrimaryStallAggregator ({ config, cluster }) {
    if (!config.enabled) {
        return null;
    }
    const policy = new StallReadinessPolicy({ maxStalledRatio: config.maxStalledRatio, minSamples: config.minSamples });
    const aggregator = new PodStallAggregator({ policy, staleAfterMs: config.staleAfterMs });
    const coordinator = new PrimaryStallCoordinator({ aggregator, cluster });
    coordinator.attach();
    return coordinator;
}

module.exports = {
    StallReadinessConfig,
    STALL_READINESS_DEFAULTS,
    StallSnapshot,
    RequestStallTracker,
    NoopRequestStallTracker,
    StallReadinessPolicy,
    StallVerdict,
    VERDICT_REASON,
    STALL_MESSAGE_TYPE,
    PodStallAggregator,
    PrimaryStallCoordinator,
    DisabledStallVerdictProvider,
    LocalStallVerdictProvider,
    ClusterWorkerStallVerdictProvider,
    createRequestStallTracker,
    createStallVerdictProvider,
    attachPrimaryStallAggregator
};
