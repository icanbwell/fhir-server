const {logOperationAsync} = require('../common/logging');
const {validateResource} = require('../../utils/validator.util');
const {doesResourceHaveAccessTags} = require('../security/scopes');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {assertIsValid} = require('../../utils/assertType');
const {getResource} = require('../common/getResource');

class ValidateOperation {
    constructor() {
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
            await logOperationAsync({
                requestInfo,
                args,
                resourceType,
                startTime,
                message: 'operationCompleted',
                action: currentOperationName
            });
            return operationOutcome;
        }

        const ResourceCreator = getResource(base_version, resourceType);
        if (!doesResourceHaveAccessTags(new ResourceCreator(resource_incoming))) {
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
        await logOperationAsync({
            requestInfo,
            args,
            resourceType,
            startTime,
            message: 'operationCompleted',
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

