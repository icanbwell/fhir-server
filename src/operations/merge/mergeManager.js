const async = require('async');
const deepcopy = require('deepcopy');
const moment = require('moment-timezone');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError } = require('../../utils/httpErrors');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { DatabaseBulkLoader } = require('../../dataLayer/databaseBulkLoader');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { MergeResultEntry } = require('../common/mergeResultEntry');
const { MongoFilterGenerator } = require('../../utils/mongoFilterGenerator');
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

class MergeManager {
    /**
     * Constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {ScopesManager} scopesManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceMerger} resourceMerger
     * @param {ResourceValidator} resourceValidator
     * @param {PreSaveManager} preSaveManager
     * @param {ConfigManager} configManager
     * @param {MongoFilterGenerator} mongoFilterGenerator
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
            mongoFilterGenerator,
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
         * @type {MongoFilterGenerator}
         */
        this.mongoFilterGenerator = mongoFilterGenerator;
        assertTypeEquals(mongoFilterGenerator, MongoFilterGenerator);

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
     * @param {Resource} resourceToMerge
     * @param {Resource} currentResource
     * @param {string} currentDate
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<OperationOutcome|null>}
     */
    async mergeExistingAsync ({
        resourceToMerge,
        currentResource,
        currentDate,
        base_version,
        requestInfo
    }) {
        assertTypeEquals(resourceToMerge, Resource);
        assertTypeEquals(currentResource, Resource);
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
         * @type {Resource|null}
         */
        const {
            updatedResource: patched_resource_incoming, patches
        } = await this.resourceMerger.mergeResourceAsync({
            base_version,
            requestInfo,
            currentResource,
            resourceToMerge,
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
            if (!validationOperationOutcome) {
                validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: patched_resource_incoming.id,
                    resourceType: patched_resource_incoming.resourceType,
                    resourceToValidate: patched_resource_incoming,
                    path: requestInfo.path,
                    currentDate,
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
     * @param {string} currentDate
     * @param {Resource} resourceToMerge
     * @returns {Promise<OperationOutcome|null>}
     */
    async mergeInsertAsync ({
        base_version,
        requestInfo,
        currentDate,
        resourceToMerge
    }) {
        assertTypeEquals(resourceToMerge, Resource);
        // not found so insert
        logDebug(
            'Merging new resource',
            {
                args: { uuid: resourceToMerge._uuid, resource: resourceToMerge }
            }
        );

        if (resourceToMerge.meta) {
            resourceToMerge.meta.versionId = '1';
            resourceToMerge.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        }

        /**
         * Validate resource to create with fhir schema
         * @type {OperationOutcome|null}
         */
        const validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
            base_version,
            requestInfo,
            id: resourceToMerge.id,
            resourceType: resourceToMerge.resourceType,
            resourceToValidate: resourceToMerge,
            path: requestInfo.path,
            currentDate,
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
     * @param {Resource} resourceToMerge
     * @param {string} resourceType
     * @param {string} currentDate
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @return {Promise<MergeResultEntry|null>}
     */
    async mergeResourceAsync (
        {
            resourceToMerge,
            resourceType,
            currentDate,
            base_version,
            requestInfo
        }
    ) {
        assertTypeEquals(resourceToMerge, Resource);
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
            // Query our collection for this id
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType: resourceToMerge.resourceType, base_version }
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
                    query: this.mongoFilterGenerator.generateFilterForUuid({ uuid })
                });
            }

            let validationError;
            // check if resource was found in database or not
            if (currentResource && currentResource.meta) {
                validationError = await this.mergeExistingAsync({
                    resourceToMerge, currentResource, currentDate, requestInfo, base_version
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
                    currentDate,
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
                            text: 'Error merging: ' + JSON.stringify(resourceToMerge.toJSON())
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
                    source: 'MergeManager',
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
         * @type {{string: Resource[]}}
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
         * @type {string[]}
         */
        const duplicateResources = [];
        /**
         * @type {Resource[]}
         */
        const mergedResources = [];
        Object.values(resourceGroups).forEach((duplicateResourceArray) => {
            if (duplicateResourceArray.length > 1) {
                duplicateResources.push(duplicateResourceArray[0].id);
            }
            mergedResources.push(
                duplicateResourceArray.reduce((mergedResource, resource) => {
                    if (resource instanceof Resource) {
                        const mergedObject = mergeObject(mergedResource, resource.toJSONInternal());
                        return resource.create(mergedObject);
                    } else {
                        return mergeObject(mergedResource, resource);
                    }
                }, {})
            );
        });

        if (duplicateResources.length > 0) {
            logWarn(
                'Resource with same body is present multiple times in the request body, ' +
                `resource ids are ${duplicateResources.join(', ')}`
            );
        }

        return mergedResources;
    }

    /**
     * merges a list of resources
     * @param {Resource[]} resources_incoming
     * @param {string} resourceType
     * @param {string} currentDate
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<{resource: (Resource|null), mergeError: (MergeResultEntry|null)}[]>}
     */
    async mergeResourceListAsync (
        {
            resources_incoming,
            resourceType,
            currentDate,
            base_version,
            requestInfo
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
                currentDate,
                base_version,
                requestInfo
            });

            /**
             * @type {{resource: (Resource|null), mergeError: (MergeResultEntry|null)}[]}
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
     * @param {Resource} resourceToMerge
     * @param {string} resourceType
     * @param {string} currentDate
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @return {Promise<{resource: Resource|null, mergeError: MergeResultEntry|null}>}
     */
    async mergeResourceWithRetryAsync (
        {
            resourceToMerge,
            resourceType,
            currentDate,
            base_version,
            requestInfo
        }
    ) {
        assertTypeEquals(resourceToMerge, Resource);
        try {
            const mergeError = await this.mergeResourceAsync({
                resourceToMerge,
                resourceType,
                currentDate,
                base_version,
                requestInfo
            });
            return { resource: resourceToMerge, mergeError };
        } catch (error) {
            return { resource: null, mergeError: MergeResultEntry.createFromError({ error, resource: resourceToMerge }) }
        }
    }

    /**
     * performs the db update
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resourceToMerge
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
            assertTypeEquals(resourceToMerge, Resource);
            resourceToMerge = await this.preSaveManager.preSaveAsync({
                resource: resourceToMerge
            });

            // Update attachments after all validations
            resourceToMerge = await this.databaseAttachmentManager.transformAttachments(resourceToMerge);

            // Insert/update our resource record
            await this.databaseBulkInserter.mergeOneAsync(
                {
                    base_version,
                    requestInfo,
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
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resourceToMerge
     * @returns {Promise<void>}
     */
    async performMergeDbInsertAsync (
        {
            base_version,
            requestInfo,
            resourceToMerge
        }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertTypeEquals(resourceToMerge, Resource);
        try {
            assertTypeEquals(resourceToMerge, Resource);
            await this.preSaveManager.preSaveAsync({
                resource: resourceToMerge
            });
            // Update attachments after all validations
            resourceToMerge = await this.databaseAttachmentManager.transformAttachments(resourceToMerge);

            // Insert/update our resource record
            await this.databaseBulkInserter.insertOneAsync({
                    base_version,
                    requestInfo,
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
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<MergeResultEntry|null>}
     */
    async preMergeChecksAsync ({
        requestInfo,
        resourceToMerge,
        resourceType
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertTypeEquals(resourceToMerge, Resource);
        try {
            /**
             * @type {string} id
             */
            const id = resourceToMerge.id;
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
                        id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        created: false,
                        updated: false,
                        issue,
                        operationOutcome,
                        resourceType
                    }
                );
            }
            if (!resourceToMerge.resourceType) {
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
                        id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        created: false,
                        updated: false,
                        issue,
                        operationOutcome,
                        resourceType
                    }
                );
            }
            if (
                !isUuid(resourceToMerge.id) &&
                !this.scopesManager.doesResourceHaveSourceAssigningAuthority(resourceToMerge) &&
                !this.scopesManager.doesResourceHaveOwnerTags(resourceToMerge)
            ) {
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
                            diagnostics: 'Either id passed in resource should be uuid or meta.security tag with system: https://www.icanbwell.com/owner or https://www.icanbwell.com/sourceAssigningAuthority should be present',
                            expression: [
                                resourceType + '/' + id
                            ]
                        })
                    ]
                });
                const issue = (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null;
                return new MergeResultEntry(
                    {
                        id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        created: false,
                        updated: false,
                        issue,
                        operationOutcome,
                        resourceType
                    }
                );
            }

            const forbiddenError = this.scopesValidator.verifyHasValidScopes({
                requestInfo,
                resourceType: resourceToMerge.resourceType,
                accessRequested: 'write'
            });

            if (forbiddenError) {
                const operationOutcome = new OperationOutcome({
                    issue: forbiddenError.issue
                });

                return new MergeResultEntry(
                    {
                        id,
                        uuid: resourceToMerge._uuid,
                        sourceAssigningAuthority: resourceToMerge._sourceAssigningAuthority,
                        created: false,
                        updated: false,
                        issue: (operationOutcome.issue && operationOutcome.issue.length > 0) ? operationOutcome.issue[0] : null,
                        operationOutcome,
                        resourceType: resourceToMerge.resourceType
                    }
                );
            }

            // ----- validate schema ----
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
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource[]} resourcesToMerge
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], validResources: Resource[]}>}
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
             * @type {Resource[]}
             */
            const validResources = [];
            for (const /** @type {Resource} */ r of resourcesToMerge) {
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
    MergeManager
};
