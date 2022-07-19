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
const {DatabaseBulkLoader} = require('./databaseBulkLoader');
const {preMergeChecksMultipleAsync} = require('./preMergeChecks');

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
    /**
     * @type {boolean}
     */
    const wasIncomingAList = Array.isArray(resourcesIncoming);

    /**
     * @type {Resource[]}
     */
    let resourcesIncomingArray = wasIncomingAList ? resourcesIncoming : [resourcesIncoming];

    /**
     * @type {MergeResultEntry[]|null}
     */
    const mergePreCheckErrors = await preMergeChecksMultipleAsync(resourcesIncomingArray,
        scopes, user, path, currentDate);

    /**
     * @type {{id: string, resourceType: string}[]}
     */
    const incomingResourceTypeAndIds = resourcesIncomingArray.map(r => {
        return {resourceType: r.resourceType, id: r.id};
    }).filter(r => !mergePreCheckErrors.some(m => m.id === r.id && m.resourceType === r.resourceType));

    // process only the resources that are valid
    resourcesIncomingArray = resourcesIncomingArray.filter(
        r => incomingResourceTypeAndIds.some(i => i.resourceType === r.resourceType && i.id === r.id)
    );

    /**
     * @type {DatabaseBulkLoader}
     */
    const databaseBulkLoader = new DatabaseBulkLoader();
    await databaseBulkLoader.getResourcesByResourceTypeAndIdAsync(
        base_version,
        useAtlas,
        incomingResourceTypeAndIds
    );
    // merge the resources
    await mergeResourceListAsync(
        resourcesIncomingArray, user, resourceName, scopes, path, currentDate,
        requestId, base_version, scope, collectionName, requestInfo, args,
        databaseBulkInserter, databaseBulkLoader
    );
    /**
     * mergeResults
     * @type {MergeResultEntry[]}
     */
    let mergeResults = await databaseBulkInserter.executeAsync(base_version, useAtlas);

    // add in any pre-merge failures
    mergeResults = mergeResults.concat(mergePreCheckErrors);

    // add in unchanged for ids that we did not merge
    const idsInMergeResults = mergeResults.map(r => {
        return {resourceType: r.resourceType, id: r.id};
    });
    for (const {resourceType, id} of incomingResourceTypeAndIds) {
        // if this resourceType,id is not in the merge results then add it as an unchanged entry
        if (idsInMergeResults.filter(i => i.id === id && i.resourceType === resourceType).length === 0) {
            mergeResults.push({
                id: id,
                resourceType: resourceType,
                created: false,
                updated: false,
                issue: null,
                operationOutcome: null
            });
        }
    }
    await logAuditEntriesForMergeResults(requestInfo, base_version, args, mergeResults);

    logDebug(user, '--- Merge result ----');
    logDebug(user, JSON.stringify(mergeResults));
    logDebug(user, '-----------------');

    return wasIncomingAList ? mergeResults : mergeResults[0];
};
