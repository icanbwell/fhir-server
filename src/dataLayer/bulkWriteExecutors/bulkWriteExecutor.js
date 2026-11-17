'use strict';

/**
 * @typedef {Object} BulkWriteExecutionResult
 * @property {string} resourceType
 * @property {import('mongodb').BulkWriteResult|null} mergeResult - raw driver result, null for non-Mongo executors
 * @property {MergeResultEntry[]|null} mergeResultEntries
 * @property {Error|null} error
 */

/**
 * @classdesc Strategy interface for bulk write execution.
 * Concrete implementations handle writing to specific backends (e.g., MongoDB, ClickHouse).
 */
class BulkWriteExecutor {
    /**
     * Returns whether this executor can handle the given resource type
     * @param {string} resourceType
     * @returns {boolean}
     */
    canHandle (resourceType) {
        throw new Error('must override');
    }

    /**
     * Executes bulk write operations for a resource type
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {BulkInsertUpdateEntry[]} params.operations
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {boolean|null} params.useHistoryCollection
     * @param {boolean} params.maintainOrder
     * @param {boolean} params.isAccessLogOperation
     * @param {Function} params.insertOneHistoryFn
     * @param {boolean} [params.retryOnPoolWaitTimeout] retry a bulk write that hit a Mongo pool checkout timeout (post-request writes only)
     * @returns {Promise<BulkWriteExecutionResult>}
     */
    async executeBulkAsync ({
        resourceType, operations, requestInfo, base_version,
        useHistoryCollection, maintainOrder, isAccessLogOperation,
        retryOnPoolWaitTimeout, insertOneHistoryFn
    }) {
        throw new Error('must override');
    }
}

module.exports = { BulkWriteExecutor };
