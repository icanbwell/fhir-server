'use strict';

const { isTrue } = require('../isTrue');

/**
 * Defaults for the stall readiness check. The check itself is off unless
 * READINESS_STALL_CHECK_ENABLED is true, so these only apply once Helm turns it on.
 *
 * Why these numbers:
 * - stallThresholdMs (30s): normal FHIR requests finish in well under a second and the
 *   router gives up at 120s. A request still running at 30s is stuck, not slow.
 * - windowMs (2 min): long enough to cover several probe periods, short enough that a
 *   recovered pod returns to Ready within a couple of minutes.
 * - maxStalledRatio (0.2): the pod fails readiness only when more than 20% of its recent
 *   requests are stalled. With N workers sharing traffic evenly and one of them hanging
 *   every request until the 120s router timeout, each hung request is counted twice over
 *   its life in the window (in flight, then completed), so the steady-state share is
 *   (210 / 120) / (N + 1): about 25% with 6 workers, 19% with 8. Lower the ratio when
 *   running more than 6 workers.
 * - minSamples (20): below this many recent requests the share is noise, so the pod stays
 *   Ready. A quiet pod with two slow requests out of three must not be pulled.
 * - reportIntervalMs (5s): how often each worker sends its snapshot to the cluster primary.
 */
const DEFAULTS = Object.freeze({
    enabled: false,
    stallThresholdMs: 30_000,
    windowMs: 120_000,
    maxStalledRatio: 0.2,
    minSamples: 20,
    reportIntervalMs: 5_000
});

/**
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveNumberOr (value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Immutable settings for the stall readiness check.
 */
class StallReadinessConfig {
    /**
     * @param {Object} params
     * @param {boolean} params.enabled
     * @param {number} params.stallThresholdMs a request running longer than this counts as stalled
     * @param {number} params.windowMs how far back completed requests are counted
     * @param {number} params.maxStalledRatio readiness fails when stalled / total exceeds this (0..1)
     * @param {number} params.minSamples readiness never fails with fewer requests than this in the window
     * @param {number} params.reportIntervalMs how often a cluster worker reports to the primary
     */
    constructor ({ enabled, stallThresholdMs, windowMs, maxStalledRatio, minSamples, reportIntervalMs }) {
        this.enabled = enabled;
        this.stallThresholdMs = stallThresholdMs;
        this.windowMs = windowMs;
        this.maxStalledRatio = maxStalledRatio;
        this.minSamples = minSamples;
        this.reportIntervalMs = reportIntervalMs;
        Object.freeze(this);
    }

    /**
     * Report or verdict older than this is ignored: three missed reports in a row.
     * @returns {number}
     */
    get staleAfterMs () {
        return this.reportIntervalMs * 3;
    }

    /**
     * @param {Object<string, string|undefined>} env
     * @returns {StallReadinessConfig}
     */
    static fromEnv (env) {
        const ratio = positiveNumberOr(env.READINESS_STALL_MAX_RATIO, DEFAULTS.maxStalledRatio);
        return new StallReadinessConfig({
            enabled: isTrue(env.READINESS_STALL_CHECK_ENABLED),
            stallThresholdMs: positiveNumberOr(env.READINESS_STALL_THRESHOLD_MS, DEFAULTS.stallThresholdMs),
            windowMs: positiveNumberOr(env.READINESS_STALL_WINDOW_MS, DEFAULTS.windowMs),
            maxStalledRatio: ratio < 1 ? ratio : DEFAULTS.maxStalledRatio,
            minSamples: positiveNumberOr(env.READINESS_STALL_MIN_SAMPLES, DEFAULTS.minSamples),
            reportIntervalMs: positiveNumberOr(env.READINESS_STALL_REPORT_INTERVAL_MS, DEFAULTS.reportIntervalMs)
        });
    }
}

module.exports = {
    StallReadinessConfig,
    STALL_READINESS_DEFAULTS: DEFAULTS
};
