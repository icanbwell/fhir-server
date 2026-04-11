const async = require('async');
const moment = require('moment-timezone');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError } = require('../../utils/httpErrors');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { DatabaseBulkLoader } = require('../../dataLayer/databaseBulkLoader');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { MergeResultEntry } = require('../common/mergeResultEntry');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ResourceMerger } = require('../common/resourceMerger');
const { ResourceValidator } = require('../common/resourceValidator');
const { RethrownError } = require('../../utils/rethrownError');
const { ScopesManager } = require('../security/scopesManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { logDebug, logError, logWarn } = require('../common/logging');
const { groupByLambda } = require('../../utils/list.util');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
const { mergeObject } = require('../../utils/mergeHelper');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { FhirResourceWriteNormalizeSerializer } = require('../../fhir/fhirResourceWriteNormalizeSerializer');
const { COLLECTION } = require('../../constants');

class FastMergeManager {
    /**
     * Constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {ScopesManager} scopesManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceMerger} resourceMerger
     * @param {ResourceValidator} resourceValidator
     * @param {PreSaveManager} preSaveManager
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor (
        {
            databaseQueryFactory,
            auditLogger,
            databaseBulkInserter,
            databaseBulkLoader,
            scopesManager,
            scopesValidator,
            resourceMerger,
            resourceValidator,
            preSaveManager,
            configManager,
            databaseAttachmentManager,
            postRequestProcessor
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
         * @type {FastDatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, FastDatabaseBulkInserter);
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
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

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
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    /**
     * resource to merge
     * @param {Object} resourceToMerge
     * @param {Object} currentResource
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {boolean} smartMerge
     * @returns {Promise<OperationOutcome|null>}
     */
    async mergeExistingAsync ({
        resourceToMerge,
        currentResource,
        base_version,
        requestInfo,
        smartMerge=true
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);

        /**
         * @type {string}
         */
        const uuid = resourceToMerge._uuid;
        assertIsValid(uuid, `No uuid found for resource ${resourceToMerge.resourceType}/${resourceToMerge.id}`);

        // found an existing resource
        currentResource = await this.preSaveManager.preSaveAsync({
            resource: currentResource
        });

        /**
         * @type {Object|null}
         */
        const {
            updatedResource: patched_resource_incoming, patches
        } = await this.resourceMerger.fastMergeResourceAsync({
            base_version,
            requestInfo,
            currentResource,
            resourceToMerge,
            smartMerge,
            limitToPaths: undefined,
            databaseAttachmentManager: this.databaseAttachmentManager
        });
        if (patched_resource_incoming) {
            /**
             * @type {OperationOutcome|null}
             */
            let validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(
                patched_resource_incoming
            );

            const resourceToValidate = deepcopy(patched_resource_incoming);
            FhirResourceWriteNormalizeSerializer.serialize({obj: resourceToValidate});

            if (!validationOperationOutcome) {
                validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: patched_resource_incoming.id,
                    resourceType: patched_resource_incoming.resourceType,
                    resourceToValidate,
                    path: requestInfo.path,
                    resourceObj: patched_resource_incoming,
                    currentResource
                });
            }
            if (validationOperationOutcome) {
                return validationOperationOutcome;
            }

            await this.performMergeDbUpdateAsync({
                    base_version,
                    requestInfo,
                    resourceToMerge: patched_resource_incoming,
                    previousVersionId: currentResource.meta.versionId,
                    patches
                }
            );
            return null;
        }
    }

    /**
     * merge insert
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} resourceToMerge
     * @returns {Promise<OperationOutcome|null>}
     */
    async mergeInsertAsync ({
        base_version,
        requestInfo,
        resourceToMerge
    }) {
        // not found so insert
        logDebug(
            'Merging new resource',
            {
                args: { uuid: resourceToMerge._uuid, resource: resourceToMerge }
            }
        );

        if (resourceToMerge.meta) {
            resourceToMerge.meta.versionId = '1';
            resourceToMerge.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        }

        const resourceToValidate = deepcopy(resourceToMerge);
        FhirResourceWriteNormalizeSerializer.serialize({obj: resourceToValidate});

        /**
         * Validate resource to create with fhir schema
         * @type {Object|null}
         */
        const validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
            base_version,
            requestInfo,
            id: resourceToMerge.id,
            resourceType: resourceToMerge.resourceType,
            resourceToValidate,
            path: requestInfo.path,
            resourceObj: resourceToMerge
        });

        if (validationOperationOutcome) {
            return validationOperationOutcome;
        }

        await this.performMergeDbInsertAsync({
            base_version,
            requestInfo,
            resourceToMerge
        });
        return null;
    }

    /**
     * Merges a single resource
     * @param {Object} resourceToMerge
     * @param {string} resourceType
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {boolean} smartMerge
     * @return {Promise<MergeResultEntry|null>}
     */
    async mergeResourceAsync (
        {
            resourceToMerge,
            resourceType,
            base_version,
            requestInfo,
            smartMerge=true
        }
    ) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const {
            /** @type {string|null} */
            user,
            /** @type {string} */
            requestId
        } = requestInfo;
        /**
         * @type {string}
         */
        const uuid = resourceToMerge._uuid;
        assertIsValid(uuid, `No uuid for resource ${resourceToMerge.resourceType}/${resourceToMerge.id}`);

        if (resourceToMerge.meta && resourceToMerge.meta.lastUpdated && typeof resourceToMerge.meta.lastUpdated !== 'string') {
            resourceToMerge.meta.lastUpdated = new Date(resourceToMerge.meta.lastUpdated).toISOString();
        }

        try {
            /**
             * @type {Object|null}
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
                // Query our collection for this id
                const databaseQueryManager = this.databaseQueryFactory.createQuery(
                    { resourceType: resourceToMerge.resourceType, base_version }
                );

                currentResource = await databaseQueryManager.fastFindOneAsync({
                    query: { _uuid: uuid.toString() }
                });
            }

            let validationError;
            // check if resource was found in database or not
            if (currentResource && currentResource.meta) {
                validationError = await this.mergeExistingAsync({
                    resourceToMerge, currentResource, requestInfo, base_version, smartMerge
                });
            } else {
                // Check if meta & meta.source exists in resource
                if (this.configManager.requireMetaSourceTags && (!resourceToMerge.meta || !resourceToMerge.meta.source)) {
                    throw new BadRequestError(
                        new Error(
                            'Unable to merge resource. Missing either metadata or metadata source.'
                        )
                    );
                }
                validationError = await this.mergeInsertAsync({
                    base_version,
                    requestInfo,
                    resourceToMerge
                });
            }

            if (validationError) {
                return new MergeResultEntry({
                    id: resourceToMerge.id,
                    uuid: resourceToMerge._uuid,
                    sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                    resourceType: resourceToMerge.resourceType,
                    created: false,
                    updated: false,
                    issue: (validationError.issue && validationError.issue.length > 0) ? validationError.issue[0] : null,
                    operationOutcome: validationError
                });
            }
            return null;
        } catch (e) {
            logError(
                'Error with merging resource',
                {
                    user,
                    args: {
                        resourceType: resourceToMerge.resourceType,
                        id: resourceToMerge.id,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        error: e
                    }
                }
            );
            const operationOutcome = new OperationOutcome({
                resourceType: 'OperationOutcome',
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'exception',
                        details: {
                            text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                        },
                        diagnostics: e.toString(),
                        expression: [
                            resourceToMerge.resourceType + '/' + resourceToMerge.id
                        ]
                    })
                ]
            });
            throw new RethrownError(
                {
                    message: e.message,
                    error: e,
                    source: 'FastMergeManager',
                    args: new MergeResultEntry({
                        id: resourceToMerge.id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        resourceType,
                        created: false,
                        updated: false,
                        issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                        operationOutcome
                    })
                }
            );
        }
    }

    /**
     * merges duplicate resources present in the list
     * @param {Object[]} resources
     * @returns {Object[]}
     */
    mergeDuplicateResourceEntries (resources) {
        if (!Array.isArray(resources)) {
            return resources;
        }
        /**
         * @type {{string: Object[]}}
         */
        const resourceGroups = groupByLambda(resources, resource => {
            if (
                !isUuid(resource?.id) &&
                (
                    resource?.meta?.security?.some(s => s.system === SecurityTagSystem.owner) ||
                    resource?.meta?.security?.some(s => s.system === SecurityTagSystem.sourceAssigningAuthority)
                )
            ) {
                const sourceAssigningAuthority =
                    resource?.meta?.security?.find(s => s.system === SecurityTagSystem.sourceAssigningAuthority)?.code ||
                    resource?.meta?.security?.find(s => s.system === SecurityTagSystem.owner)?.code;

                return generateUUIDv5(`${resource?.id}|${sourceAssigningAuthority}|${resource?.resourceType}`);
            }
            return generateUUIDv5(`${resource?.id}|${resource?.resourceType}`);
        });

        /**
         * @type {Object[]}
         */
        const mergedResources = [];
        Object.values(resourceGroups).forEach((duplicateResourceArray) => {
            if (duplicateResourceArray.length > 1) {
                const mergedResource = duplicateResourceArray.reduce(
                    (mergedResource, resource) => mergeObject(mergedResource, resource),
                    {}
                );
                mergedResources.push(FhirResourceWriteSerializer.serialize({obj: mergedResource}));
            } else {
                mergedResources.push(duplicateResourceArray[0]);
            }
        });

        return mergedResources;
    }

    /**
     * merges a list of resources
     * @param {Object[]} resources_incoming
     * @param {string} resourceType
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {boolean} smartMerge
     * @returns {Promise<{resource: (Object|null), mergeError: (MergeResultEntry|null)}[]>}
     */
    async mergeResourceListAsync (
        {
            resources_incoming,
            resourceType,
            base_version,
            requestInfo,
            smartMerge = true
        }
    ) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        try {
            /**
             * @type {string[]}
             */
            const uuidsOfResources = resources_incoming.map(r => r._uuid);
            logDebug('Merge received array', {
                user: requestInfo.user,
                args: { length: resources_incoming.length, id: uuidsOfResources }
            });

            /**
             * @type {number}
             */
            const chunkSize = this.configManager.mergeParallelChunkSize;
            const mergeResourceFn = async (/** @type {Object} */ x) => await this.mergeResourceWithRetryAsync({
                resourceToMerge: x,
                resourceType,
                base_version,
                requestInfo,
                smartMerge
            });

            /**
             * @type {{resource: (Object|null), mergeError: (MergeResultEntry|null)}[]}
             */
            const result = await async.mapLimit(
                resources_incoming,
                chunkSize,
                mergeResourceFn
            );
            return result.filter(r => (r.resource || r.mergeError));
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
     * @param {Object} resourceToMerge
     * @param {string} resourceType
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {boolean} smartMerge
     * @return {Promise<{resource: (Object|null), mergeError: (MergeResultEntry|null)}>}
     */
    async mergeResourceWithRetryAsync (
        {
            resourceToMerge,
            resourceType,
            base_version,
            requestInfo,
            smartMerge=true
        }
    ) {
        try {
            const mergeError = await this.mergeResourceAsync({
                resourceToMerge,
                resourceType,
                base_version,
                requestInfo,
                smartMerge
            });
            return { resource: resourceToMerge, mergeError };
        } catch (error) {
            return { resource: null,
                mergeError: MergeResultEntry.createFromError({ error,
                    resource: resourceToMerge
                })
            };
        }
    }

    /**
     * performs the db update
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} resourceToMerge
     * @param {string} previousVersionId
     * @param {MergePatchEntry[]} patches
     * @returns {Promise<void>}
     */
    async performMergeDbUpdateAsync (
        {
            base_version,
            requestInfo,
            resourceToMerge,
            previousVersionId,
            patches
        }
    ) {
        try {
            resourceToMerge = await this.preSaveManager.preSaveAsync({
                resource: resourceToMerge
            });

            // Update attachments after all validations
            resourceToMerge = await this.databaseAttachmentManager.transformAttachments(resourceToMerge);

            // Insert/update our resource record
            const contextData = buildContextDataForHybridStorage(resourceToMerge.resourceType, resourceToMerge, requestInfo);

            await this.databaseBulkInserter.mergeOneAsync(
                {
                    base_version,
                    requestInfo,
                    resourceType: resourceToMerge.resourceType,
                    doc: resourceToMerge,
                    previousVersionId,
                    patches,
                    contextData
                }
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error updating: ${JSON.stringify(resourceToMerge)}`,
                error: e
            });
        }
    }

    /**
     * performs the db insert
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} resourceToMerge
     * @returns {Promise<void>}
     */
    async performMergeDbInsertAsync (
        {
            base_version,
            requestInfo,
            resourceToMerge
        }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        try {
            await this.preSaveManager.preSaveAsync({
                resource: resourceToMerge
            });
            // Update attachments after all validations
            resourceToMerge = await this.databaseAttachmentManager.transformAttachments(resourceToMerge);

            // Insert/update our resource record
            const contextData = buildContextDataForHybridStorage(resourceToMerge.resourceType, resourceToMerge, requestInfo);

            await this.databaseBulkInserter.insertOneAsync({
                    base_version,
                    requestInfo,
                    resourceType: resourceToMerge.resourceType,
                    doc: resourceToMerge,
                    contextData
                }
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error inserting: ${JSON.stringify(resourceToMerge)}`,
                error: e
            });
        }
    }

    /**
     * Helper to create error response with OperationOutcome and MergeResultEntry
     * @param {Object} resourceToMerge
     * @param {string} resourceType
     * @param {string} diagnostics
     * @param {string} expression
     * @returns {MergeResultEntry}
     */
    createMergeError(resourceToMerge, resourceType, diagnostics, expression) {
        const operationOutcome = new OperationOutcome({
            resourceType: 'OperationOutcome',
            issue: [
                new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'exception',
                    details: new CodeableConcept({
                        text: 'Error merging: ' + JSON.stringify(resourceToMerge)
                    }),
                    diagnostics,
                    expression: [expression]
                })
            ]
        });

        return new MergeResultEntry({
            id: resourceToMerge.id,
            uuid: resourceToMerge._uuid,
            sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
            created: false,
            updated: false,
            issue: operationOutcome.issue?.[0] || null,
            operationOutcome,
            resourceType
        });
    }

    /**
     * run any pre-checks before merge
     * @param {Object} resourceToMerge
     * @param {string} resourceType
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<MergeResultEntry|null>}
     */
    async preMergeChecksAsync ({
        requestInfo,
        resourceToMerge,
        resourceType
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        try {
            const id = resourceToMerge.id;

            if (!id) {
                return this.createMergeError(resourceToMerge, resourceType, 'resource is missing id', resourceType);
            }

            if (!resourceToMerge.resourceType) {
                return this.createMergeError(resourceToMerge, resourceType, 'resource is missing resourceType', `${resourceType}/${id}`);
            }

            if (COLLECTION[resourceToMerge.resourceType.toUpperCase()] !== resourceToMerge.resourceType) {
                return this.createMergeError(resourceToMerge, resourceType, 'resourceType is not supported', `${resourceType}/${id}`);
            }

            if (
                !isUuid(resourceToMerge.id) &&
                !this.scopesManager.doesResourceHaveSourceAssigningAuthority(resourceToMerge) &&
                !this.scopesManager.doesResourceHaveOwnerTags(resourceToMerge)
            ) {
                return this.createMergeError(
                    resourceToMerge,
                    resourceType,
                    'Either id passed in resource should be uuid or meta.security tag with system: https://www.icanbwell.com/owner or https://www.icanbwell.com/sourceAssigningAuthority should be present',
                    `${resourceType}/${id}`
                );
            }

            const forbiddenError = await this.scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: resourceToMerge.resourceType,
                accessRequested: 'write'
            });

            if (forbiddenError) {
                const operationOutcome = new OperationOutcome({
                    issue: forbiddenError.issue
                });

                return new MergeResultEntry({
                    id,
                    uuid: resourceToMerge._uuid,
                    sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                    created: false,
                    updated: false,
                    issue: operationOutcome.issue?.[0] || null,
                    operationOutcome,
                    resourceType: resourceToMerge.resourceType
                });
            }

            return null;
        } catch (e) {
            throw new RethrownError({
                message: `Error pre merge checks: ${JSON.stringify(resourceToMerge)}`,
                error: e
            });
        }
    }

    /**
     * run any pre-checks on multiple resources before merge
     * @param {FhirRequestInfo} requestInfo
     * @param {Object[]} resourcesToMerge
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], validResources: Object[]}>}
     */
    async preMergeChecksMultipleAsync (
        {
            requestInfo,
            resourcesToMerge
        }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertIsValid(Array.isArray(resourcesToMerge), 'resourcesToMerge should be an array');
        try {
            /**
             * @type {MergeResultEntry[]}
             */
            const mergePreCheckErrors = [];
            /**
             * @type {Object[]}
             */
            const validResources = [];
            for (const /** @type {Object} */ r of resourcesToMerge) {
                /**
                 * @type {MergeResultEntry|null}
                 */
                const mergeResult = await this.preMergeChecksAsync(
                    {
                        requestInfo,
                        resourceToMerge: r,
                        resourceType: r.resourceType
                    }
                );
                if (mergeResult) {
                    mergePreCheckErrors.push(mergeResult);
                } else {
                    validResources.push(r);
                }
            }
            return { mergePreCheckErrors, validResources };
        } catch (e) {
            throw new RethrownError({
                message: 'Error in FastMergeManager.preMergeChecksMultipleAsync()',
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
     * @returns {Promise<void>}
     */
    async logAuditEntriesForMergeResults (
        {
            requestInfo,
            requestId,
            base_version,
            parsedArgs,
            mergeResults
        }
    ) {
        try {
            assertIsValid(requestInfo);
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    /**
                     * merge results grouped by resourceType
                     * @type {Object}
                     */
                    const groupByResourceType = groupByLambda(mergeResults, (mergeResult) => {
                        return mergeResult.resourceType;
                    });

                    for (const [resourceType, mergeResultsForResourceType] of Object.entries(
                        groupByResourceType
                    )) {
                        if (resourceType !== 'AuditEvent') {
                            // we don't log queries on AuditEvent itself
                            /**
                             * @type {MergeResultEntry[]}
                             */
                            const createdItems = mergeResultsForResourceType.filter(
                                (r) => r.created === true
                            );
                            /**
                             * @type {MergeResultEntry[]}
                             */
                            const updatedItems = mergeResultsForResourceType.filter(
                                (r) => r.updated === true
                            );
                            if (createdItems && createdItems.length > 0) {
                                await this.auditLogger.logAuditEntryAsync({
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: 'create',
                                    args: parsedArgs.getRawArgs(),
                                    ids: createdItems.map((r) => r.id)
                                });
                            }
                            if (updatedItems && updatedItems.length > 0) {
                                await this.auditLogger.logAuditEntryAsync({
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: 'update',
                                    args: parsedArgs.getRawArgs(),
                                    ids: updatedItems.map((r) => r.id)
                                });
                            }
                        }
                    }
                }
            });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }
}

module.exports = {
    FastMergeManager
};
