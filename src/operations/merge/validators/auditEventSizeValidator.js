const { BaseValidator } = require('./baseValidator');
const { assertTypeEquals } = require('../../../utils/assertType');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { ConfigManager } = require('../../../utils/configManager');

class AuditEventSizeValidator extends BaseValidator {
    /**
     * Rejects AuditEvent resources whose serialized size exceeds the configured
     * limit. Oversized AuditEvents stall the ClickHouse write path, so we cap
     * inbound docs. Each oversized resource is reported as a per-resource error
     * so it does not fail the rest of the batch.
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     * @param {ConstructorParams}
     */
    constructor ({ configManager }) {
        super();

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ incomingResources }) {
        /**
         * @type {MergeResultEntry[]}
         */
        const preCheckErrors = [];
        const validatedObjects = [];
        const maxSizeInBytes = this.configManager.auditEventMaxSizeBytes;

        for (const resource of incomingResources) {
            if (resource.resourceType !== 'AuditEvent') {
                validatedObjects.push(resource);
                continue;
            }

            const sizeInBytes = Buffer.byteLength(JSON.stringify(resource), 'utf8');
            if (sizeInBytes <= maxSizeInBytes) {
                validatedObjects.push(resource);
                continue;
            }

            const issue = new OperationOutcomeIssue({
                severity: 'error',
                code: 'too-long',
                details: new CodeableConcept({ text: 'Payload size too large.' })
            });
            preCheckErrors.push(new MergeResultEntry({
                id: resource.id,
                resourceType: resource.resourceType,
                uuid: resource._uuid,
                created: false,
                updated: false,
                sourceAssigningAuthority: resource._sourceAssigningAuthority,
                operationOutcome: new OperationOutcome({ resourceType: 'OperationOutcome', issue: [issue] }),
                issue
            }));
        }

        return { validatedObjects, preCheckErrors, wasAList: false };
    }
}

module.exports = {
    AuditEventSizeValidator
};
