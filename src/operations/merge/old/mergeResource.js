// this function is called for each resource
// returns an OperationOutcome
const env = require('var');
const sendToS3 = require('../../../utils/aws-s3');
const {preMergeChecksAsync} = require('../preMergeChecks');
const {logDebug, logError} = require('../../common/logging');
const {isTrue} = require('../../../utils/isTrue');
const {mergeExistingAsync} = require('./mergeExisting');
const {mergeInsertAsync} = require('./mergeInsert');
const {getOrCreateCollectionForResourceTypeAsync} = require('../../common/resourceManager');

/**
 * Merges a single resource
 * @param {Object} resource_to_merge
 * @param {string} resourceName
 * @param {string[] | null} scopes
 * @param {string|null} user
 * @param {string} path
 * @param {string} currentDate
 * @param {string} requestId
 * @param {string} baseVersion
 * @param scope
 * @return {Promise<MergeResultEntry>}
 */
async function mergeResourceAsync(resource_to_merge, resourceName,
                                  scopes, user, path, currentDate,
                                  requestId, baseVersion, scope) {
    /**
     * @type {string}
     */
    let id = resource_to_merge.id;

    if (resource_to_merge.meta && resource_to_merge.meta.lastUpdated && typeof resource_to_merge.meta.lastUpdated !== 'string') {
        resource_to_merge.meta.lastUpdated = new Date(resource_to_merge.meta.lastUpdated).toISOString();
    }

    if (env.LOG_ALL_SAVES) {
        await sendToS3('logs',
            resource_to_merge.resourceType,
            resource_to_merge,
            currentDate,
            id,
            'merge_' + requestId);
    }

    const preMergeCheckFailures = await preMergeChecksAsync(resource_to_merge, resourceName, scopes, user, path, currentDate);
    if (preMergeCheckFailures) {
        return preMergeCheckFailures;
    }

    try {
        logDebug(user, '-----------------');
        logDebug(user, baseVersion);
        logDebug(user, '--- body ----');
        logDebug(user, JSON.stringify(resource_to_merge));

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS));

        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
         */
        const collection = await getOrCreateCollectionForResourceTypeAsync(resource_to_merge.resourceType, baseVersion, useAtlas);
        /**
         * @type {import('mongodb').Collection}
         */

        // Query our collection for this id
        /**
         * @type {Object}
         */
        let data = await collection.findOne({id: id.toString()});

        logDebug('test?', '------- data -------');
        logDebug('test?', `${resource_to_merge.resourceType}_${baseVersion}`);
        logDebug('test?', JSON.stringify(data));
        logDebug('test?', '------- end data -------');

        let res;

        // check if resource was found in database or not
        // noinspection JSUnusedLocalSymbols
        if (data && data.meta) {
            res = await mergeExistingAsync(
                resource_to_merge, data, baseVersion, user, scope, currentDate, requestId);
        } else {
            res = await mergeInsertAsync(resource_to_merge, baseVersion, user);
        }

        return res;
    } catch (e) {
        logError(`Error with merging resource ${resource_to_merge.resourceType}.merge with id: ${id} `, e);
        const operationOutcome = {
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'exception',
                    details: {
                        text: 'Error merging: ' + JSON.stringify(resource_to_merge)
                    },
                    diagnostics: e.toString(),
                    expression: [
                        resource_to_merge.resourceType + '/' + id
                    ]
                }
            ]
        };
        await sendToS3('errors',
            resource_to_merge.resourceType,
            resource_to_merge,
            currentDate,
            id,
            'merge');
        await sendToS3('errors',
            resource_to_merge.resourceType,
            operationOutcome,
            currentDate,
            id,
            'merge_error');
        return {
            id: id,
            created: false,
            updated: false,
            issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
            operationOutcome: operationOutcome
        };
    }
}

module.exports = {
    mergeResourceAsync
};
