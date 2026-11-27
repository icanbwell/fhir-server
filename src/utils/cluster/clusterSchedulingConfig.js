const CLUSTER_SCHEDULING_POLICIES = Object.freeze({
    /** Node's built-in scheduler: the primary hands connections to workers in turn */
    ROUND_ROBIN: 'round_robin',
    /** The primary hands each connection to the worker with the lowest reported load */
    LEAST_BUSY: 'least_busy'
});

const DEFAULT_REPORT_INTERVAL_MS = 25;
const DEFAULT_BLOCKED_MS_PER_REQUEST = 10;

/**
 * @typedef {Object} ClusterSchedulingConfig
 * @property {string} policy one of CLUSTER_SCHEDULING_POLICIES
 * @property {number} reportIntervalMs how often each worker reports its load to the primary; a
 *  report that is late tells the primary the worker's event loop is blocked
 * @property {number} blockedMsPerRequest milliseconds a worker's report is overdue that count as
 *  one in-flight request when scoring it
 */

/**
 * @param {string|undefined} raw
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
function readPositiveInteger(raw, name, defaultValue) {
    if (raw === undefined || raw === '') {
        return defaultValue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer, got "${raw}"`);
    }
    return value;
}

/**
 * Reads and validates the cluster scheduling settings. Throws on invalid values so a typo
 * fails startup instead of silently falling back to another scheduler.
 * @param {Record<string, string|undefined>} env
 * @returns {ClusterSchedulingConfig}
 */
function readClusterSchedulingConfig(env) {
    const policy = env.CLUSTER_SCHEDULING || CLUSTER_SCHEDULING_POLICIES.ROUND_ROBIN;
    if (!Object.values(CLUSTER_SCHEDULING_POLICIES).includes(policy)) {
        throw new Error(
            `CLUSTER_SCHEDULING must be one of ${Object.values(CLUSTER_SCHEDULING_POLICIES).join(', ')}, got "${policy}"`
        );
    }
    return Object.freeze({
        policy,
        reportIntervalMs: readPositiveInteger(
            env.CLUSTER_LOAD_REPORT_INTERVAL_MS,
            'CLUSTER_LOAD_REPORT_INTERVAL_MS',
            DEFAULT_REPORT_INTERVAL_MS
        ),
        blockedMsPerRequest: readPositiveInteger(
            env.CLUSTER_BLOCKED_MS_PER_REQUEST,
            'CLUSTER_BLOCKED_MS_PER_REQUEST',
            DEFAULT_BLOCKED_MS_PER_REQUEST
        )
    });
}

module.exports = {
    CLUSTER_SCHEDULING_POLICIES,
    readClusterSchedulingConfig
};
