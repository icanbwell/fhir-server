// this function is called for each resource
// returns an OperationOutcome
const env = require('var');
const sendToS3 = require('../../utils/aws-s3');
const {preMergeChecksAsync} = require('./preMergeChecks');
const {logDebug, logError} = require('../common/logging');
const {isTrue} = require('../../utils/isTrue');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');
const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const {mergeExistingAsync} = require('./mergeExisting');
const {mergeInsertAsync} = require('./mergeInsert');

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
 * @param {string} collectionName
 * @return {Promise<MergeResultEntry>}
 */
async function mergeResourceAsync(resource_to_merge, resourceName,
                                  scopes, user, path, currentDate,
                                  requestId, baseVersion, scope, collectionName) {
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

        // Grab an instance of our DB and collection
        // noinspection JSValidateTypes
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        let db = (resource_to_merge.resourceType === 'AuditEvent') ?
            globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
                globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
        /**
         * @type {import('mongodb').Collection}
         */
        let collection = await getOrCreateCollection(db, `${resource_to_merge.resourceType}_${baseVersion}`);

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
                resource_to_merge, data, baseVersion, user, scope, collectionName, currentDate, requestId);
        } else {
            res = await mergeInsertAsync(resource_to_merge, baseVersion, collectionName, user);
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
