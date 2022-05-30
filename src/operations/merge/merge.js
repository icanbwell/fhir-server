const {logRequest, logDebug} = require('../common/logging');
const {
    parseScopes,
    verifyHasValidScopes,
    doesResourceHaveAccessTags
} = require('../security/scopes');
const moment = require('moment-timezone');
const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {validateResource} = require('../../utils/validator.util');
const sendToS3 = require('../../utils/aws-s3');
const globals = require('../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB} = require('../../constants');
const {BadRequestError} = require('../../utils/httpErrors');
const {getMeta} = require('../common/getMeta');
const async = require('async');
// const {check_fhir_mismatch} = require('../common/check_fhir_mismatch');
const {logError} = require('../common/logging');
const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const {removeNull} = require('../../utils/nullRemover');
const {logAuditEntryAsync} = require('../../utils/auditLogger');
const {findDuplicateResources, findUniqueResources} = require('../../utils/list.util');
const {preMergeChecks} = require('./preMergeChecks');
const {performMergeDbUpdate} = require('./performMergeDbUpdate');
const {mergeExisting} = require('./mergeExisting');

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

    /**
     * merge insert
     * @param resourceToMerge
     * @returns {Promise<{created: boolean, id: *, updated: *, resource_version}>}
     */
    async function mergeInsert(resourceToMerge) {
        let id = resourceToMerge.id;
        // not found so insert
        logDebug(user,
            resourceToMerge.resourceType +
            ': merge new resource ' +
            '[' + resourceToMerge.id + ']: ' +
            JSON.stringify(resourceToMerge)
        );
        if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
            if (!doesResourceHaveAccessTags(resourceToMerge)) {
                throw new BadRequestError(new Error('Resource is missing a security access tag with system: https://www.icanbwell.com/access '));
            }
        }

        if (!resourceToMerge.meta) {
            // create the metadata
            /**
             * @type {function({Object}): Meta}
             */
            let Meta = getMeta(base_version);
            resourceToMerge.meta = new Meta({
                versionId: '1',
                lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
            });
        } else {
            resourceToMerge.meta.versionId = '1';
            resourceToMerge.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        }

        // const cleaned = JSON.parse(JSON.stringify(resourceToMerge));
        // let Resource = getResource(base_version, resourceToMerge.resourceType);
        // const cleaned = new Resource(resourceToMerge).toJSON();
        const cleaned = removeNull(resourceToMerge);
        const doc = Object.assign(cleaned, {_id: id});

        return await performMergeDbUpdate(resourceToMerge, doc, cleaned, base_version, collection_name);
    }

    // this function is called for each resource
    // returns an OperationOutcome
    /**
     * Merges a single resource
     * @param {Object} resource_to_merge
     * @return {Promise<{operationOutcome: ?OperationOutcome, issue: {severity: string, diagnostics: string, code: string, expression: [string], details: {text: string}}, created: boolean, id: String, updated: boolean}>}
     */
    async function merge_resource(resource_to_merge) {
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

        const preMergeCheckFailures = await preMergeChecks(resource_to_merge, resource_name, scopes, user, path, currentDate);
        if (preMergeCheckFailures) {
            return preMergeCheckFailures;
        }

        try {
            logDebug(user, '-----------------');
            logDebug(user, base_version);
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
            let collection = await getOrCreateCollection(db, `${resource_to_merge.resourceType}_${base_version}`);

            // Query our collection for this id
            /**
             * @type {Object}
             */
            let data = await collection.findOne({id: id.toString()});

            logDebug('test?', '------- data -------');
            logDebug('test?', `${resource_to_merge.resourceType}_${base_version}`);
            logDebug('test?', JSON.stringify(data));
            logDebug('test?', '------- end data -------');

            let res;

            // check if resource was found in database or not
            // noinspection JSUnusedLocalSymbols
            if (data && data.meta) {
                res = await mergeExisting(
                    resource_to_merge, data, base_version, user, scope, collection_name, currentDate, requestId);
            } else {
                res = await mergeInsert(resource_to_merge);
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

    /**
     * Tries to merge and retries if there is an error to protect against race conditions where 2 calls are happening
     *  in parallel for the same resource. Both of them see that the resource does not exist, one of them inserts it
     *  and then the other ones tries to insert too
     * @param resource_to_merge
     * @return {Promise<{operationOutcome: ?OperationOutcome, issue: {severity: string, diagnostics: string, code: string, expression: [string], details: {text: string}}, created: boolean, id: String, updated: boolean}>}
     */
    async function merge_resource_with_retry(resource_to_merge) {
        return await merge_resource(resource_to_merge);
    }

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
            async.map(non_duplicate_id_resources, async x => await merge_resource_with_retry(x)), // run in parallel
            async.mapSeries(duplicate_id_resources, async x => await merge_resource_with_retry(x)) // run in series
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
