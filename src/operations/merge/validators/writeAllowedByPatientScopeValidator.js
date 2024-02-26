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
                                diagnostics: 'resource is missing id',
                                expression: [
                                    resource.resourceType
                                ]
                            })
                        ]
                    });
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
            if (await this.patientScopeManager.canWriteResourceAsync(
                {
                    base_version,
                    isUser: requestInfo.isUser,
                    personIdFromJwtToken: requestInfo.personIdFromJwtToken,
                    patientIdsFromJwtToken: requestInfo.patientIdsFromJwtToken,
                    resource: incomingResources,
                    scope: requestInfo.scope
                }
            )) {
                return { validatedObjects: [incomingResources], preCheckErrors, wasAList: false };
            } else {
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
                                text: 'Error merging: ' + JSON.stringify(incomingResources.toJSON())
                            }),
                            diagnostics: 'resource is missing id',
                            expression: [
                                incomingResources.resourceType
                            ]
                        })
                    ]
                });
                const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;

                preCheckErrors.push(new MergeResultEntry({
                    id: incomingResources.id,
                    resourceType: incomingResources.resourceType,
                    uuid: incomingResources._uuid,
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
}

module.exports = {
    WriteAllowedByPatientScopeValidator
};
