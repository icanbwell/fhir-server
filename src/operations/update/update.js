const httpContext = require('express-http-context');
const moment = require('moment-timezone');
const { NotValidatedError, BadRequestError, PreconditionFailedError } = require('../../utils/httpErrors');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { ResourceValidator } = require('../common/resourceValidator');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { ResourceMerger } = require('../common/resourceMerger');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { logInfo } = require('../common/logging');
const { parseIfMatchVersionIds, normalizeETag } = require('../../utils/ifMatchHelper');
const { ParsedArgs } = require('../query/parsedArgs');
const { ConfigManager } = require('../../utils/configManager');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../dataLayer/base64DataManager');
const { IdParser } = require('../../utils/idParser');
const { GRIDFS: { RETRIEVE }, ACCESS_LOGS_ENTRY_DATA, BLOB_OP } = require('../../constants');
const { isUuid } = require('../../utils/uid.util');
const { SourceAssigningAuthorityColumnHandler } = require('../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../preSaveHandlers/handlers/uuidColumnHandler');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');
const { IdentifierEnrichmentProvider } = require('../../enrich/providers/identifierEnrichmentProvider');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { removeUnderscoreFieldsRecursive } = require('../../utils/removeUnderscoreFields');
const { rejectMemberOnExtendedGroupWrite } = require('../../utils/mongoGroupExtendedTag');
const { GroupExtendedTagEnrichmentProvider } = require('../../enrich/providers/groupExtendedTagEnrichmentProvider');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');
const deepcopy = require('deepcopy');
const { validateResource } = require('../../utils/validator.util');
const { recordValidationFailure, VALIDATION_STAGE, PATH } = require('../../utils/metrics');

/**
 * Update Operation
 */
class UpdateOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {ResourceValidator} resourceValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ResourceMerger} resourceMerger
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {SourceAssigningAuthorityColumnHandler} sourceAssigningAuthorityColumnHandler
     * @param {UuidColumnHandler} uuidColumnHandler
     * @param {import('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory} postSaveHandlerFactory
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
     * @param {GroupExtendedTagEnrichmentProvider} groupExtendedTagEnrichmentProvider
     */
    constructor (
        {
            databaseQueryFactory,
            auditLogger,
            postRequestProcessor,
            fhirLoggingManager,
            scopesValidator,
            resourceValidator,
            databaseBulkInserter,
            fastDatabaseBulkInserter,
            resourceMerger,
            configManager,
            databaseAttachmentManager,
            base64DataManager,
            sourceAssigningAuthorityColumnHandler,
            uuidColumnHandler,
            postSaveHandlerFactory,
            identifierEnrichmentProvider,
            groupExtendedTagEnrichmentProvider
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
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
        this.useFastSerializer = configManager.enableUpdateFastSerializer;

        if (this.useFastSerializer) {
            /**
             * @type {FastDatabaseBulkInserter}
             */
            this.databaseBulkInserter = fastDatabaseBulkInserter;
            assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);
        } else {
            /**
             * @type {DatabaseBulkInserter}
             */
            this.databaseBulkInserter = databaseBulkInserter;
            assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        }

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

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
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);

        /**
         * @type {SourceAssigningAuthorityColumnHandler}
         */
        this.sourceAssigningAuthorityColumnHandler = sourceAssigningAuthorityColumnHandler;
        assertTypeEquals(sourceAssigningAuthorityColumnHandler, SourceAssigningAuthorityColumnHandler);

        /**
         * @type {UuidColumnHandler}
         */
        this.uuidColumnHandler = uuidColumnHandler;
        assertTypeEquals(uuidColumnHandler, UuidColumnHandler);

        /**
         * @type {import('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory}
         */
        this.postSaveHandlerFactory = postSaveHandlerFactory;
        assertTypeEquals(postSaveHandlerFactory, require('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory);

        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);

        /**
         * @type {GroupExtendedTagEnrichmentProvider}
         */
        this.groupExtendedTagEnrichmentProvider = groupExtendedTagEnrichmentProvider;
        assertTypeEquals(groupExtendedTagEnrichmentProvider, GroupExtendedTagEnrichmentProvider);
    }

    /**
     * throws a NotValidatedError if the resource's meta tags are invalid
     * @param {Resource|Object} resource
     */
    assertResourceMetaIsValid (resource) {
        const validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(resource);
        if (validationOperationOutcome) {
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                operationResult: [{
                    id: resource.id,
                    uuid: resource._uuid,
                    sourceAssigningAuthority: resource._sourceAssigningAuthority,
                    resourceType: resource.resourceType,
                    operationOutcome: validationOperationOutcome,
                    created: false,
                    updated: false
                }]
            });
            throw new NotValidatedError(validationOperationOutcome);
        }
    }

    /**
     * does a FHIR Update (PUT)
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @returns {Promise<{id: string,created: boolean, resource_version: string, resource: Resource}>}
     */
    async updateAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);

        const currentOperationName = 'update';
        const extraInfo = {
            currentOperationName
        };
        // Query our collection for this observation
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string} */
            path,
            /** @type {Object} */
            body,
            /** @type {string|null} */
            requestId
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'write'
            }
        );

        // read the incoming resource from request body
        /**
         * @type {Object}
         */
        const resource_incoming_json = body;
        const { base_version, id } = parsedArgs;

        const originalIdParsedArg = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
        const { id: rawId, sourceAssigningAuthority: urlAuthority } = IdParser.parse(
            originalIdParsedArg?.queryParameterValue?.value ?? id
        );
        resource_incoming_json.id = rawId;

        // For resources with mongo-with-clickhouse dual-write storage, track if externally-stored fields present
        // Used later to force UPDATE even if MongoDB sees no changes (member array stripped before save).
        // A length check (not just !== undefined) is required here: this runs against the raw
        // request body, before FhirResourceCreator normalizes an explicit `member: []` away to
        // undefined, so an undefined check alone would treat an empty array as "has members".
        const hasMemberField = resourceType === 'Group' &&
            Array.isArray(resource_incoming_json.member) &&
            resource_incoming_json.member.length > 0;

        // Internal fields (_uuid, _sourceAssigningAuthority, _file_id, etc.) are never
        // legitimate client input -- they're always (re)computed server-side (pre-save
        // handlers overwrite them from the stored resource's own meta.security tags before
        // persist, and DatabaseAttachmentManager only ever sets _file_id after a real GridFS
        // upload). Strip them from the raw incoming payload before it's merged with the
        // stored resource, so a caller can't claim an arbitrary GridFS file id (belonging to
        // another resource/tenant) and have it read back later.
        removeUnderscoreFieldsRecursive(resource_incoming_json);

        // create a resource with incoming data
        /**
         * @type {Resource}
         */
        let resource_incoming = this.useFastSerializer
            ? resource_incoming_json
            : FhirResourceCreator.createByResourceType(resource_incoming_json, resourceType);

        try {
            let targetUuid = rawId;
            if (!isUuid(rawId)) {
                this.assertResourceMetaIsValid(resource_incoming_json);
                const resourceForUuid = await this.uuidColumnHandler.preSaveAsync({
                    resource: await this.sourceAssigningAuthorityColumnHandler.preSaveAsync({
                        resource: {
                            id: rawId,
                            resourceType,
                            meta: { security: [...resource_incoming_json.meta.security] }
                        }
                    })
                });
                if (urlAuthority && urlAuthority !== resourceForUuid._sourceAssigningAuthority) {
                    throw new BadRequestError(new Error(
                        `The sourceAssigningAuthority in the id (${rawId}|${urlAuthority}) does not match ` +
                        `the owner/sourceAssigningAuthority tag of the resource (${resourceForUuid._sourceAssigningAuthority})`
                    ));
                }
                targetUuid = resourceForUuid._uuid;
            }
            const query = { _uuid: targetUuid };

            // Get current record
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );

            const cursor = await databaseQueryManager.findAsync({ query, extraInfo });
            /**
             * @type {[Resource] | null}
             */
            const resources = this.useFastSerializer
                ? (await cursor.toArrayAsync()).map((r) => FhirResourceWriteSerializer.serialize({ obj: r }))
                : await cursor.toObjectArrayAsync();

            /**
             * @type {Resource | null}
             */
            const data = resources[0];
            /**
             * @type {OperationOutcome|null}
             */
            let validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                base_version,
                requestInfo,
                id: resource_incoming_json.id,
                resourceType,
                resourceToValidate: resource_incoming_json,
                path,
                resourceObj: resource_incoming,
                currentResource: data
            });
            if (this.useFastSerializer && !validationOperationOutcome) {
                resource_incoming = FhirResourceWriteSerializer.serialize({ obj: resource_incoming_json });
                validationOperationOutcome = validateResource({
                    resourceBody: resource_incoming,
                    resourceName: resourceType,
                    path
                });
                if (validationOperationOutcome) {
                    recordValidationFailure(validationOperationOutcome, resourceType, VALIDATION_STAGE.SCHEMA, PATH.SAVE);
                }
            }
            if (validationOperationOutcome) {
                httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                    operationResult: [{
                        id: resource_incoming_json.id,
                        uuid: data ? data._uuid : resource_incoming_json._uuid,
                        sourceAssigningAuthority: data ? data._sourceAssigningAuthority : resource_incoming_json._sourceAssigningAuthority,
                        resourceType: resource_incoming_json.resourceType,
                        operationOutcome: validationOperationOutcome,
                        created: false,
                        updated: false
                    }]
                });
                throw new NotValidatedError(validationOperationOutcome);
            }
            /**
             * @type {Resource|null}
             */
            let doc;

            /**
             * @type {Resource}
             */
            let foundResource;

            /**
             * @type {Resource}
             */
            let updatedResource;
            let patches;

            const ifMatch = requestInfo.headers && requestInfo.headers['if-match'];
            const versionIds = parseIfMatchVersionIds(ifMatch);
            // Per FHIR's "Managing Resource Contention" (http.html#concurrency), a server may
            // support only the wildcard form of If-None-Match -- that's the only variant with a
            // real write-side use case: "create this, but only if nothing exists here yet."
            const ifNoneMatch = requestInfo.headers && requestInfo.headers['if-none-match'];
            let precondition_failed_error;

            // check if resource was found in database or not
            // noinspection JSUnresolvedVariable
            if (data && data.meta) {
                // found an existing resource
                foundResource = data;
                await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo, resource: foundResource, base_version
                });
                // Extended Group's member[] doesn't exist on the live document -- a submitted
                // member must go through PATCH instead (design doc §5.1). Unconditional on
                // ENABLE_EXTENDED_GROUP (see rejectMemberOnExtendedGroupWrite's own docstring for
                // why), but only reached once the caller is already confirmed authorized above.
                rejectMemberOnExtendedGroupWrite({ currentResource: foundResource, hasMemberField });
                if (ifNoneMatch === '*') {
                    precondition_failed_error = new PreconditionFailedError(`Version conflict: If-None-Match: * was provided but resource already exists.`);
                    logInfo(precondition_failed_error.message);
                    throw precondition_failed_error;
                }
                // If-Match/version check logic (optimistic locking)
                if (ifMatch) {
                    if (data.meta.versionId) {
                        const currentVersionId = normalizeETag(String(data.meta.versionId));
                        if (!versionIds.includes(currentVersionId) && !versionIds.includes('*')) {
                            precondition_failed_error = new PreconditionFailedError(`Version conflict: If-Match does not match current resource version. Older version: ${currentVersionId}, If-Match: ${ifMatch}`);
                            logInfo(precondition_failed_error.message);
                            throw precondition_failed_error;
                        }
                    } else {
                        precondition_failed_error = new PreconditionFailedError(`Version conflict: Resource does not have a versionId, but If-Match header was provided. If-Match: ${ifMatch}`);
                        logInfo(precondition_failed_error.message);
                        throw precondition_failed_error;
                    }
                }
                const mergeMethod = this.useFastSerializer ? 'fastMergeResourceAsync' : 'mergeResourceAsync';
                ({ updatedResource, patches } = await this.resourceMerger[mergeMethod]({
                    base_version,
                    requestInfo,
                    currentResource: foundResource,
                    resourceToMerge: resource_incoming,
                    smartMerge: false,
                    databaseAttachmentManager: this.databaseAttachmentManager,
                    // Pass the base64 manager so the merge can exclude the externalized `data`
                    // field from the generic diff and reconcile it directly by hash, without ever
                    // downloading it — see Base64DataManager.excludeExternalizedLeaves /
                    // reconcileLeavesAsync and resourceMerger.mergeResourceAsync.
                    base64DataManager: this.base64DataManager
                }));
                doc = updatedResource;

                // Check if dual-write storage fields changed
                // If so, force the update even if mergeResourceAsync returned null (MongoDB sees no changes)
                const postSaveHandlers2 = this.postSaveHandlerFactory.getHandlers(resourceType);
                if (!doc && postSaveHandlers2.length > 0) {
                    // Check resource-specific mongo-with-clickhouse dual-write storage
                    // Currently only Group.member uses dual-write (MongoDB + ClickHouse)
                    if (hasMemberField) {
                        doc = resource_incoming;
                    }
                    // Future: Add other mongo-with-clickhouse dual-write resources here
                }
            } else {
                if (ifMatch) {
                    precondition_failed_error = new PreconditionFailedError(`Version conflict: Resource does not exist, but If-Match header was provided. If-Match: ${ifMatch}`);
                    logInfo(precondition_failed_error.message);
                    throw precondition_failed_error;
                }
                doc = resource_incoming;
            }
            if (doc) {
                // Validating resource meta tags
                this.assertResourceMetaIsValid(doc);
                // Update attachments after all validations
                doc = await this.databaseAttachmentManager.transformAttachments(doc);
                // TODO: remove alwaysCreateNew when this operation is updated to be version aware
                doc = await this.base64DataManager.transformAsync(doc, BLOB_OP.INSERT, requestInfo, { alwaysCreateNew: true });

                if (data && data.meta) {
                    // SEC-1580 F2: the pre-merge check above ran against foundResource as stored, so the
                    // access tags the merge (smartMerge: false, so a full replace) took from the incoming
                    // body still need to be validated before the merged doc is persisted
                    this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo, currentResource: foundResource, updatedResource: doc
                    });

                    const contextData = buildContextDataForHybridStorage(resourceType, doc, requestInfo);

                    await this.databaseBulkInserter.replaceOneAsync(
                        {
                            base_version,
                            requestInfo,
                            resourceType,
                            doc,
                            uuid: doc._uuid,
                            patches,
                            contextData,
                            ifMatchVersionIds: versionIds
                        }
                    );
                } else {
                    // not found so insert
                    doc.meta.versionId = '1';
                    doc.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
                    await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                        resource: doc, requestInfo, base_version
                    });
                    // SEC-1580 F3: this is a create-via-PUT, so the "old" access tag set is empty and
                    // every access tag on doc counts as an addition the caller must be authorized for
                    this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                        requestInfo, currentResource: null, updatedResource: doc
                    });

                    const contextData = buildContextDataForHybridStorage(resourceType, doc, requestInfo);

                    await this.databaseBulkInserter.insertOneAsync({
                        base_version,
                        requestInfo,
                        resourceType,
                        doc,
                        contextData,
                        rejectIfExists: ifNoneMatch === '*'
                    });
                }
            }

            if (doc) {
                /**
                 * @type {MergeResultEntry[]}
                 */
                const mergeResults = await this.databaseBulkInserter.executeAsync(
                    {
                        requestInfo,
                        base_version
                    }
                );
                if (!mergeResults || mergeResults.length === 0 || (!mergeResults[0].created && !mergeResults[0].updated)) {
                    throw new BadRequestError(
                        new Error(mergeResults.length > 0
                            ? JSON.stringify(mergeResults[0].issue, getCircularReplacer())
                            : 'No merge result'
                        )
                    );
                }

                if (resourceType !== 'AuditEvent') {
                    const resourceUuid = doc._uuid;
                    this.postRequestProcessor.add({
                        requestId,
                        fnTask: async () => {
                            // log access to audit logs
                            await this.auditLogger.logAuditEntryAsync(
                                {
                                    requestInfo,
                                    base_version,
                                    resourceType,
                                    operation: currentOperationName,
                                    args: parsedArgs.getRawArgs(),
                                    ids: [resourceUuid]
                                }
                            );
                        }
                    });
                }

                // after-save handlers hold the saved doc, so build the response from a copy
                doc = this.useFastSerializer ? deepcopy(doc) : doc;
                // changing the attachment._file_id to attachment.data for response
                doc = await this.databaseAttachmentManager.transformAttachments(doc, RETRIEVE);
                doc = await this.base64DataManager.transformAsync(doc, BLOB_OP.RETRIEVE, requestInfo);

                const result = {
                    id,
                    created: mergeResults[0].created,
                    resource_version: doc.meta.versionId,
                    resource: doc
                };
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                    operationResult: mergeResults
                });

                // enrich resource
                this.identifierEnrichmentProvider.enrichIdentifierList(result.resource);
                [result.resource] = await this.groupExtendedTagEnrichmentProvider.enrichAsync({ resources: [result.resource] });
                result.resource = FhirResourceSerializer.serialize(
                    this.useFastSerializer ? result.resource : result.resource.toJSONInternal()
                );

                return result;
            } else {
                await this.databaseAttachmentManager.transformAttachments(foundResource, RETRIEVE);
                await this.base64DataManager.transformAsync(foundResource, BLOB_OP.RETRIEVE, requestInfo);

                const result = {
                    id,
                    created: false,
                    updated: false,
                    resource_version: foundResource?.meta?.versionId,
                    resource: foundResource
                };

                // not modified
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName
                });
                httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                    operationResult: [{
                        created: false,
                        updated: false,
                        id: foundResource.id,
                        uuid: foundResource._uuid,
                        sourceAssigningAuthority: foundResource._sourceAssigningAuthority,
                        resourceType: foundResource.resourceType
                    }]
                });

                // enrich resource
                this.identifierEnrichmentProvider.enrichIdentifierList(result.resource);
                [result.resource] = await this.groupExtendedTagEnrichmentProvider.enrichAsync({ resources: [result.resource] });
                result.resource = FhirResourceSerializer.serialize(
                    this.useFastSerializer ? result.resource : result.resource.toJSONInternal()
                );

                return result;
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }
}

module.exports = {
    UpdateOperation
};
