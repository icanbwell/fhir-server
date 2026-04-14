'use strict';

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
     * @returns {Promise<BulkResultEntry>}
     */
    async executeBulkAsync ({
        resourceType, operations, requestInfo, base_version,
        useHistoryCollection, maintainOrder, isAccessLogOperation,
        insertOneHistoryFn
    }) {
        throw new Error('must override');
    }
}

module.exports = { BulkWriteExecutor };
