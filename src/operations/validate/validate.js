const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { ScopesManager } = require('../security/scopesManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { getFirstElementOrNull } = require('../../utils/list.util');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { ResourceValidator } = require('../common/resourceValidator');
const moment = require('moment-timezone');
const { ParsedArgs } = require('../query/parsedArgs');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { isTrue } = require('../../utils/isTrue');
const { SearchManager } = require('../search/searchManager');
const deepcopy = require('deepcopy');
const { READ } = require('../../constants').OPERATIONS;

class ValidateOperation {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ResourceValidator} resourceValidator
     * @param {ConfigManager} configManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {SearchManager} searchManager
     */
    constructor (
        {
            scopesManager,
            fhirLoggingManager,
            resourceValidator,
            configManager,
            databaseQueryFactory,
            searchManager
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

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
    }

    /**
     * does a FHIR Validate
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<Resource>}
     */
    async validateAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'validate';

        const { id, resource, base_version } = parsedArgs;
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string} */
            path
        } = requestInfo;
        // Note: no auth check needed to call validate

        // We accept the resource in the two forms allowed in FHIR:
        // https://www.hl7.org/fhir/resource-operation-validate.html
        // 1. Resource is sent in the body
        // 2. Resource is sent inside a Parameters resource in the body
        // 3. id of the resource is sent in the url
        try {
            /**
             * @type {Object|null}
             */
            let resource_incoming = null;
            // if id of the resource is sent in url then use that
            if (id) {
                // retrieve the resource from the database
                /**
                 * @type {boolean}
                 */
                const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

                /**
                 * @type {{base_version, columns: Set, query: import('mongodb').Document}}
                 */
                const {
                    /** @type {import('mongodb').Document}**/
                    query
                    // /** @type {Set} **/
                    // columns
                } = await this.searchManager.constructQueryAsync(
                    {
                        user,
                        scope,
                        isUser,
                        resourceType,
                        useAccessIndex,
                        personIdFromJwtToken,
                        parsedArgs,
                        operation: READ
                    }
                );

                const databaseQueryManager = this.databaseQueryFactory.createQuery(
                    { resourceType, base_version }
                );

                const cursor = await databaseQueryManager.findAsync({ query });
                let operationOutcome = null;
                while (await cursor.hasNext()) {
                    resource_incoming = (await cursor.nextObject()).toJSON();
                    const operationOutcomeForResource = await this.validateResourceAsync(
                        {
                            base_version,
                            resource_incoming,
                            resourceType,
                            path,
                            parsedArgs,
                            currentOperationName,
                            requestInfo,
                            startTime
                        }
                    );
                    if (operationOutcome) {
                        // combine the operation outcome issues
                        if (operationOutcome.issue) {
                            operationOutcome.issue = operationOutcome.issue.concat(operationOutcomeForResource.issue);
                        } else {
                            operationOutcome.issue = operationOutcomeForResource.issue;
                        }
                    } else {
                        operationOutcome = operationOutcomeForResource;
                    }
                }
                return operationOutcome;
            }
            if (resource) {
                resource_incoming = resource;
            }
            if (!resource) {
                resource_incoming = requestInfo.body;
            }
            return await this.validateResourceAsync(
                {
                    base_version,
                    resource_incoming,
                    resourceType,
                    path,
                    parsedArgs,
                    currentOperationName,
                    requestInfo,
                    startTime
                }
            );
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }

    /**
     * validates a resource
     * @param {Object} resource_incoming
     * @param {string} resourceType
     * @param {string} path
     * @param parsedArgs
     * @param currentOperationName
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param startTime
     * @returns {Promise<OperationOutcome>}
     */
    async validateResourceAsync (
        {
            base_version,
            resource_incoming,
            resourceType,
            path,
            parsedArgs,
            currentOperationName,
            requestInfo,
            startTime
        }
    ) {
        /**
         * @type {string}
         */
        let specifiedProfile = parsedArgs.profile;

        // check if this is a Parameters resourceType
        if (resource_incoming.resourceType === 'Parameters') {
            // Unfortunately our FHIR schema resource creator does not support Parameters
            // const ParametersResourceCreator = getResource(base_version, 'Parameters');
            // const parametersResource = new ParametersResourceCreator(resource_incoming);
            /**
             * @type {Parameters|undefined}
             */
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
            /**
             * @type {string|null}
             */
            const profileParameter = getFirstElementOrNull(parametersResource.parameter.filter(p => p.profile));
            if (profileParameter) {
                specifiedProfile = profileParameter;
            }
            /**
             * @type {Parameters|null}
             */
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

        // The FHIR validator wants meta.lastUpdated to be string instead of data
        // So we copy the resource and change meta.lastUpdated to string to pass the FHIR validator
        const resourceObjectToValidate = deepcopy(resource_incoming);
        // Truncate id to 64 so it passes the validator since we support more than 64 internally
        if (resourceObjectToValidate.id) {
            resourceObjectToValidate.id = resourceObjectToValidate.id.slice(0, 64);
        }
        // If we have a bundle then fix the ids in the bundle entries
        if (resourceObjectToValidate.resourceType === 'Bundle') {
            for (const entry of resourceObjectToValidate.entry || []) {
                if (entry.resource && entry.resource.id) {
                    entry.resource.id = entry.resource.id.slice(0, 64);
                }
            }
        }
        if (resourceObjectToValidate.meta && resourceObjectToValidate.meta.lastUpdated) {
            // noinspection JSValidateTypes
            resourceObjectToValidate.meta.lastUpdated = new Date(resourceObjectToValidate.meta.lastUpdated).toISOString();
        }

        /**
         * @type {OperationOutcome|null}
         */
        const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
            {
                base_version,
                requestInfo,
                id: resource_incoming.id,
                resourceType,
                resourceToValidate: resourceObjectToValidate,
                path,
                resourceObj: resource_incoming,
                useRemoteFhirValidatorIfAvailable: true,
                profile: specifiedProfile
            });
        if (validationOperationOutcome) {
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });
            return validationOperationOutcome;
        }
        if (!this.scopesManager.doesResourceHaveOwnerTags(resource_incoming)) {
            return new OperationOutcome({
                resourceType: 'OperationOutcome',
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Resource ${resource_incoming.resourceType}/${resource_incoming.id}` +
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

        await this.fhirLoggingManager.logOperationSuccessAsync({
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
