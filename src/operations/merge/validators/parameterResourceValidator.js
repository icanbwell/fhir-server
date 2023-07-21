const CodeableConcept = require('../../../fhir/classes/4_0_0/complex_types/codeableConcept');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const Parameters = require('../../../fhir/classes/4_0_0/resources/parameters');

class ParametersResourceValidator {
    /**
     * @param {Object|Object[]} incomingObjects
     * @returns {Promise<{validatedObjects: Resources[]}>}
     */
    async validate({ incomingObjects }) {
        // see if the resources were passed as parameters
        if (incomingObjects.resourceType === 'Parameters') {
            // Unfortunately our FHIR schema resource creator does not support Parameters
            // const ParametersResourceCreator = getResource(base_version, 'Parameters');
            // const parametersResource = new ParametersResourceCreator(resource_incoming);
            /**
             * @type {Object}
             */
            const incomingObject = incomingObjects;
            /**
             * @type {Parameters}
             */
            const parametersResource = new Parameters(incomingObject);
            if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                /**
                 * @type {OperationOutcome}
                 */
                return new OperationOutcome({
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
                });
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
                return new OperationOutcome({
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
                });
            }
            incomingObjects = resourceParameters.map(r => r.resource);
        }

        return {validatedObjects: incomingObjects};
    }
}

module.exports = {
    ParametersResourceValidator
};
