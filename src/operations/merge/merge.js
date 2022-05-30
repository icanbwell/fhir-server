const {logRequest, logDebug} = require('../common/logging');
const {
    parseScopes,
    verifyHasValidScopes
} = require('../security/scopes');
const moment = require('moment-timezone');
const {validateResource} = require('../../utils/validator.util');
const async = require('async');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const {findDuplicateResources, findUniqueResources} = require('../../utils/list.util');
const {merge_resource_with_retry} = require('./mergeResourceWithRetry');

// noinspection JSValidateTypes
/**
 * does a FHIR Merge
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resource_name
 * @param {string} collection_name
 * @return {Resource | Resource[]}
 */
module.exports.merge = async (requestInfo, args, resource_name, collection_name) => {
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
    logRequest(user, `'${resource_name} >>> merge` + ' scopes:' + scope);

    /**
     * @type {string[]}
     */
    const scopes = parseScopes(scope);

    verifyHasValidScopes(resource_name, 'write', user, scope);

    // read the incoming resource from request body
    /**
     * @type {Object[]}
     */
    let resources_incoming = body;
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
    logDebug(user, JSON.stringify(resources_incoming));
    logDebug(user, '-----------------');


    // if the incoming request is a bundle then unwrap the bundle
    if ((!(Array.isArray(resources_incoming))) && resources_incoming['resourceType'] === 'Bundle') {
        logDebug(user, '--- validate schema of Bundle ----');
        const operationOutcome = validateResource(resources_incoming, 'Bundle', path);
        if (operationOutcome && operationOutcome.statusCode === 400) {
            return operationOutcome;
        }
        // unwrap the resources
        resources_incoming = resources_incoming.entry.map(e => e.resource);
    }
    if (Array.isArray(resources_incoming)) {
        /**
         * @type {string[]}
         */
        const ids_of_resources = resources_incoming.map(r => r.id);
        logRequest(user,
            '==================' + resource_name + ': Merge received array ' +
            ', len= ' + resources_incoming.length +
            ' [' + ids_of_resources.toString() + '] ' +
            '===================='
        );
        // find items without duplicates and run them in parallel
        // but items with duplicate ids should run in serial, so we can merge them properly (otherwise the first item
        //  may not finish adding to the db before the next item tries to merge
        /**
         * @type {Object[]}
         */
        const duplicate_id_resources = findDuplicateResources(resources_incoming);
        /**
         * @type {Object[]}
         */
        const non_duplicate_id_resources = findUniqueResources(resources_incoming);

        /**
         * @type {Awaited<unknown>[]}
         */
        const result = await Promise.all([
            async.map(non_duplicate_id_resources, async x => await merge_resource_with_retry(x, resource_name,
                scopes, user, path, currentDate, requestId, base_version, scope, collection_name)), // run in parallel
            async.mapSeries(duplicate_id_resources, async x => await merge_resource_with_retry(x, resource_name,
                scopes, user, path, currentDate, requestId, base_version, scope, collection_name)) // run in series
        ]);
        /**
         * @type {FlatArray<unknown[], 1>[]}
         */
        const returnVal = result.flat(1);
        if (returnVal && returnVal.length > 0) {
            const createdItems = returnVal.filter(r => r['created'] === true);
            const updatedItems = returnVal.filter(r => r['updated'] === true);
            if (createdItems && createdItems.length > 0) {
                if (resource_name !== 'AuditEvent') {
                    await logAuditEntryAsync(requestInfo, base_version, resource_name, 'create', args, createdItems.map(r => r['id']));
                }
            }
            if (updatedItems && updatedItems.length > 0) {
                if (resource_name !== 'AuditEvent') {
                    await logAuditEntryAsync(requestInfo, base_version, resource_name, 'update', args, updatedItems.map(r => r['id']));
                }
            }
        }

        logDebug(user, '--- Merge array result ----');
        logDebug(user, JSON.stringify(returnVal));
        logDebug(user, '-----------------');
        return returnVal;
    } else {
        /**
         * @type {{operationOutcome: ?OperationOutcome, issue: {severity: string, diagnostics: string, code: string, expression: string[], details: {text: string}}, created: boolean, id: String, updated: boolean}}
         */
        const returnVal = await merge_resource_with_retry(resources_incoming);
        if (returnVal) {
            if (returnVal['created'] === true) {
                if (resource_name !== 'AuditEvent') {
                    await logAuditEntryAsync(requestInfo, base_version, resource_name, 'create', args, [returnVal['id']]);
                }
            }
            if (returnVal['updated'] === true) {
                if (resource_name !== 'AuditEvent') {
                    await logAuditEntryAsync(requestInfo, base_version, resource_name, 'update', args, [returnVal['id']]);
                }
            }
        }
        logDebug(user, '--- Merge result ----');
        logDebug(user, JSON.stringify(returnVal));
        logDebug(user, '-----------------');
        return returnVal;
    }
};
