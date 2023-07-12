const {logDebug, logError} = require('../common/logging');
const deepcopy = require('deepcopy');
const {ForbiddenError, BadRequestError} = require('../../utils/httpErrors');
const moment = require('moment-timezone');
const env = require('var');
const sendToS3 = require('../../utils/aws-s3');
const {isTrue} = require('../../utils/isTrue');
const {groupByLambda, findDuplicateResourcesByUuid, findUniqueResourcesByUuid} = require('../../utils/list.util');
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
const {MergeResultEntry} = require('../common/mergeResultEntry');
const {MongoFilterGenerator} = require('../../utils/mongoFilterGenerator');
const {DatabaseAttachmentManager} = require('../../dataLayer/databaseAttachmentManager');
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
     * @param {MongoFilterGenerator} mongoFilterGenerator
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
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
            configManager,
            mongoFilterGenerator,
            databaseAttachmentManager
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

        /**
         * @type {MongoFilterGenerator}
         */
        this.mongoFilterGenerator = mongoFilterGenerator;
        assertTypeEquals(mongoFilterGenerator, MongoFilterGenerator);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
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
        let uuid = resourceToMerge._uuid;
        assertIsValid(uuid, `No uuid found for resource ${resourceToMerge.resourceType}/${resourceToMerge.id}`);

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
                foundResource.resourceType + ' with id ' + resourceToMerge.id);
        }

        await this.preSaveManager.preSaveAsync(currentResource);

        /**
         * @type {Resource|null}
         */
        const {updatedResource: patched_resource_incoming, patches} = await this.resourceMerger.mergeResourceAsync(
            {currentResource, resourceToMerge, databaseAttachmentManager: this.databaseAttachmentManager});

        if (this.configManager.logAllMerges) {
            await sendToS3('logs',
                resourceToMerge.resourceType,
                {
                    'old': currentResource,
                    'new': resourceToMerge,
                    'after': patched_resource_incoming
                },
                currentDate,
                uuid,
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
     * @param {string | null} user
     * @param {string|null} scope
     * @returns {Promise<void>}
     */
    async mergeInsertAsync(
        {
            requestId,
            resourceToMerge,
            user,
            scope,
        }
    ) {
        assertTypeEquals(resourceToMerge, Resource);
        // not found so insert
        logDebug(
            'Merging new resource',
            {
                user,
                args: {uuid: resourceToMerge._uuid, resource: resourceToMerge}
            }
        );

        if (!(this.scopesManager.isAccessToResourceAllowedBySecurityTags({
            resource: resourceToMerge, user, scope
        }))) {
            throw new ForbiddenError(
                'user ' + user + ' with scopes [' + scope + '] has no access to resource ' +
                resourceToMerge.resourceType + ' with id ' + resourceToMerge.id);
        }

        // Check if meta & meta.source exists in resourceToMerge
        if (this.configManager.requireMetaSourceTags && (!resourceToMerge.meta || !resourceToMerge.meta.source)) {
            throw new BadRequestError(new Error('Unable to create resource. Missing either metadata or metadata source.'));
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
        let uuid = resourceToMerge._uuid;
        assertIsValid(uuid, `No uuid for resource ${resourceToMerge.resourceType}/${resourceToMerge.id}`);

        if (resourceToMerge.meta && resourceToMerge.meta.lastUpdated && typeof resourceToMerge.meta.lastUpdated !== 'string') {
            resourceToMerge.meta.lastUpdated = new Date(resourceToMerge.meta.lastUpdated).toISOString();
        }

        if (isTrue(env.LOG_ALL_SAVES)) {
            await sendToS3('logs',
                resourceToMerge.resourceType,
                resourceToMerge,
                currentDate,
                uuid,
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
                let currentResource;

                if (this.databaseBulkLoader) {
                    currentResource = this.databaseBulkLoader.getResourceFromExistingList(
                        {
                            requestId,
                            resourceType: resourceToMerge.resourceType,
                            uuid
                        }
                    );
                } else {
                    currentResource = await databaseQueryManager.findOneAsync({
                        query:
                            this.mongoFilterGenerator.generateFilterForUuid(
                                {
                                    uuid
                                }
                            )
                    });
                }

                // check if resource was found in database or not
                if (currentResource && currentResource.meta) {
                    if (currentResource.meta.source || (resourceToMerge && resourceToMerge.meta && resourceToMerge.meta.source)) {
                        await this.mergeExistingAsync(
                            {
                                resourceToMerge, currentResource, user, scope, currentDate, requestId
                            }
                        );
                    } else if (this.configManager.requireMetaSourceTags) {
                        throw new BadRequestError(new Error(
                            'Unable to create resource. Missing either metadata or metadata source.'
                        ));
                    }
                } else {
                    resourceToMerge = await this.databaseAttachmentManager.transformAttachments(resourceToMerge);
                    await this.mergeInsertAsync({
                        requestId,
                        resourceToMerge,
                        user,
                        scope
                    });
                }
            } catch (e) {
                logError(
                    'Error with merging resource',
                    {
                        user: user,
                        args: {
                            resourceType: resourceToMerge.resourceType,
                            id: resourceToMerge.id,
                            sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                            error: e
                        }
                    }
                );
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
                                resourceToMerge.resourceType + '/' + resourceToMerge.id
                            ]
                        }
                    ]
                };
                if (isTrue(env.LOG_VALIDATION_FAILURES)) {
                    await sendToS3('errors',
                        resourceToMerge.resourceType,
                        resourceToMerge,
                        currentDate,
                        uuid,
                        'merge');
                    await sendToS3('errors',
                        resourceToMerge.resourceType,
                        operationOutcome,
                        currentDate,
                        uuid,
                        'merge_error');
                }
                throw new RethrownError(
                    {
                        message: 'Failed to load data',
                        error: e,
                        source: 'MergeManager',
                        args: {
                            id: resourceToMerge.id,
                            sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
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
            resources_incoming = await async.map(resources_incoming,
                async resource => await this.preSaveManager.preSaveAsync(resource));
            /**
             * @type {string[]}
             */
            const uuidsOfResources = resources_incoming.map(r => r._uuid);
            logDebug(
                'Merge received array',
                {
                    user,
                    args: {length: resources_incoming.length, id: uuidsOfResources}
                }
            );
            // find items without duplicates and run them in parallel
            // but items with duplicate ids should run in serial, so we can merge them properly (otherwise the first item
            //  may not finish adding to the db before the next item tries to merge
            /**
             * @type {Resource[]}
             */
            const duplicate_uuid_resources = findDuplicateResourcesByUuid(resources_incoming);
            /**
             * @type {Resource[]}
             */
            const non_duplicate_uuid_resources = findUniqueResourcesByUuid(resources_incoming);

            const mergeResourceFn = async (/** @type {Object} */ x) => await this.mergeResourceWithRetryAsync(
                {
                    resourceToMerge: x, resourceType,
                    user, currentDate, requestId, base_version, scope,
                });

            await Promise.all([
                async.map(non_duplicate_uuid_resources, mergeResourceFn), // run in parallel
                async.mapSeries(duplicate_uuid_resources, mergeResourceFn) // run in series
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
            resourceToMerge = await this.preSaveManager.preSaveAsync(resourceToMerge);

            // Insert/update our resource record
            await this.databaseBulkInserter.mergeOneAsync(
                {
                    requestId,
                    resourceType: resourceToMerge.resourceType,
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
            if (!id) {
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
                            diagnostics: 'resource is missing id',
                            expression: [
                                resourceType
                            ]
                        })
                    ]
                });
                const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;
                return new MergeResultEntry(
                    {
                        id: id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        created: false,
                        updated: false,
                        issue: issue,
                        operationOutcome: operationOutcome,
                        resourceType: resourceType
                    }
                );
            }
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
                return new MergeResultEntry(
                    {
                        id: id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        created: false,
                        updated: false,
                        issue: issue,
                        operationOutcome: operationOutcome,
                        resourceType: resourceType
                    }
                );
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
                    return new MergeResultEntry(
                        {
                            id: id,
                            uuid: resourceToMerge._uuid,
                            sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                            created: false,
                            updated: false,
                            issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                            operationOutcome: operationOutcome,
                            resourceType: resourceToMerge.resourceType
                        }
                    );
                }
            }

            //----- validate schema ----
            // Check if meta & meta.source exists in resource
            if (this.configManager.requireMetaSourceTags && (!resourceToMerge.meta || !resourceToMerge.meta.source)) {
                throw new BadRequestError(new Error('Unable to merge resource. Missing either metadata or metadata source.'));
            }
            // The FHIR validator wants meta.lastUpdated to be string instead of data
            // So we copy the resource and change meta.lastUpdated to string to pass the FHIR validator
            const resourceObjectToValidate = deepcopy(resourceToMerge.toJSON());
            // Truncate id to 64 so it passes the validator since we support more than 64 internally
            if (resourceObjectToValidate.id) {
                resourceObjectToValidate.id = resourceObjectToValidate.id.slice(0, 64);
            }
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
                currentDate: currentDate,
                resourceObj: resourceToMerge
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
     * @param {ParsedArgs} parsedArgs
     * @param {MergeResultEntry[]} mergeResults
     * @param {string} method
     * @returns {Promise<void>}
     */
    async logAuditEntriesForMergeResults(
        {
            requestInfo,
            requestId,
            base_version,
            parsedArgs,
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
                                operation: 'create', args: parsedArgs.getRawArgs(),
                                ids: createdItems.map(r => r.id)
                            }
                        );
                    }
                    if (updatedItems && updatedItems.length > 0) {
                        await this.auditLogger.logAuditEntryAsync(
                            {
                                requestInfo, base_version, resourceType,
                                operation: 'update', args: parsedArgs.getRawArgs(),
                                ids: updatedItems.map(r => r.id)
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
