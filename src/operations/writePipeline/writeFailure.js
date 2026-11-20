/**
 * Which check or step a failure came from. The pipeline logs it with the failure.
 */
const WRITE_FAILURE_STAGE = Object.freeze({
    STRUCTURE: 'structure',
    SCOPE: 'scope',
    SIZE: 'size',
    IDENTITY: 'identity',
    INCOMING_SCHEMA: 'incomingSchema',
    INCOMING_META: 'incomingMeta',
    ACCESS: 'access',
    BUILD: 'build',
    RESULT_VALIDATION: 'resultValidation',
    ATTACHMENTS: 'attachments',
    WRITE: 'write'
});

/**
 * The failed resource's identity at the moment the failure was recorded.
 * @typedef {Object} WriteFailureSubject
 * @property {string|undefined} id
 * @property {string|undefined} uuid
 * @property {string|undefined} sourceAssigningAuthority
 * @property {string|undefined} resourceType
 */

/**
 * A neutral, frozen record of why one item failed: the stage, the resource's identity at that
 * moment, and either the OperationOutcome of a failed check or an error. The constructor throws
 * unless exactly one of the two is given. The responder turns it into the operation's result or
 * error.
 */
class WriteFailure {
    /**
     * @param {string} stage
     * @param {WriteFailureSubject} subject
     * @param {Object|null} [operationOutcome]
     * @param {Error|null} [error]
     */
    constructor ({ stage, subject, operationOutcome = null, error = null }) {
        if ((operationOutcome === null) === (error === null)) {
            throw new Error('WriteFailure needs exactly one of operationOutcome or error');
        }
        /**
         * @type {string}
         */
        this.stage = stage;
        /**
         * @type {WriteFailureSubject}
         */
        this.subject = Object.freeze({
            id: subject.id,
            uuid: subject.uuid,
            sourceAssigningAuthority: subject.sourceAssigningAuthority,
            resourceType: subject.resourceType
        });
        /**
         * @type {Object|null}
         */
        this.operationOutcome = operationOutcome;
        /**
         * @type {Error|null}
         */
        this.error = error;
        Object.freeze(this);
    }

    /**
     * Returns the subject for a resource: its `id`, `_uuid`, `_sourceAssigningAuthority` and
     * `resourceType`.
     * @param {Object} resource
     * @returns {WriteFailureSubject}
     */
    static subjectOf (resource) {
        return {
            id: resource.id,
            uuid: resource._uuid,
            sourceAssigningAuthority: resource._sourceAssigningAuthority,
            resourceType: resource.resourceType
        };
    }
}

module.exports = {
    WRITE_FAILURE_STAGE,
    WriteFailure
};
