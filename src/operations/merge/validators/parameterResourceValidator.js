const { buildOperationOutcomeFromIssues } = require('../../../utils/operationOutcomeBuilder');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');

class ParametersResourceValidator extends BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, incomingResources, base_version, effectiveSmartMerge }) {
        /**
         * @type {MergeResultEntry[]}
         */
        let errors = [];
        // see if the resources were passed as parameters
        if (incomingResources && incomingResources.resourceType === 'Parameters') {
            /**
             * @type {Object}
             */
            const parametersResource = incomingResources;

            if (!parametersResource.parameter || parametersResource.parameter.length === 0) {
                /**
                 * @type {OperationOutcome}
                 */
                const validationOperationOutcome = [
                    buildOperationOutcomeFromIssues([
                        {
                            severity: 'error',
                            code: 'structure',
                            details: {
                                text: 'Invalid parameter list'
                            }
                        }
                    ], 'validationfail')
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
                    buildOperationOutcomeFromIssues([
                        {
                            severity: 'error',
                            code: 'structure',
                            details: {
                                text: 'Invalid parameter list'
                            }
                        }
                    ], 'validationfail')
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
                if (p?.resourceType === 'Parameters') {
                    const operationOutcome = buildOperationOutcomeFromIssues([
                        {
                            severity: 'error',
                            code: 'structure',
                            details: {
                                text: 'Invalid resource type: Parameters'
                            }
                        }
                    ], 'validationfail');
                    errors.push(new MergeResultEntry(
                        {
                            id: p.id,
                            created: false,
                            updated: false,
                            issue: operationOutcome.issue[0],
                            operationOutcome: operationOutcome,
                            resourceType: p.resourceType
                        }
                    ));
                } else if (p) {
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
