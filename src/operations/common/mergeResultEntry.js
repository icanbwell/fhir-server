const {ResourceComparer} = require('../../fhir/resourceComparer');

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
     * @param {string} sourceAssigningAuthority
     */
    constructor(
        {
            operationOutcome,
            issue,
            created,
            id,
            uuid,
            resourceType,
            updated,
            sourceAssigningAuthority
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
        this._uuid = uuid;
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {boolean}
         */
        this.updated = updated;
        /**
         * @type {string}
         */
        this._sourceAssigningAuthority = sourceAssigningAuthority;
    }

    /**
     * Returns whether two resources are same
     * @param {Resource} other
     * @return {boolean}
     */
    isSameResourceByIdAndSecurityTag({other}) {
        return ResourceComparer.isSameResourceByIdAndSecurityTag(
            {
                first: this,
                second: other
            }
        );
    }
}

module.exports = {
    MergeResultEntry
};
