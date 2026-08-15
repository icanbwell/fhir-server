const { removeNull } = require('../../utils/nullRemover');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const Extension = require('../../fhir/classes/4_0_0/complex_types/extension');

// Byte offset rather than a decimal line number: bulk import splits large files into
// byte ranges processed independently, and a within-range line counter resets to 1 for
// every range, so it can't identify a line's true position in the original file. An
// absolute byte offset is unambiguous no matter how the file was split.
const SOURCE_BYTE_OFFSET_EXTENSION_URL = 'https://www.icanbwell.com/source-byte-offset';

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
    constructor (
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

    toJSON () {
        return removeNull(
            {
                operationOutcome: this.operationOutcome,
                issue: this.issue,
                created: this.created,
                id: this.id,
                uuid: this._uuid,
                resourceType: this.resourceType,
                updated: this.updated,
                sourceAssigningAuthority: this._sourceAssigningAuthority
            }
        );
    }

    /**
     * Creates a MergeResultEntry from an error
     * @param {Error} error
     * @param {Resource} resource
     * @param {number|undefined} [sourceByteOffset] - absolute byte offset of the source NDJSON
     *   line in its original file, e.g. for bulk import errors
     * @return {MergeResultEntry}
     */
    static createFromError ({ error, resource, sourceByteOffset }) {
        /**
         * @type {OperationOutcome}
         */
        const operationOutcome = new OperationOutcome({
            resourceType: 'OperationOutcome',
            issue: [
                new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'exception',
                    details: new CodeableConcept({
                        text: error.message
                    }),
                    diagnostics: error.message,
                    expression: [
                        resource.resourceType
                    ],
                    extension: sourceByteOffset === undefined
                        ? undefined
                        : [
                            new Extension({
                                url: SOURCE_BYTE_OFFSET_EXTENSION_URL,
                                valueInteger: sourceByteOffset
                            })
                        ]
                })
            ]
        });
        const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;
        const mergeResultEntry = new MergeResultEntry(
            {
                id: resource.id,
                uuid: resource._uuid,
                sourceAssigningAuthority: resource._sourceAssigningAuthority,
                created: false,
                updated: false,
                issue,
                operationOutcome,
                resourceType: resource.resourceType
            }
        );
        return mergeResultEntry;
    }
}

module.exports = {
    MergeResultEntry
};
