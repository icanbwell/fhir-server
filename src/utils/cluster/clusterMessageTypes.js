/**
 * IPC message types exchanged between the cluster primary and its workers when the
 * primary dispatches connections itself (CLUSTER_SCHEDULING=least_busy).
 */
const CLUSTER_MESSAGE_TYPES = Object.freeze({
    /** primary -> worker: carries an accepted, paused socket as the IPC handle */
    CONNECTION: 'fhir:cluster:connection',
    /** worker -> primary: periodic load snapshot */
    LOAD_REPORT: 'fhir:cluster:load-report',
    /** worker -> primary: the worker's HTTP server has stopped taking new connections */
    DRAINING: 'fhir:cluster:draining'
});

module.exports = {
    CLUSTER_MESSAGE_TYPES
};
