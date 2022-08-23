const {validateResource} = require('../../utils/validator.util');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {getResource} = require('../common/getResource');
const {ScopesManager} = require('../security/scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');

class ValidateOperation {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     */
    constructor({scopesManager, fhirLoggingManager}) {
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
    }

    /**
     * does a FHIR Validate
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     */
    async validate(requestInfo, args, resourceType) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const path = requestInfo.path;
        /**
         * @type {string}
         */
        let {base_version} = args;

        // no auth check needed to call validate
        /**
         * @type {Object|null}
         */
        let resource_incoming = requestInfo.body;

        const operationOutcome = validateResource(resource_incoming, resourceType, path);
        const currentOperationName = 'validate';
        if (operationOutcome && operationOutcome.statusCode === 400) {
            validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args,
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
            return operationOutcome;
        }

        const ResourceCreator = getResource(base_version, resourceType);
        if (!this.scopesManager.doesResourceHaveAccessTags(new ResourceCreator(resource_incoming))) {
            return {
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'invalid',
                        details: {
                            text: 'Resource is missing a security access tag with system: https://www.icanbwell.com/access'
                        },
                        expression: [
                            resourceType
                        ]
                    }
                ]
            };
        }
        await this.fhirLoggingManager.logOperationSuccessAsync(
            {
                requestInfo,
                args,
                resourceType,
                startTime,
                action: currentOperationName
            });
        return {
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'information',
                    code: 'informational',
                    details: {
                        text: 'OK'
                    },
                    expression: [
                        resourceType
                    ]
                }
            ]
        };
    }
}

module.exports = {
    ValidateOperation
};

