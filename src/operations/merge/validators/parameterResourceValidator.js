const CodeableConcept = require('../../../fhir/classes/4_0_0/complex_types/codeableConcept');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const Parameters = require('../../../fhir/classes/4_0_0/resources/parameters');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const ParametersParameter = require('../../../fhir/classes/4_0_0/backbone_elements/parametersParameter');

class ParametersResourceValidator extends BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, currentDate, currentOperationName, incomingResources, base_version }) {
        /**
         * @type {Resource[]}
         */
        let resources = [];
        /**
         * @type {MergeResultEntry[]}
         */
        let errors = [];
        if (!Array.isArray(incomingResources)) {
            incomingResources = [incomingResources];
        }
        for (const /** @type {Resource} */ incomingResource of incomingResources) {
            // see if the resources were passed as parameters
            if (incomingResource.resourceType === 'Parameters') {
                /**
                 * @type {Object}
                 */
                const incomingObject = incomingResource;
                /**
                 * @type {Parameters}
                 */
                const parametersResource = new Parameters(incomingObject);
                if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                    /**
                     * @type {OperationOutcome}
                     */
                    const validationOperationOutcome = [
                        new OperationOutcome({
                            id: 'validationfail',
                            resourceType: 'OperationOutcome',
                            issue: [
                                new OperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'structure',
                                    details: new CodeableConcept({
                                        text: 'Invalid parameter list'
                                    })
                                }
                                )
                            ]
                        })
                    ];
                    errors.push(validationOperationOutcome);
                }
                // find the actual resources in the parameter field
                /**
                 * @type {ParametersParameter[]}
                 */
                const resourceParameters = parametersResource.parameter?.filter(p => p.resource);
                if (resourceParameters?.length === 0) {
                    /**
                     * @type {OperationOutcome}
                     */
                    const validationOperationOutcome = [
                        new OperationOutcome({
                            id: 'validationfail',
                            resourceType: 'OperationOutcome',
                            issue: [
                                new OperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'structure',
                                    details: new CodeableConcept({
                                        text: 'Invalid parameter list'
                                    })
                                })
                            ]
                        })
                    ];
                    errors.push(validationOperationOutcome);
                }
                // Filtering out Parameters resources if any present inside 'parameter' field of input Parameter resource
                resourceParameters?.forEach(p => {
                    if (p.resource.resourceType === 'Parameters') {
                        errors.push(new OperationOutcome({
                            id: 'validationfail',
                            resourceType: 'OperationOutcome',
                            issue: [
                                new OperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'structure',
                                    details: new CodeableConcept({
                                        text: `Parameters resource with id ${p.resource.id} is not allowed`
                                    })
                                })
                            ]
                        }));
                    } else {
                        resources.push(p.resource);
                    }
                });
            } else {
                resources.push(incomingResource);
            }
        }

        return { validatedObjects: resources, preCheckErrors: errors, wasAList: true };
    }
}

module.exports = {
    ParametersResourceValidator
};
