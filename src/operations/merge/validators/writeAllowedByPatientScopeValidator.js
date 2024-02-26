const { BaseValidator } = require('./baseValidator');
const { assertTypeEquals } = require('../../../utils/assertType');
const { PatientScopeManager } = require('../../common/patientScopeManager');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../../fhir/classes/4_0_0/complex_types/codeableConcept');

class WriteAllowedByPatientScopeValidator extends BaseValidator {
    /**
     * Checks whether write is allowed for given resources based on patient scope
     * @param {PatientScopeManager} patientScopeManager
     */
    constructor ({
        patientScopeManager
                }) {
        super();

        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, currentDate, currentOperationName, incomingResources, base_version }) {
        /** @type {MergeResultEntry[]} */
        const preCheckErrors = [];
        if (Array.isArray(incomingResources)) {
            const validIncomingResources = [];
            for (const resource of incomingResources) {
                if (await this.patientScopeManager.canWriteResourceAsync(
                    {
                        base_version,
                        isUser: requestInfo.isUser,
                        personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                        patientIdsFromJwtToken: requestInfo.patientIdsFromJwtToken,
                        resource,
                        scope: requestInfo.scope
                    }
                )) {
                      validIncomingResources.push(resource);
                } else {
                    const operationOutcome = this.createOperationOutcomeForResource({ resource });
                    const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;

                    preCheckErrors.push(new MergeResultEntry({
                        id: resource.id,
                        resourceType: resource.resourceType,
                        uuid: resource._uuid,
                        created: false,
                        updated: false,
                        sourceAssigningAuthority: resource.meta?.sourceAssigningAuthority,
                        operationOutcome,
                        issue
                    }));
                }
            }
            return { validatedObjects: validIncomingResources, preCheckErrors, wasAList: false };
        } else {
            /** @type {Resource} */
            const resource = incomingResources;
            if (await this.patientScopeManager.canWriteResourceAsync(
                {
                    base_version,
                    isUser: requestInfo.isUser,
                    personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                    patientIdsFromJwtToken: requestInfo.patientIdsFromJwtToken,
                    resource,
                    scope: requestInfo.scope
                }
            )) {
                return { validatedObjects: [resource], preCheckErrors, wasAList: false };
            } else {
                const operationOutcome = this.createOperationOutcomeForResource({ resource });
                const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;

                preCheckErrors.push(new MergeResultEntry({
                    id: resource.id,
                    resourceType: resource.resourceType,
                    uuid: resource._uuid,
                    created: false,
                    updated: false,
                    sourceAssigningAuthority: incomingResources.meta?.sourceAssigningAuthority,
                    operationOutcome,
                    issue
                }));
               return { validatedObjects: [], preCheckErrors, wasAList: false };
            }
        }
    }

    /**
     * Creates an OperationOutcome resource to signify that the resource cannot be written
     * @param {Resource} resource
     * @returns {OperationOutcome}
     */
    createOperationOutcomeForResource ({ resource }) {
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
                        text: 'Error merging: ' + JSON.stringify(resource.toJSON())
                    }),
                    diagnostics: 'The current patient scope and person id in the JWT token do not allow writing this resource.',
                    expression: [
                        resource.resourceType
                    ]
                })
            ]
        });
        return operationOutcome;
    }
}

module.exports = {
    WriteAllowedByPatientScopeValidator
};
