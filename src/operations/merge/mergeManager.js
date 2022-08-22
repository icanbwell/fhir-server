const {getResource} = require('../common/getResource');
const {logDebug, logError} = require('../common/logging');
const deepcopy = require('deepcopy');
const {preSaveAsync} = require('../common/preSave');
const {removeNull} = require('../../utils/nullRemover');
const deepEqual = require('fast-deep-equal');
const {mergeObject} = require('../../utils/mergeHelper');
const {compare, applyPatch} = require('fast-json-patch');
const {isAccessToResourceAllowedBySecurityTags, doesResourceHaveAccessTags} = require('../security/scopes');
const {ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const moment = require('moment-timezone');
const env = require('var');
const sendToS3 = require('../../utils/aws-s3');
const {getMeta} = require('../common/getMeta');
const {isTrue} = require('../../utils/isTrue');
const {findDuplicateResources, findUniqueResources, groupByLambda} = require('../../utils/list.util');
const async = require('async');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {validateResource} = require('../../utils/validator.util');
const {validationsFailedCounter} = require('../../utils/prometheus.utils');
const {AuditLogger} = require('../../utils/auditLogger');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');

class MergeManager {
    /**
     * Constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     */
    constructor(databaseQueryFactory, auditLogger) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        assertTypeEquals(auditLogger, AuditLogger);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
    }

    /**
     * resource to merge
     * @param {Resource} resourceToMerge
     * @param {Object} data
     * @param {string} baseVersion
     * @param {string|null} user
     * @param {string} scope
     * @param {string} currentDate
     * @param {string} requestId
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @returns {Promise<void>}
     */
    async mergeExistingAsync(resourceToMerge, data,
                             baseVersion, user, scope,
                             currentDate,
                             requestId,
                             databaseBulkInserter) {
        /**
         * @type {string}
         */
        let id = resourceToMerge.id;
        // create a resource with incoming data
        /**
         * @type {function({Object}):Resource}
         */
        let Resource = getResource(baseVersion, resourceToMerge.resourceType);

        // found an existing resource
        logDebug(user, resourceToMerge.resourceType + ': merge found resource ' + '[' + data.id + ']: ' + JSON.stringify(data));
        /**
         * @type {Resource}
         */
        let foundResource = new Resource(data);
        logDebug(user, '------ found document --------');
        logDebug(user, JSON.stringify(data));
        logDebug(user, '------ end found document --------');
        // use metadata of existing resource (overwrite any passed in metadata)
        if (!resourceToMerge.meta) {
            resourceToMerge.meta = {};
        }
        // compare without checking source, so we don't create a new version just because of a difference in source
        /**
         * @type {string}
         */
        const original_source = resourceToMerge.meta.source;
        resourceToMerge.meta.versionId = foundResource.meta.versionId;
        resourceToMerge.meta.lastUpdated = foundResource.meta.lastUpdated;
        resourceToMerge.meta.source = foundResource.meta.source;
        logDebug(user, '------ incoming document --------');
        logDebug(user, JSON.stringify(resourceToMerge));
        logDebug(user, '------ end incoming document --------');

        /**
         * @type {Object}
         */
        let my_data = deepcopy(data);

        await preSaveAsync(my_data);

        delete my_data['_id']; // remove _id since that is an internal
        // remove any null properties so deepEqual does not consider objects as different because of that
        my_data = removeNull(my_data);
        resourceToMerge = removeNull(resourceToMerge);

        // for speed, first check if the incoming resource is exactly the same
        if (deepEqual(my_data, resourceToMerge) === true) {
            logDebug(user, 'No changes detected in updated resource');
            return;
        }

        // data seems to get updated below
        /**
         * @type {Object}
         */
        let resource_merged = mergeObject(my_data, resourceToMerge);

        // now create a patch between the document in db and the incoming document
        //  this returns an array of patches
        /**
         * @type {Operation[]}
         */
        let patchContent = compare(my_data, resource_merged);
        // ignore any changes to _id since that's an internal field
        patchContent = patchContent.filter(item => item.path !== '/_id');
        logDebug(user, '------ patches --------');
        logDebug(user, JSON.stringify(patchContent));
        logDebug(user, '------ end patches --------');
        // see if there are any changes
        if (patchContent.length === 0) {
            logDebug(user, 'No changes detected in updated resource');
            return;
        }
        if (!(isAccessToResourceAllowedBySecurityTags(foundResource, user, scope))) {
            throw new ForbiddenError(
                'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                foundResource.resourceType + ' with id ' + id);
        }
        logDebug(user, `${resourceToMerge.resourceType} >>> merging ${id}`);
        // now apply the patches to the found resource
        // noinspection JSCheckFunctionSignatures
        /**
         * @type {Object}
         */
        let patched_incoming_data = applyPatch(data, patchContent).newDocument;
        /**
         * @type {Resource}
         */
        let patched_resource_incoming = new Resource(patched_incoming_data);
        // update the metadata to increment versionId
        /**
         * @type {Meta}
         */
        let meta = foundResource.meta;
        meta.versionId = `${parseInt(foundResource.meta.versionId) + 1}`;
        meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        // set the source from the incoming resource
        meta.source = original_source;
        // These properties are set automatically
        patched_resource_incoming.meta.versionId = meta.versionId;
        patched_resource_incoming.meta.lastUpdated = meta.lastUpdated;
        // If not source is provided then use the source of the previous entity
        if (!(patched_resource_incoming.meta.source)) {
            patched_resource_incoming.meta.source = meta.source;
        }
        // If no security tags are provided then use the source of the previous entity
        if (!(patched_resource_incoming.meta.security)) {
            patched_resource_incoming.meta.security = meta.security;
        }
        logDebug(user, '------ patched document --------');
        logDebug(user, JSON.stringify(patched_resource_incoming));
        logDebug(user, '------ end patched document --------');
        // Same as update from this point on
        // const cleaned = JSON.parse(JSON.stringify(patched_resource_incoming));
        // check_fhir_mismatch(cleaned, patched_incoming_data);
        // const cleaned = patched_resource_incoming;

        /**
         * @type {Object}
         */
        const cleaned = patched_resource_incoming.toJSON();
        /**
         * @type {Object}
         */
        const doc = Object.assign(cleaned, {_id: id});
        if (env.LOG_ALL_MERGES) {
            await sendToS3('logs',
                resourceToMerge.resourceType,
                {
                    'old': data,
                    'new': resourceToMerge,
                    'patch': patchContent,
                    'after': doc
                },
                currentDate,
                id,
                'merge_' + meta.versionId + '_' + requestId);
        }
        await this.performMergeDbUpdateAsync(resourceToMerge, doc, cleaned, baseVersion, databaseBulkInserter);
    }

    /**
     * merge insert
     * @param {Resource} resourceToMerge
     * @param {string} baseVersion
     * @param {string | null} user
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @returns {Promise<void>}
     */
    async mergeInsertAsync(resourceToMerge, baseVersion,
                           user, databaseBulkInserter) {
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
            let Meta = getMeta(baseVersion);
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

        await this.performMergeDbInsertAsync(resourceToMerge, doc, cleaned, baseVersion, databaseBulkInserter);
    }

    /**
     * Merges a single resource
     * @param {MongoCollectionManager} collectionManager
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
    async mergeResourceAsync(collectionManager,
                             resource_to_merge, resourceName,
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
                await this.databaseQueryFactory.createQuery(
                    resource_to_merge.resourceType, baseVersion, useAtlas)
                    .findOneAsync({id: id.toString()});

            logDebug('test?', '------- data -------');
            logDebug('test?', `${resource_to_merge.resourceType}_${baseVersion}`);
            logDebug('test?', JSON.stringify(data));
            logDebug('test?', '------- end data -------');

            // check if resource was found in database or not
            if (data && data.meta) {
                databaseBulkLoader.updateResourceInExistingList(resource_to_merge);
                await this.mergeExistingAsync(
                    resource_to_merge, data, baseVersion, user, scope, currentDate, requestId,
                    databaseBulkInserter);
            } else {
                databaseBulkLoader.addResourceToExistingList(resource_to_merge);
                await this.mergeInsertAsync(resource_to_merge, baseVersion, user,
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

    /**
     * merges a list of resources
     * @param {MongoCollectionManager} collectionManager
     * @param {Resource[]} resources_incoming
     * @param {string|null} user
     * @param {string} resourceType
     * @param {string[]|null} scopes
     * @param {string} path
     * @param {string} currentDate
     * @param {string} requestId
     * @param {string} base_version
     * @param {string} scope
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @returns {Promise<MergeResultEntry[]>}
     */
    async mergeResourceListAsync(collectionManager,
                                 resources_incoming, user,
                                 resourceType, scopes, path,
                                 currentDate, requestId, base_version,
                                 scope, requestInfo,
                                 args,
                                 databaseBulkInserter,
                                 databaseBulkLoader) {
        /**
         * @type {string[]}
         */
        const ids_of_resources = resources_incoming.map(r => r.id);
        logDebug(user,
            '==================' + resourceType + ': Merge received array ' +
            ', len= ' + resources_incoming.length +
            ' [' + ids_of_resources.toString() + '] ' +
            '===================='
        );
        // find items without duplicates and run them in parallel
        // but items with duplicate ids should run in serial, so we can merge them properly (otherwise the first item
        //  may not finish adding to the db before the next item tries to merge
        /**
         * @type {Resource[]}
         */
        const duplicate_id_resources = findDuplicateResources(resources_incoming);
        /**
         * @type {Resource[]}
         */
        const non_duplicate_id_resources = findUniqueResources(resources_incoming);

        await Promise.all([
            async.map(non_duplicate_id_resources, async x => await this.mergeResourceWithRetryAsync(collectionManager,
                x, resourceType,
                scopes, user, path, currentDate, requestId, base_version, scope, databaseBulkInserter,
                databaseBulkLoader)), // run in parallel
            async.mapSeries(duplicate_id_resources, async x => await this.mergeResourceWithRetryAsync(collectionManager,
                x, resourceType,
                scopes, user, path, currentDate, requestId, base_version, scope, databaseBulkInserter,
                databaseBulkLoader)) // run in series
        ]);
    }

    /**
     * Tries to merge and retries if there is an error to protect against race conditions where 2 calls are happening
     *  in parallel for the same resource. Both of them see that the resource does not exist, one of them inserts it
     *  and then the other ones tries to insert too
     * @param {MongoCollectionManager} collectionManager
     * @param {Object} resource_to_merge
     * @param {string} resourceName
     * @param {string[] | null} scopes
     * @param {string|null} user
     * @param {string} path
     * @param {string} currentDate
     * @param {string} requestId
     * @param {string} baseVersion
     * @param {string} scope
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @return {Promise<void>}
     */
    async mergeResourceWithRetryAsync(collectionManager,
                                      resource_to_merge, resourceName,
                                      scopes, user, path, currentDate,
                                      requestId, baseVersion, scope,
                                      databaseBulkInserter,
                                      databaseBulkLoader) {
        await this.mergeResourceAsync(
            collectionManager,
            resource_to_merge, resourceName,
            scopes, user, path, currentDate,
            requestId, baseVersion, scope,
            databaseBulkInserter, databaseBulkLoader);
    }

    /**
     * performs the db update
     * @param {Object} resourceToMerge
     * @param {Object} doc
     * @param {Object} cleaned
     * @param {string} baseVersion
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @returns {Promise<void>}
     */
    async performMergeDbUpdateAsync(resourceToMerge, doc, cleaned,
                                    baseVersion,
                                    databaseBulkInserter) {
        let id = resourceToMerge.id;

        await preSaveAsync(doc);

        // delete doc['_id'];

        // Insert/update our resource record
        // When using the $set operator, only the specified fields are updated
        // /**
        //  * @type {import('mongodb').FindAndModifyWriteOpResultObject<DefaultSchema>}
        //  */
        //let res = await collection.findOneAndUpdate({id: id.toString()}, {$set: doc}, {upsert: true});
        await databaseBulkInserter.replaceOneAsync(resourceToMerge.resourceType, id.toString(), doc);

        /**
         * @type {import('mongodb').Document}
         */
        let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
        // Insert our resource record to history but don't assign _id
        delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
        // await history_collection.insertOne(history_resource);
        await databaseBulkInserter.insertOneHistoryAsync(resourceToMerge.resourceType, doc);
    }

    /**
     * performs the db insert
     * @param {Object} resourceToMerge
     * @param {Object} doc
     * @param {Object} cleaned
     * @param {string} baseVersion
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @returns {Promise<void>}
     */
    async performMergeDbInsertAsync(resourceToMerge, doc, cleaned,
                                    baseVersion,
                                    databaseBulkInserter) {
        let id = resourceToMerge.id;

        await preSaveAsync(doc);

        delete doc['_id'];

        // Insert/update our resource record
        await databaseBulkInserter.insertOneAsync(resourceToMerge.resourceType, doc);

        /**
         * @type {import('mongodb').Document}
         */
        let history_resource = Object.assign(cleaned, {_id: id + cleaned.meta.versionId});
        // Insert our resource record to history but don't assign _id
        delete history_resource['_id']; // make sure we don't have an _id field when inserting into history
        // await history_collection.insertOne(history_resource);
        await databaseBulkInserter.insertOneHistoryAsync(resourceToMerge.resourceType, doc);
    }

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
    async preMergeChecksAsync(resourceToMerge, resourceName,
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
        // The FHIR validator wants meta.lastUpdated to be string instead of data
        // So we copy the resource and change meta.lastUpdated to string to pass the FHIR validator
        const resourceToValidate = deepcopy(resourceToMerge);
        if (resourceToValidate.meta && resourceToValidate.meta.lastUpdated) {
            // noinspection JSValidateTypes
            resourceToValidate.meta.lastUpdated = new Date(resourceToValidate.meta.lastUpdated).toISOString();
        }
        /**
         * @type {OperationOutcome | null}
         */
        const validationOperationOutcome = validateResource(resourceToValidate, resourceToValidate.resourceType, path);
        if (validationOperationOutcome && validationOperationOutcome.statusCode === 400) {
            validationsFailedCounter.inc({action: 'merge', resourceType: resourceToValidate.resourceType}, 1);
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
    async preMergeChecksMultipleAsync(resourcesToMerge, scopes, user, path, currentDate) {
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
            const mergeResult = await this.preMergeChecksAsync(r, r.resourceType, scopes, user, path, currentDate);
            if (mergeResult) {
                mergePreCheckErrors.push(mergeResult);
            } else {
                validResources.push(r);
            }
        }
        return {mergePreCheckErrors, validResources};
    }

    /**
     * logs audit entries for merge result entries
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {string} requestId
     * @param {string} base_version
     * @param {Object} args
     * @param {MergeResultEntry[]} mergeResults
     * @returns {Promise<void>}
     */
    async logAuditEntriesForMergeResults(requestInfo,
                                         requestId,
                                         base_version, args,
                                         mergeResults) {
        assertIsValid(requestInfo);
        /**
         * merge results grouped by resourceType
         * @type {Object}
         */
        const groupByResourceType = groupByLambda(mergeResults, mergeResult => {
            return mergeResult.resourceType;
        });

        for (const [resourceType, mergeResultsForResourceType] of Object.entries(groupByResourceType)) {
            if (resourceType !== 'AuditEvent') { // we don't log queries on AuditEvent itself
                /**
                 * @type {MergeResultEntry[]}
                 */
                const createdItems = mergeResultsForResourceType.filter(r => r.created === true);
                /**
                 * @type {MergeResultEntry[]}
                 */
                const updatedItems = mergeResultsForResourceType.filter(r => r.updated === true);
                if (createdItems && createdItems.length > 0) {
                    await this.auditLogger.logAuditEntryAsync(requestInfo, base_version, resourceType,
                        'create', args, createdItems.map(r => r['id']));
                }
                if (updatedItems && updatedItems.length > 0) {
                    await this.auditLogger.logAuditEntryAsync(requestInfo, base_version, resourceType,
                        'update', args, updatedItems.map(r => r['id']));
                }
            }
        }

        const currentDate = moment.utc().format('YYYY-MM-DD');
        await this.auditLogger.flushAsync(requestId, currentDate);
    }
}

module.exports = {
    MergeManager
};
