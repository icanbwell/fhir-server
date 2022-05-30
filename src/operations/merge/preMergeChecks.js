const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {logDebug} = require('../common/logging');
const {validateResource} = require('../../utils/validator.util');
const sendToS3 = require('../../utils/aws-s3');
const {doesResourceHaveAccessTags} = require('../security/scopes');

/**
 * run any pre-checks before merge
 * @param {Resource} resourceToMerge
 * @param {string} resourceName
 * @returns {Promise<{operationOutcome: OperationOutcome, issue: (*|null), created: boolean, id: *, updated: boolean}|{operationOutcome: {issue: [{severity: string, diagnostics: string, code: string, expression: string[], details: {text: string}}], resourceType: string}, issue: ({severity: string, diagnostics: string, code: string, expression: [string], details: {text: string}}|null), created: boolean, id: *, updated: boolean}|{operationOutcome: ?OperationOutcome, issue: (*|null), created: boolean, id: *, updated: boolean}|boolean>}
 * @param {string[] | null} scopes
 * @param {string | null} user
 * @param {string | null} path
 * @param {string} currentDate
 */
async function preMergeChecksAsync(resourceToMerge, resourceName, scopes, user, path, currentDate) {
    /**
     * @type {string} id
     */
    let id = resourceToMerge.id;
    if (!(resourceToMerge.resourceType)) {
        /**
         * @type {OperationOutcome}
         */
        const operationOutcome = {
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'exception',
                    details: {
                        text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                    },
                    diagnostics: 'resource is missing resourceType',
                    expression: [
                        resourceName + '/' + id
                    ]
                }
            ]
        };
        return {
            id: id,
            created: false,
            updated: false,
            issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
            operationOutcome: operationOutcome
        };
    }

    if (isTrue(env.AUTH_ENABLED)) {
        let {success} = scopeChecker(resourceToMerge.resourceType, 'write', scopes);
        if (!success) {
            const operationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                        },
                        diagnostics: 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + resourceToMerge.resourceType + '.' + 'write' + ']',
                        expression: [
                            resourceToMerge.resourceType + '/' + id
                        ]
                    }
                ]
            };
            return {
                id: id,
                created: false,
                updated: false,
                issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                operationOutcome: operationOutcome
            };
        }
    }

    //----- validate schema ----
    logDebug(user, '--- validate schema ----');
    /**
     * @type {OperationOutcome | null}
     */
    const validationOperationOutcome = validateResource(resourceToMerge, resourceToMerge.resourceType, path);
    if (validationOperationOutcome && validationOperationOutcome.statusCode === 400) {
        validationOperationOutcome['expression'] = [
            resourceToMerge.resourceType + '/' + id
        ];
        if (!(validationOperationOutcome['details']) || !(validationOperationOutcome['details']['text'])) {
            validationOperationOutcome['details'] = {
                text: ''
            };
        }
        validationOperationOutcome['details']['text'] = validationOperationOutcome['details']['text'] + ',' + JSON.stringify(resourceToMerge);

        await sendToS3('validation_failures',
            resourceToMerge.resourceType,
            resourceToMerge,
            currentDate,
            id,
            'merge');
        await sendToS3('validation_failures',
            resourceToMerge.resourceType,
            validationOperationOutcome,
            currentDate,
            id,
            'merge_failure');
        return {
            id: id,
            created: false,
            updated: false,
            issue: (validationOperationOutcome.issue && validationOperationOutcome.issue.length > 0) ? validationOperationOutcome.issue[0] : null,
            operationOutcome: validationOperationOutcome
        };
    }
    logDebug(user, '-----------------');

    if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
        if (!doesResourceHaveAccessTags(resourceToMerge)) {
            const accessTagOperationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                        },
                        diagnostics: 'Resource is missing a meta.security tag with system: https://www.icanbwell.com/access',
                        expression: [
                            resourceToMerge.resourceType + '/' + id
                        ]
                    }
                ]
            };
            return {
                id: id,
                created: false,
                updated: false,
                issue: (accessTagOperationOutcome.issue && accessTagOperationOutcome.issue.length > 0) ? accessTagOperationOutcome.issue[0] : null,
                operationOutcome: accessTagOperationOutcome
            };
        }
    }

    return false;
}

module.exports = {
    preMergeChecksAsync
};
