const CodeableConcept = require('../../../fhir/classes/4_0_0/complex_types/codeableConcept');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const Parameters = require('../../../fhir/classes/4_0_0/resources/parameters');
const { BaseValidator } = require('./baseValidator');

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
         * @type {MergeResultEntry[]}
         */
        let errors = [];
        // see if the resources were passed as parameters
        if (incomingResources.resourceType === 'Parameters') {
            // Unfortunately our FHIR schema resource creator does not support Parameters
            // const ParametersResourceCreator = getResource(base_version, 'Parameters');
            // const parametersResource = new ParametersResourceCreator(resource_incoming);
            /**
             * @type {Object}
             */
            const incomingObject = incomingResources;
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
                return { validatedObjects: [], preCheckErrors: [validationOperationOutcome], wasAList: true };
            }
            // find the actual resource in the parameter called resource
            /**
             * @type {ParametersParameter[]}
             */
            const resourceParameters = parametersResource.parameter.filter(p => p.resource);
            if (resourceParameters.length === 0) {
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
                return { validatedObjects: [], preCheckErrors: [validationOperationOutcome], wasAList: true };
            }
            incomingResources = resourceParameters.map(r => r.resource);
        }
        const wasAList = Array.isArray(incomingResources);
        if (wasAList) {
            let resources = [];
            // Filtering out Parameters resources if any present inside 'parameter' field of input Parameter resource
            incomingResources?.forEach(p => {
                if (p.resourceType === 'Parameters') {
                    errors.push(new OperationOutcome({
                        id: 'validationfail',
                        resourceType: 'OperationOutcome',
                        issue: [
                            new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'structure',
                                details: new CodeableConcept({
                                    text: `Parameters resource with id ${p.id} is not allowed`
                                })
                            })
                        ]
                    }));
                } else {
                    resources.push(p);
                }
            });
            incomingResources = resources;
        }

        return { validatedObjects: incomingResources, preCheckErrors: errors, wasAList };
    }
}

module.exports = {
    ParametersResourceValidator
};
