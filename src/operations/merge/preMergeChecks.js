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
 * @param {string[] | null} scopes
 * @param {string | null} user
 * @param {string | null} path
 * @param {string} currentDate
 * @returns {Promise<MergeResultEntry|null>}
 */
async function preMergeChecksAsync(resourceToMerge, resourceName,
                                   scopes, user, path, currentDate) {
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
            operationOutcome: operationOutcome,
            resourceType: resourceName
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
                operationOutcome: operationOutcome,
                resourceType: resourceToMerge.resourceType
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
            operationOutcome: validationOperationOutcome,
            resourceType: resourceToMerge.resourceType
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
                operationOutcome: accessTagOperationOutcome,
                resourceType: resourceToMerge.resourceType
            };
        }
    }

    return null;
}

/**
 * run any pre-checks on multiple resources before merge
 * @param {Resource[]} resourcesToMerge
 * @param {string[] | null} scopes
 * @param {string | null} user
 * @param {string | null} path
 * @param {string} currentDate
 * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], validResources: Resource[]}>}
 */
async function preMergeChecksMultipleAsync(resourcesToMerge, scopes, user, path, currentDate) {
    /**
     * @type {MergeResultEntry[]}
     */
    const mergePreCheckErrors = [];
    /**
     * @type {Resource[]}
     */
    const validResources = [];
    for (const /** @type {Resource} */ r of resourcesToMerge) {
        /**
         * @type {MergeResultEntry|null}
         */
        const mergeResult = await preMergeChecksAsync(r, r.resourceType, scopes, user, path, currentDate);
        if (mergeResult) {
            mergePreCheckErrors.push(mergeResult);
        } else {
            validResources.push(r);
        }
    }
    return {mergePreCheckErrors, validResources};
}

module.exports = {
    preMergeChecksAsync,
    preMergeChecksMultipleAsync
};
