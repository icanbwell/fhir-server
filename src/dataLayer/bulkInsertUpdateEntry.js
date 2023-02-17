/**
 * @desc Type of operation
 * @desc insert = blind insert without checking if id already exists
 * @desc insertUniqueId = insert if id does not exist else merge
 * @desc replace = replace entity with this one and do not merge
 * @desc merge = merge contents of this doc with what the database has
 * @typedef {('insert'|'insertUniqueId'|'replace'|'merge')} OperationType
 **/

class BulkInsertUpdateEntry {
    /**
     * constructor
     * @param {OperationType} operationType
     * @param  {boolean} isCreateOperation
     * @param {boolean} isUpdateOperation
     * @param {string} resourceType
     * @param {string} id
     * @param {Resource} resource
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {MergePatchEntry[]|undefined|null} patches
     * @param {boolean|undefined} [skipped]
     */
    constructor({
                    operationType,
                    isCreateOperation,
                    isUpdateOperation,
                    resourceType,
                    id,
                    resource,
                    operation,
                    patches,
                    skipped
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
         * @type {Resource}
         */
        this.resource = resource;
        /**
         * @type {import('mongodb').AnyBulkWriteOperation}
         */
        this.operation = operation;
        /**
         * @type {MergePatchEntry[]|undefined|null}
         */
        this.patches = patches;
        /**
         * @type {boolean|undefined}
         */
        this.skipped = skipped;
    }
}

module.exports = {
    BulkInsertUpdateEntry
};
