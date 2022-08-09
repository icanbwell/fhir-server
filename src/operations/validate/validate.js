const {logOperation} = require('../common/logging');
const {validateResource} = require('../../utils/validator.util');
const {doesResourceHaveAccessTags} = require('../security/scopes');
/**
 * does a FHIR Validate
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 */
module.exports.validate = async (requestInfo, args, resourceType) => {
    /**
     * @type {number}
     */
    const startTime = Date.now();
    const path = requestInfo.path;

    // no auth check needed to call validate

    let resource_incoming = requestInfo.body;

    // eslint-disable-next-line no-unused-vars
    // let {base_version} = args;

    const operationOutcome = validateResource(resource_incoming, resourceType, path);
    if (operationOutcome && operationOutcome.statusCode === 400) {
        logOperation(requestInfo, args, resourceType, startTime, Date.now(), 'operationCompleted', 'validate');
        return operationOutcome;
    }

    if (!doesResourceHaveAccessTags(resource_incoming)) {
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
    logOperation(requestInfo, args, resourceType, startTime, Date.now(), 'operationCompleted', 'validate');
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
};
