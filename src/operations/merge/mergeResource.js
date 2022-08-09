// this function is called for each resource
// returns an OperationOutcome
const env = require('var');
const sendToS3 = require('../../utils/aws-s3');
const {logDebug, logError} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const {mergeExistingAsync} = require('./mergeExisting');
const {mergeInsertAsync} = require('./mergeInsert');
const {DatabaseQueryManager} = require('../../dataLayer/databaseQueryManager');

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
 * @param {string | null} scope
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @param {DatabaseBulkLoader} databaseBulkLoader
 * @return {Promise<MergeResultEntry|null>}
 */
async function mergeResourceAsync(resource_to_merge, resourceName,
                                  scopes, user, path, currentDate,
                                  requestId, baseVersion, scope,
                                  databaseBulkInserter,
                                  databaseBulkLoader) {
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

    try {
        logDebug(user, '-----------------');
        logDebug(user, baseVersion);
        logDebug(user, '--- body ----');
        logDebug(user, JSON.stringify(resource_to_merge));

        /**
         * @type {boolean}
         */
        const useAtlas = (isTrue(env.USE_ATLAS));

        // Query our collection for this id
        /**
         * @type {Object}
         */
        let data = databaseBulkLoader ?
            databaseBulkLoader.getResourceFromExistingList(resource_to_merge.resourceType, id.toString()) :
            await new DatabaseQueryManager(resource_to_merge.resourceType, baseVersion, useAtlas)
                .findOneAsync({id: id.toString()});

        logDebug('test?', '------- data -------');
        logDebug('test?', `${resource_to_merge.resourceType}_${baseVersion}`);
        logDebug('test?', JSON.stringify(data));
        logDebug('test?', '------- end data -------');

        // check if resource was found in database or not
        if (data && data.meta) {
            databaseBulkLoader.updateResourceInExistingList(resource_to_merge);
            await mergeExistingAsync(
                resource_to_merge, data, baseVersion, user, scope, currentDate, requestId,
                databaseBulkInserter);
        } else {
            databaseBulkLoader.addResourceToExistingList(resource_to_merge);
            await mergeInsertAsync(resource_to_merge, baseVersion, user,
                databaseBulkInserter);
        }
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
