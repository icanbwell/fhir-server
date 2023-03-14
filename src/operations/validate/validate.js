const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {getFirstElementOrNull} = require('../../utils/list.util');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const {ResourceValidator} = require('../common/resourceValidator');
const moment = require('moment-timezone');
const {ParsedArgs} = require('../query/parsedArgs');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');

class ValidateOperation {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ResourceValidator} resourceValidator
     */
    constructor(
        {
            scopesManager, fhirLoggingManager,
            resourceValidator
        }
    ) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
    }

    /**
     * does a FHIR Validate
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<Resource>}
     */
    async validateAsync({requestInfo, parsedArgs, resourceType}) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'validate';

        /**
         * @type {number}
         */
        const startTime = Date.now();
        const path = requestInfo.path;

        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');
        // Note: no auth check needed to call validate

        // We accept the resource in the two forms allowed in FHIR:
        // https://www.hl7.org/fhir/resource-operation-validate.html
        // 1. Resource is sent in the body
        // 2. Resource is sent inside a Parameters resource in the body

        /**
         * @type {Object|null}
         */
        let resource_incoming = parsedArgs.resource ? parsedArgs.resource : requestInfo.body;

        // check if this is a Parameters resourceType
        if (resource_incoming.resourceType === 'Parameters') {
            // Unfortunately our FHIR schema resource creator does not support Parameters
            // const ParametersResourceCreator = getResource(base_version, 'Parameters');
            // const parametersResource = new ParametersResourceCreator(resource_incoming);
            const parametersResource = resource_incoming;
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
                        })
                    ]
                });
            }
            // find the actual resource in the parameter called resource
            const resourceParameter = getFirstElementOrNull(parametersResource.parameter.filter(p => p.resource));
            if (!resourceParameter || !resourceParameter.resource) {
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
            resource_incoming = resourceParameter.resource;
        }

        /**
         * @type {Resource}
         */
        const resourceToValidate = FhirResourceCreator.createByResourceType(resource_incoming, resourceType);

        /**
         * @type {OperationOutcome|null}
         */
        const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
            {
                id: resource_incoming.id,
                resourceType,
                resourceToValidate: resource_incoming,
                path: path,
                currentDate: currentDate,
                resourceObj: resourceToValidate
            });
        if (validationOperationOutcome) {
            validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
            return validationOperationOutcome;
        }

        if (!this.scopesManager.doesResourceHaveAccessTags(resourceToValidate)) {
            return new OperationOutcome({
                resourceType: 'OperationOutcome',
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Resource ${resourceToValidate.resourceType}/${resourceToValidate.id}` +
                                ' is missing a security access tag with system: ' +
                                `${SecurityTagSystem.access}`
                        }),
                        expression: [
                            resourceType
                        ]
                    })
                ]
            });
        }
        if (!this.scopesManager.doesResourceHaveOwnerTags(resourceToValidate)) {
            return new OperationOutcome({
                resourceType: 'OperationOutcome',
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Resource ${resourceToValidate.resourceType}/${resourceToValidate.id}` +
                                ' is missing a security access tag with system: ' +
                                `${SecurityTagSystem.owner}`
                        }),
                        expression: [
                            resourceType
                        ]
                    })
                ]
            });
        }
        await this.fhirLoggingManager.logOperationSuccessAsync(
            {
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });

        // Per FHIR: https://www.hl7.org/fhir/resource-operation-validate.html
        // Note: as this is the only out parameter, it is a resource, and it has the name 'return',
        // the result of this operation is returned directly as a resource
        return new OperationOutcome({
            resourceType: 'OperationOutcome',
            issue: [
                new OperationOutcomeIssue({
                    severity: 'information',
                    code: 'informational',
                    details: new CodeableConcept({
                        text: 'OK'
                    }),
                    expression: [
                        resourceType
                    ]
                })
            ]
        });
    }
}

module.exports = {
    ValidateOperation
};

