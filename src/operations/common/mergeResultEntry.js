class MergeResultEntry {
    /**
     * constructor
     * @param {OperationOutcome|null|undefined} [operationOutcome]
     * @param {OperationOutcomeIssue|null|undefined} [issue]
     * @param {boolean} created
     * @param {string} id
     * @param {string} uuid
     * @param {string} resourceType
     * @param {boolean} updated
     */
    constructor(
        {
            operationOutcome,
            issue,
            created,
            id,
            uuid,
            resourceType,
            updated
        }
    ) {
        /**
         * @type {OperationOutcome|null|undefined}
         */
        this.operationOutcome = operationOutcome;
        /**
         * @type {OperationOutcomeIssue|null|undefined}
         */
        this.issue = issue;
        /**
         * @type {boolean}
         */
        this.created = created;
        /**
         * @type {string}
         */
        this.id = id;
        /**
         * @type {string}
         */
        this.uuid = uuid;
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {boolean}
         */
        this.updated = updated;
    }
}

module.exports = {
    MergeResultEntry
};
