const {logRequest, logDebug} = require('../common/logging');
const {
    parseScopes,
    verifyHasValidScopes
} = require('../security/scopes');
const moment = require('moment-timezone');
const {validateResource} = require('../../utils/validator.util');
const {mergeResourceListAsync} = require('./mergeResourceList');
const {DatabaseBulkInserter} = require('./databaseBulkInserter');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {mergeOld} = require('./old/mergeOld');
const {logAuditEntriesForMergeResults} = require('./logAuditEntriesForMergeResults');

/**
 * does a FHIR Merge
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceName
 * @param {string} collectionName
 * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>}
 */
module.exports.merge = async (requestInfo, args, resourceName, collectionName) => {
    if (isTrue(env.OLD_MERGE) || isTrue(args['_useOldMerge'])) {
        return mergeOld(requestInfo, args, resourceName, collectionName);
    }
    /**
     * @type {string|null}
     */
    const user = requestInfo.user;
    /**
     * @type {string}
     */
    const scope = requestInfo.scope;
    /**
     * @type {string|null}
     */
    const path = requestInfo.path;
    /**
     * @type {Object|Object[]|null}
     */
    const body = requestInfo.body;
    /**
     * @type {string}
     */
    logRequest(user, `'${resourceName} >>> merge` + ' scopes:' + scope);

    /**
     * @type {string[]}
     */
    const scopes = parseScopes(scope);

    verifyHasValidScopes(resourceName, 'write', user, scope);

    // read the incoming resource from request body
    /**
     * @type {Resource|Resource[]}
     */
    let resourcesIncoming = body;
    logDebug(user, JSON.stringify(args));
    /**
     * @type {string}
     */
    let {base_version} = args;

    // logDebug('--- request ----');
    // logDebug(req);
    // logDebug('-----------------');

    // Assign a random number to this batch request
    /**
     * @type {string}
     */
    const requestId = Math.random().toString(36).substring(0, 5);
    /**
     * @type {string}
     */
    const currentDate = moment.utc().format('YYYY-MM-DD');

    logDebug(user, '--- body ----');
    logDebug(user, JSON.stringify(resourcesIncoming));
    logDebug(user, '-----------------');


    // if the incoming request is a bundle then unwrap the bundle
    if ((!(Array.isArray(resourcesIncoming))) && resourcesIncoming['resourceType'] === 'Bundle') {
        logDebug(user, '--- validate schema of Bundle ----');
        const operationOutcome = validateResource(resourcesIncoming, 'Bundle', path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            return operationOutcome;
        }
        // unwrap the resources
        resourcesIncoming = resourcesIncoming.entry.map(e => e.resource);
    }

    /**
     * @type {DatabaseBulkInserter}
     */
    const databaseBulkInserter = new DatabaseBulkInserter();
    /**
     * @type {boolean}
     */
    const useAtlas = isTrue(env.USE_ATLAS);
    // If we are passed an array then merge all items in array
    if (Array.isArray(resourcesIncoming)) {
        await mergeResourceListAsync(
            resourcesIncoming, user, resourceName, scopes, path, currentDate,
            requestId, base_version, scope, collectionName, requestInfo, args,
            databaseBulkInserter
        );
        /**
         * mergeResults
         * @type {MergeResultEntry[]}
         */
        const mergeResults = await databaseBulkInserter.executeAsync(base_version, useAtlas);
        await logAuditEntriesForMergeResults(requestInfo, base_version, args, mergeResults);
        return mergeResults;
    } else {
        await mergeResourceListAsync(
            [resourcesIncoming], user, resourceName, scopes, path, currentDate,
            requestId, base_version, scope, collectionName, requestInfo, args,
            databaseBulkInserter
        );
        /**
         * result
         * @type {MergeResultEntry[]}
         */
        const mergeResults = await databaseBulkInserter.executeAsync(base_version, useAtlas);
        await logAuditEntriesForMergeResults(requestInfo, base_version, args, mergeResults);
        /**
         * result
         * @type {MergeResultEntry}
         */
        const returnVal = mergeResults[0];
        logDebug(user, '--- Merge result ----');
        logDebug(user, JSON.stringify(returnVal));
        logDebug(user, '-----------------');
        return returnVal;
    }
};
