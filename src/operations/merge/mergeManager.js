const {logDebug, logError} = require('../common/logging');
const deepcopy = require('deepcopy');
const {ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const moment = require('moment-timezone');
const env = require('var');
const sendToS3 = require('../../utils/aws-s3');
const {getMeta} = require('../common/getMeta');
const {isTrue} = require('../../utils/isTrue');
const {findDuplicateResources, findUniqueResources, groupByLambda} = require('../../utils/list.util');
const async = require('async');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {AuditLogger} = require('../../utils/auditLogger');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseBulkInserter} = require('../../dataLayer/databaseBulkInserter');
const {DatabaseBulkLoader} = require('../../dataLayer/databaseBulkLoader');
const {ScopesManager} = require('../security/scopesManager');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const {ResourceMerger} = require('../common/resourceMerger');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const {ResourceValidator} = require('../common/resourceValidator');
const {RethrownError} = require('../../utils/rethrownError');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {ConfigManager} = require('../../utils/configManager');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

class MergeManager {
    /**
     * Constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {ScopesManager} scopesManager
     * @param {ResourceMerger} resourceMerger
     * @param {ResourceValidator} resourceValidator
     * @param {PreSaveManager} preSaveManager
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            databaseQueryFactory,
            auditLogger,
            databaseBulkInserter,
            databaseBulkLoader,
            scopesManager,
            resourceMerger,
            resourceValidator,
            preSaveManager,
            configManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        /**
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * resource to merge
     * @param {Resource} resourceToMerge
     * @param {Resource} currentResource
     * @param {string|null} user
     * @param {string} scope
     * @param {string} currentDate
     * @param {string} requestId
     * @returns {Promise<void>}
     */
    async mergeExistingAsync(
        {
            resourceToMerge,
            currentResource,
            user,
            scope,
            currentDate,
            requestId,
        }) {
        /**
         * @type {string}
         */
        let id = resourceToMerge.id;

        // found an existing resource
        /**
         * @type {Resource}
         */
        let foundResource = currentResource;
        if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: foundResource, user, scope
            }
        ))) {
            throw new ForbiddenError(
                'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                foundResource.resourceType + ' with id ' + id);
        }

        await this.preSaveManager.preSaveAsync(currentResource);

        /**
         * @type {Resource|null}
         */
        const {updatedResource: patched_resource_incoming, patches} = await this.resourceMerger.mergeResourceAsync(
            {currentResource, resourceToMerge});

        if (this.configManager.logAllMerges) {
            await sendToS3('logs',
                resourceToMerge.resourceType,
                {
                    'old': currentResource,
                    'new': resourceToMerge,
                    'after': patched_resource_incoming
                },
                currentDate,
                id,
                'merge_' + currentResource.meta.versionId + '_' + requestId);
        }
        if (patched_resource_incoming) {
            await this.performMergeDbUpdateAsync({
                    requestId,
                    resourceToMerge: patched_resource_incoming,
                    previousVersionId: currentResource.meta.versionId,
                    patches
                }
            );
        }
    }

    /**
     * merge insert
     * @param {string} requestId
     * @param {Resource} resourceToMerge
     * @param {string} base_version
     * @param {string | null} user
     * @param {string} scope
     * @returns {Promise<void>}
     */
    async mergeInsertAsync(
        {
            requestId,
            resourceToMerge,
            base_version,
            user,
            scope,
        }
    ) {
        assertTypeEquals(resourceToMerge, Resource);
        // not found so insert
        logDebug({
            user,
            args: {message: 'Merging new resource', id: resourceToMerge.id, resource: resourceToMerge}
        });
        if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
            if (!this.scopesManager.doesResourceHaveAccessTags(resourceToMerge)) {
                throw new BadRequestError(new Error('Resource is missing a security access tag with system: https://www.icanbwell.com/access '));
            }
        }

        if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: resourceToMerge, user, scope
        }))) {
            throw new ForbiddenError(
                'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                resourceToMerge.resourceType + ' with id ' + resourceToMerge.id);
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

        await this.performMergeDbInsertAsync({
            requestId,
            resourceToMerge
        });
    }

    /**
     * Merges a single resource
     * @param {Resource} resourceToMerge
     * @param {string} resourceType
     * @param {string|null} user
     * @param {string} currentDate
     * @param {string} requestId
     * @param {string} base_version
     * @param {string | null} scope
     * @return {Promise<void>}
     */
    async mergeResourceAsync(
        {
            resourceToMerge,
            resourceType,
            user,
            currentDate,
            requestId,
            base_version,
            scope
        }
    ) {
        assertTypeEquals(resourceToMerge, Resource);
        /**
         * @type {string}
         */
        let id = resourceToMerge.id;

        if (!id) {
            return;
        }

        if (resourceToMerge.meta && resourceToMerge.meta.lastUpdated && typeof resourceToMerge.meta.lastUpdated !== 'string') {
            resourceToMerge.meta.lastUpdated = new Date(resourceToMerge.meta.lastUpdated).toISOString();
        }

        if (isTrue(env.LOG_ALL_SAVES)) {
            await sendToS3('logs',
                resourceToMerge.resourceType,
                resourceToMerge,
                currentDate,
                id,
                'merge_' + requestId);
        }

        // use mutex so multiple requests are not in here at the same time
        await mutex.runExclusive(async () => {
            try {
                // Query our collection for this id
                const databaseQueryManager = this.databaseQueryFactory.createQuery(
                    {resourceType: resourceToMerge.resourceType, base_version}
                );
                /**
                 * @type {Resource|null}
                 */
                let currentResource = this.databaseBulkLoader ?
                    this.databaseBulkLoader.getResourceFromExistingList(
                        {
                            requestId,
                            resourceType: resourceToMerge.resourceType,
                            id: id.toString()
                        }
                    ) :
                    await databaseQueryManager.findOneAsync({query: {id: id.toString()}});

                // check if resource was found in database or not
                if (currentResource && currentResource.meta) {
                    await this.mergeExistingAsync(
                        {
                            resourceToMerge, currentResource, user, scope, currentDate, requestId
                        }
                    );
                    this.databaseBulkLoader.updateResourceInExistingList({requestId, resource: resourceToMerge});
                } else {
                    await this.mergeInsertAsync({
                        requestId,
                        resourceToMerge, base_version, user, scope
                    });
                    this.databaseBulkLoader.addResourceToExistingList({requestId, resource: resourceToMerge});
                }
            } catch (e) {
                logError({
                    user: user,
                    args: {
                        message: 'Error with merging resource',
                        resourceType: resourceToMerge.resourceType,
                        id: id,
                        error: e
                    }
                });
                const operationOutcome = {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'exception',
                            details: {
                                text: 'Error merging: ' + JSON.stringify(resourceToMerge.toJSON())
                            },
                            diagnostics: e.toString(),
                            expression: [
                                resourceToMerge.resourceType + '/' + id
                            ]
                        }
                    ]
                };
                if (isTrue(env.LOG_VALIDATION_FAILURES)) {
                    await sendToS3('errors',
                        resourceToMerge.resourceType,
                        resourceToMerge,
                        currentDate,
                        id,
                        'merge');
                    await sendToS3('errors',
                        resourceToMerge.resourceType,
                        operationOutcome,
                        currentDate,
                        id,
                        'merge_error');
                }
                throw new RethrownError(
                    {
                        message: 'Failed to load data',
                        error: e,
                        source: 'MergeManager',
                        args: {
                            id: id,
                            resourceType: resourceType,
                            created: false,
                            updated: false,
                            issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                            operationOutcome: operationOutcome
                        },
                    }
                );
            }
        });
    }

    /**
     * merges a list of resources
     * @param {Resource[]} resources_incoming
     * @param {string|null} user
     * @param {string} resourceType
     * @param {string} currentDate
     * @param {string} requestId
     * @param {string} base_version
     * @param {string} scope
     * @returns {Promise<void>}
     */
    async mergeResourceListAsync(
        {
            resources_incoming,
            user,
            resourceType,
            currentDate,
            requestId,
            base_version,
            scope
        }
    ) {
        try {
            /**
             * @type {string[]}
             */
            const ids_of_resources = resources_incoming.map(r => r.id);
            logDebug({
                    user, args:
                        {
                            message: 'Merge received array',
                            length: resources_incoming.length,
                            id: ids_of_resources
                        }
                }
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
                async.map(non_duplicate_id_resources,
                    async (/** @type {Object} */ x) => await this.mergeResourceWithRetryAsync(
                        {
                            resourceToMerge: x,
                            resourceType,
                            user, currentDate, requestId, base_version, scope
                        }
                    )), // run in parallel
                async.mapSeries(duplicate_id_resources, async (/** @type {Object} */ x) => await this.mergeResourceWithRetryAsync(
                    {
                        resourceToMerge: x, resourceType,
                        user, currentDate, requestId, base_version, scope
                    })) // run in series
            ]);
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Tries to merge and retries if there is an error to protect against race conditions where 2 calls are happening
     *  in parallel for the same resource. Both of them see that the resource does not exist, one of them inserts it
     *  and then the other ones tries to insert too
     * @param {Resource} resourceToMerge
     * @param {string} resourceType
     * @param {string|null} user
     * @param {string} currentDate
     * @param {string} requestId
     * @param {string} base_version
     * @param {string} scope
     * @return {Promise<void>}
     */
    async mergeResourceWithRetryAsync(
        {
            resourceToMerge,
            resourceType,
            user,
            currentDate,
            requestId,
            base_version,
            scope
        }
    ) {
        assertTypeEquals(resourceToMerge, Resource);
        try {
            await this.mergeResourceAsync(
                {
                    resourceToMerge,
                    resourceType,
                    user,
                    currentDate,
                    requestId,
                    base_version,
                    scope
                });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * performs the db update
     * @param {string} requestId
     * @param {Resource} resourceToMerge
     * @param {string} previousVersionId
     * @param {MergePatchEntry[]} patches
     * @returns {Promise<void>}
     */
    async performMergeDbUpdateAsync(
        {
            requestId,
            resourceToMerge,
            previousVersionId,
            patches
        }
    ) {
        try {
            assertTypeEquals(resourceToMerge, Resource);
            let id = resourceToMerge.id;

            await this.preSaveManager.preSaveAsync(resourceToMerge);

            // Insert/update our resource record
            await this.databaseBulkInserter.replaceOneAsync(
                {
                    requestId,
                    resourceType: resourceToMerge.resourceType,
                    id: id.toString(),
                    doc: resourceToMerge,
                    previousVersionId,
                    patches
                }
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error updating: ${JSON.stringify(resourceToMerge.toJSON())}`,
                error: e
            });
        }
    }

    /**
     * performs the db insert
     * @param {string} requestId
     * @param {Resource} resourceToMerge
     * @returns {Promise<void>}
     */
    async performMergeDbInsertAsync(
        {
            requestId,
            resourceToMerge
        }) {
        try {
            assertTypeEquals(resourceToMerge, Resource);
            await this.preSaveManager.preSaveAsync(resourceToMerge);

            // Insert/update our resource record
            await this.databaseBulkInserter.insertOneAsync({
                    requestId,
                    resourceType: resourceToMerge.resourceType,
                    doc: resourceToMerge
                }
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error inserting: ${JSON.stringify(resourceToMerge.toJSON())}`,
                error: e
            });
        }
    }

    /**
     * run any pre-checks before merge
     * @param {Resource} resourceToMerge
     * @param {string} resourceType
     * @param {string[] | null} scopes
     * @param {string | null} user
     * @param {string | null} path
     * @param {string} currentDate
     * @returns {Promise<MergeResultEntry|null>}
     */
    async preMergeChecksAsync(
        {
            resourceToMerge,
            resourceType,
            scopes,
            user,
            path,
            currentDate
        }) {
        try {
            /**
             * @type {string} id
             */
            let id = resourceToMerge.id;
            if (!(resourceToMerge.resourceType)) {
                /**
                 * @type {OperationOutcome}
                 */
                const operationOutcome = new OperationOutcome({
                    resourceType: 'OperationOutcome',
                    issue: [
                        new OperationOutcomeIssue({
                            severity: 'error',
                            code: 'exception',
                            details: new CodeableConcept({
                                text: 'Error merging: ' + JSON.stringify(resourceToMerge.toJSON())
                            }),
                            diagnostics: 'resource is missing resourceType',
                            expression: [
                                resourceType + '/' + id
                            ]
                        })
                    ]
                });
                const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;
                return {
                    id: id,
                    created: false,
                    updated: false,
                    issue: issue,
                    operationOutcome: operationOutcome,
                    resourceType: resourceType
                };
            }

            if (isTrue(this.configManager.authEnabled)) {
                let {success} = scopeChecker(resourceToMerge.resourceType, 'write', scopes);
                if (!success) {
                    const operationOutcome = new OperationOutcome({
                        issue: [
                            new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'exception',
                                details: new CodeableConcept({
                                    text: 'Error merging: ' + JSON.stringify(resourceToMerge.toJSON())
                                }),
                                diagnostics: 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + resourceToMerge.resourceType + '.' + 'write' + ']',
                                expression: [
                                    resourceToMerge.resourceType + '/' + id
                                ]
                            })
                        ]
                    });
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
            const resourceObjectToValidate = deepcopy(resourceToMerge.toJSON());
            if (resourceObjectToValidate.meta && resourceObjectToValidate.meta.lastUpdated) {
                // noinspection JSValidateTypes
                resourceObjectToValidate.meta.lastUpdated = new Date(resourceObjectToValidate.meta.lastUpdated).toISOString();
            }

            /**
             * @type {OperationOutcome|null}
             */
            const validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                id: id,
                resourceType: resourceObjectToValidate.resourceType,
                resourceToValidate: resourceObjectToValidate,
                path: path,
                currentDate: currentDate
            });
            if (validationOperationOutcome) {
                // noinspection JSValidateTypes
                return {
                    id: id,
                    created: false,
                    updated: false,
                    issue: (validationOperationOutcome.issue && validationOperationOutcome.issue.length > 0) ?
                        validationOperationOutcome.issue[0] : null,
                    operationOutcome: validationOperationOutcome,
                    resourceType: resourceToMerge.resourceType
                };
            }

            if (env.CHECK_ACCESS_TAG_ON_SAVE === '1') {
                if (!this.scopesManager.doesResourceHaveAccessTags(resourceToMerge)) {
                    const accessTagOperationOutcome = new OperationOutcome({
                        resourceType: 'OperationOutcome',
                        issue: [
                            new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'exception',
                                details: new CodeableConcept({
                                    text: 'Error merging: ' + JSON.stringify(resourceToMerge.toJSON())
                                }),
                                diagnostics: 'Resource is missing a meta.security tag with system: https://www.icanbwell.com/access',
                                expression: [
                                    resourceToMerge.resourceType + '/' + id
                                ]
                            })
                        ]
                    });
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
        } catch (e) {
            throw new RethrownError({
                message: `Error pre merge checks: ${JSON.stringify(resourceToMerge.toJSON())}`,
                error: e
            });
        }
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
    async preMergeChecksMultipleAsync(
        {
            resourcesToMerge, scopes, user, path, currentDate
        }) {
        try {
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
                const mergeResult = await this.preMergeChecksAsync(
                    {
                        resourceToMerge: r,
                        resourceType: r.resourceType,
                        scopes,
                        user,
                        path,
                        currentDate
                    }
                );
                if (mergeResult) {
                    mergePreCheckErrors.push(mergeResult);
                } else {
                    validResources.push(r);
                }
            }
            return {mergePreCheckErrors, validResources};
        } catch (e) {
            throw new RethrownError({
                message: 'Error in MergeManager.preMergeChecksMultipleAsync()',
                error: e
            });
        }
    }

    /**
     * logs audit entries for merge result entries
     * @param {FhirRequestInfo} requestInfo
     * @param {string} requestId
     * @param {string} base_version
     * @param {Object} args
     * @param {MergeResultEntry[]} mergeResults
     * @param {string} method
     * @returns {Promise<void>}
     */
    async logAuditEntriesForMergeResults(
        {
            requestInfo,
            requestId,
            base_version, args,
            mergeResults,
            method
        }
    ) {
        try {
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
                        await this.auditLogger.logAuditEntryAsync(
                            {
                                requestInfo, base_version, resourceType,
                                operation: 'create', args,
                                ids: createdItems.map(r => r['id'])
                            }
                        );
                    }
                    if (updatedItems && updatedItems.length > 0) {
                        await this.auditLogger.logAuditEntryAsync(
                            {
                                requestInfo, base_version, resourceType,
                                operation: 'update', args,
                                ids: updatedItems.map(r => r['id'])
                            }
                        );
                    }
                }
            }

            const currentDate = moment.utc().format('YYYY-MM-DD');
            await this.auditLogger.flushAsync({requestId, currentDate, method});
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }
}

module.exports = {
    MergeManager
};
