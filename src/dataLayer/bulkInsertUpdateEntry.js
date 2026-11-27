/**
 * @desc Type of operation
 * @desc insert = blind insert without checking if id already exists
 * @desc insertUniqueId = insert if id does not exist else merge
 * @desc replace = replace entity with this one and do not merge
 * @desc merge = merge contents of this doc with what the database has
 * @typedef {('insert'|'insertUniqueId'|'replace'|'merge')} OperationType
 **/

/**
 * @typedef {Object} WritePrecondition
 * @property {string[]} [ifMatchVersionIds] - normalized If-Match version ids the live doc must match
 * @property {boolean} [rejectIfExists] - If-None-Match: * -- fail instead of folding a lost insert race into an update
 **/

class BulkInsertUpdateEntry {
    /**
     * constructor
     * @param {OperationType} operationType
     * @param  {boolean} isCreateOperation
     * @param {boolean} isUpdateOperation
     * @param {string} resourceType
     * @param {string} id
     * @param {string} uuid
     * @param {Resource} resource
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {boolean|undefined} [skipped]
     * @param {string} sourceAssigningAuthority
     * @param {Object|null} [contextData] - Optional context data for resource-specific handling (e.g., Group members)
     * @param {WritePrecondition|null} [writePrecondition]
     */
    constructor ({
                    operationType,
                    isCreateOperation,
                    isUpdateOperation,
                    resourceType,
                    id,
                    uuid,
                    resource,
                    operation,
                    skipped,
                    sourceAssigningAuthority,
                    contextData = null,
                    writePrecondition = null,
                    smartMerge = true
                }
    ) {
        /**
         * @type {OperationType}
         */
        this.operationType = operationType;
        /**
         * @type {boolean}
         */
        this.isCreateOperation = isCreateOperation;
        /**
         * @type {boolean}
         */
        this.isUpdateOperation = isUpdateOperation;
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this.id = id;
        /**
         * @type {string}
         */
        this.sourceAssigningAuthority = sourceAssigningAuthority;
        /**
         * @type {string}
         */
        this.uuid = uuid;
        /**
         * @type {Resource}
         */
        this.resource = resource;
        /**
         * @type {import('mongodb').AnyBulkWriteOperation}
         */
        this.operation = operation;
        /**
         * @type {boolean|undefined}
         */
        this.skipped = skipped;
        /**
         * @type {Object|null}
         */
        this.contextData = contextData;
        /**
         * @type {WritePrecondition|null}
         */
        this.writePrecondition = writePrecondition;
        this.smartMerge = smartMerge;
        /**
         * The document the one-by-one replay of a lost versioned write saved, which differs from
         * `resource` as queued (a later `versionId`, merged with what the competing write stored),
         * or null when the bulk write succeeded or no replay saved a document.
         * @type {Resource|null}
         */
        this.replayedResource = null;
    }
}

module.exports = {
    BulkInsertUpdateEntry
};
