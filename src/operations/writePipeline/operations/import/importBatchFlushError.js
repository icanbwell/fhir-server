/**
 * Thrown by the `$import` batch writer when the flush of a batch throws. It carries the flush's
 * error as `cause` and its message, the batch's entries as the worker would have recorded them had
 * the flush returned (a line that failed a check failed, a queued line created or updated), and
 * the number of distinct resource types of the items that reached the flush, that is the items
 * that did not fail a check (queued or unchanged). The bulk inserter writes the resource types of
 * a flush in parallel, so when more than one type reached it, some of them may be committed
 * although the flush threw; a flush of one type may also have committed part of its writes.
 */
class ImportBatchFlushError extends Error {
    /**
     * @param {Error} error
     * @param {import('../../../common/mergeResultEntry').MergeResultEntry[]} entries
     * @param {number} resourceTypeCount
     */
    constructor ({ error, entries, resourceTypeCount }) {
        super(error.message, { cause: error });
        this.name = 'ImportBatchFlushError';
        /**
         * @type {import('../../../common/mergeResultEntry').MergeResultEntry[]}
         */
        this.entries = entries;
        /**
         * @type {number}
         */
        this.resourceTypeCount = resourceTypeCount;
    }
}

module.exports = {
    ImportBatchFlushError
};
