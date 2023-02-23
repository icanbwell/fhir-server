class BulkResultEntry {
    /**
     * constructor
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteResult|null} mergeResult
     * @param {MergeResultEntry[]|null} mergeResultEntries
     * @param {Error|null} error
     */
    constructor(
        {
            resourceType,
            mergeResult,
            mergeResultEntries,
            error
        }
    ) {
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {import('mongodb').BulkWriteResult|null}
         */
        this.mergeResult = mergeResult;
        /**
         * @type {MergeResultEntry[]|null}
         */
        this.mergeResultEntries = mergeResultEntries;
        /**
         * @type {Error|null}
         */
        this.error = error;
    }
}

module.exports = {
    BulkResultEntry
};
