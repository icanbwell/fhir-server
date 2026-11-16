'use strict';

const VERDICT_REASON = Object.freeze({
    DISABLED: 'disabled',
    BELOW_MIN_SAMPLES: 'below_min_samples',
    WITHIN_THRESHOLD: 'within_threshold',
    STALLED_SHARE_EXCEEDED: 'stalled_share_exceeded'
});

/**
 * Readiness answer from the stall check, plus the counts it was based on.
 */
class StallVerdict {
    /**
     * @param {Object} params
     * @param {boolean} params.ready
     * @param {string} params.reason one of VERDICT_REASON
     * @param {number} params.total
     * @param {number} params.stalled
     */
    constructor ({ ready, reason, total, stalled }) {
        this.ready = ready;
        this.reason = reason;
        this.total = total;
        this.stalled = stalled;
        Object.freeze(this);
    }

    /**
     * Rebuilds a verdict from an IPC payload, rejecting anything malformed.
     * Unknown reasons are kept as-is so a newer primary can add one.
     * @param {unknown} value
     * @returns {StallVerdict|null}
     */
    static fromPlain (value) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const { ready, reason, total, stalled } = /** @type {Record<string, unknown>} */ (value);
        if (typeof ready !== 'boolean' || typeof reason !== 'string' ||
            !Number.isInteger(total) || !Number.isInteger(stalled)) {
            return null;
        }
        return new StallVerdict({ ready, reason, total, stalled });
    }
}

StallVerdict.DISABLED = new StallVerdict({ ready: true, reason: VERDICT_REASON.DISABLED, total: 0, stalled: 0 });

/**
 * Decides readiness from a pod-level snapshot.
 *
 * The signal is the share of this pod's recent requests that stalled, not latency.
 * That keeps a fleet-wide slowdown from pulling every pod: a slowdown that keeps
 * requests under the stall threshold never trips it, and the min sample size keeps a
 * quiet pod with a few slow requests Ready.
 */
class StallReadinessPolicy {
    /**
     * @param {Object} params
     * @param {number} params.maxStalledRatio
     * @param {number} params.minSamples
     */
    constructor ({ maxStalledRatio, minSamples }) {
        this.maxStalledRatio = maxStalledRatio;
        this.minSamples = minSamples;
    }

    /**
     * @param {import('./requestStallTracker').StallSnapshot} snapshot
     * @returns {StallVerdict}
     */
    evaluate (snapshot) {
        const { total, stalled } = snapshot;
        if (total < this.minSamples) {
            return new StallVerdict({ ready: true, reason: VERDICT_REASON.BELOW_MIN_SAMPLES, total, stalled });
        }
        if (stalled / total > this.maxStalledRatio) {
            return new StallVerdict({ ready: false, reason: VERDICT_REASON.STALLED_SHARE_EXCEEDED, total, stalled });
        }
        return new StallVerdict({ ready: true, reason: VERDICT_REASON.WITHIN_THRESHOLD, total, stalled });
    }
}

module.exports = {
    StallReadinessPolicy,
    StallVerdict,
    VERDICT_REASON
};
