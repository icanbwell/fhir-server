/**
 * Constants shared by the cluster primary and its workers when the primary dispatches
 * connections itself (CLUSTER_SCHEDULING=least_busy).
 */

/**
 * IPC message types exchanged between the primary and its workers.
 */
const CLUSTER_MESSAGE_TYPES = Object.freeze({
    /** primary -> worker: carries an accepted, paused socket as the IPC handle */
    CONNECTION: 'fhir:cluster:connection',
    /** worker -> primary: periodic load snapshot */
    LOAD_REPORT: 'fhir:cluster:load-report',
    /** worker -> primary: the worker's HTTP server has stopped taking new connections */
    DRAINING: 'fhir:cluster:draining'
});

/**
 * Why the primary closed a connection instead of handing it to a worker. Also the label
 * vocabulary of fhir_cluster_connections_dropped_total.
 */
const CLUSTER_CONNECTION_DROP_REASON = Object.freeze({
    /** every worker is starting, draining or gone */
    NO_WORKER: 'no_worker',
    /** the IPC hand-off to the chosen worker failed */
    SEND_FAILED: 'send_failed',
    /** the worker exited before taking a connection already sent to it */
    WORKER_EXITED: 'worker_exited'
});

/** Node's error code when sending on an IPC channel that has already closed */
const IPC_CHANNEL_CLOSED_ERROR_CODE = 'ERR_IPC_CHANNEL_CLOSED';

/**
 * @typedef {Object} ClusterConnectionMessage
 * @property {typeof CLUSTER_MESSAGE_TYPES.CONNECTION} type
 */

/**
 * @typedef {Object} ClusterLoadReportMessage
 * @property {typeof CLUSTER_MESSAGE_TYPES.LOAD_REPORT} type
 * @property {number} inFlight requests the worker is currently handling
 * @property {number} connectionsReceived connections the worker has taken over since it started
 */

/**
 * @typedef {Object} ClusterDrainingMessage
 * @property {typeof CLUSTER_MESSAGE_TYPES.DRAINING} type
 */

/**
 * @typedef {ClusterConnectionMessage|ClusterLoadReportMessage|ClusterDrainingMessage} ClusterMessage
 */

module.exports = {
    CLUSTER_MESSAGE_TYPES,
    CLUSTER_CONNECTION_DROP_REASON,
    IPC_CHANNEL_CLOSED_ERROR_CODE
};
