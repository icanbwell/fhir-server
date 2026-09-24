// noinspection ExceptionCaughtLocallyJS

const { BadRequestError, NotFoundError, NotValidatedError } = require('../../utils/httpErrors');
const { validate } = require('fast-json-patch');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../preSaveHandlers/preSaveOptions');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { MongoGroupMemberRepository } = require('../../dataLayer/repositories/mongoGroupMemberRepository');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { ParsedArgs } = require('../query/parsedArgs');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../dataLayer/base64DataManager');
const { ConfigManager } = require('../../utils/configManager');
const { isTrue } = require('../../utils/isTrue');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { SearchManager } = require('../search/searchManager');
const { GRIDFS: { DELETE, RETRIEVE }, OPERATIONS: { WRITE }, ACCESS_LOGS_ENTRY_DATA, BLOB_OP } = require('../../constants');
const { ResourceMerger } = require('../common/resourceMerger');
const { ResourceValidator } = require('../common/resourceValidator');
const { DateColumnHandler } = require('../../preSaveHandlers/handlers/dateColumnHandler');
const httpContext = require('express-http-context');
const { PATCH_PATHS, PATCH_OPERATIONS } = require('../../constants/groupConstants');
const { createTooCostlyError } = require('../../utils/fhirErrorFactory');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { GroupMemberPatchStrategy } = require('./strategies/groupMemberPatchStrategy');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { IdentifierEnrichmentProvider } = require('../../enrich/providers/identifierEnrichmentProvider');
const { validatePatchDoesNotTargetInternalFields } = require('./validators/patchInternalFieldsValidator');
const { promoteExistingGroupIfNeeded, cleanupExtendedGroupOrphansIfNeeded } = require('../../utils/groupPromotion');
const { GroupExtendedTagEnrichmentProvider } = require('../../enrich/providers/groupExtendedTagEnrichmentProvider');

class PatchOperation {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {PreSaveManager} preSaveManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {ConfigManager} configManager
     * @param {SearchManager} searchManager
     * @param {ResourceMerger} resourceMerger
     * @param {ResourceValidator} resourceValidator
     * @param {import('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory} postSaveHandlerFactory
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
     * @param {import('../../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} mongoGroupMemberRepository
     */
    constructor (
        {
            databaseQueryFactory,
            postRequestProcessor,
            preSaveManager,
            fhirLoggingManager,
            scopesValidator,
            databaseBulkInserter,
            databaseAttachmentManager,
            base64DataManager,
            configManager,
            searchManager,
            resourceMerger,
            resourceValidator,
            postSaveHandlerFactory,
            identifierEnrichmentProvider,
            mongoGroupMemberRepository
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
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
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
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
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

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
         * @type {import('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory}
         */
        this.postSaveHandlerFactory = postSaveHandlerFactory;
        assertTypeEquals(postSaveHandlerFactory, require('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory);

        /**
         * @type {MongoGroupMemberRepository}
         */
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
        assertTypeEquals(mongoGroupMemberRepository, MongoGroupMemberRepository);

        /**
         * Strategy for handling resource-specific PATCH operations
         *
         * NOTE: When adding a second strategy (e.g., ObservationComponentPatchStrategy),
         * refactor to use a PatchStrategyFactory to avoid violating Open/Closed Principle:
         *
         * this.patchStrategyFactory = new PatchStrategyFactory({...});
         * this.patchStrategyFactory.register('Group', GroupMemberPatchStrategy);
         * this.patchStrategyFactory.register('Observation', ObservationComponentPatchStrategy);
         *
         * Then in patchAsync:
         * const strategy = this.patchStrategyFactory.getStrategy(resourceType);
         *
         * @type {GroupMemberPatchStrategy}
         */
        this.groupMemberPatchStrategy = new GroupMemberPatchStrategy({
            postSaveHandlerFactory: this.postSaveHandlerFactory,
            configManager: this.configManager,
            resourceMerger: this.resourceMerger,
            databaseBulkInserter: this.databaseBulkInserter,
            mongoGroupMemberRepository: this.mongoGroupMemberRepository
        });

        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);
    }

    /**
     * does a FHIR Patch
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{id: string,created: boolean, resource_version: string, resource: Resource}>}
     */
    async patchAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'patch';
        const extraInfo = {
            currentOperationName
        };
        const {
            /** @type {string} */
            requestId,
            body: patchContent,
            /** @type {import('content-type').ContentType} */
            contentTypeFromHeader,
            /** @type {string|null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {boolean} */
            isUser,
            /** @type {string} */
            personIdFromJwtToken,
            /** @type {string} */
            path
        } = requestInfo;

        // currently we only support JSONPatch
        if (!contentTypeFromHeader || contentTypeFromHeader.type !== fhirContentTypes.jsonPatch) {
            const message = `Content-Type ${contentTypeFromHeader ? contentTypeFromHeader.type : ''} ` +
                'is not supported for patch. ' +
                `Only ${fhirContentTypes.jsonPatch} is supported.`;
            throw new BadRequestError(
                {
                    message,
                    toString: function () {
                        return message;
                    }
                }
            );
        }

        // Reject any patch operations targeting internal _ fields before any DB work
        validatePatchDoesNotTargetInternalFields(patchContent);

        /**
         * @type {number}
         */
        const startTime = Date.now();

        await this.scopesValidator.verifyHasValidScopesAsync({
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action: currentOperationName,
            accessRequested: 'write'
        });

        try {
            // http://hl7.org/fhir/http.html#patch
            // patchContent is passed in JSON Patch format https://jsonpatch.com/
            const { base_version, id } = parsedArgs;

            // ============ SPECIAL HANDLING FOR GROUP MEMBER OPERATIONS ============
            // For extended-storage Groups (ClickHouse or Mongo-native), member operations bypass
            // MongoDB array updates and write directly per the Group's member type (FHIR R4B
            // PATCH with a pragmatic RFC 6902 extension). Detecting that a patch touches /member
            // can happen before the Group is fetched; determining *which* group member type (or
            // none, for a plain embedded Group) needs the loaded document, so that determination
            // is deferred below.
            let groupMemberOperations = null;
            let hasOnlyMemberOperations = false;
            let effectivePatchContent = patchContent;
            // Set below, only when groupMemberType === 'extended': prepareExtendedMemberWrites()
            // never touches the Group's meta or writes anything -- it only parses, validates,
            // enriches, and resolves the member ops into per-row write decisions (create/
            // update/delete/none per GroupMember_4_0_0 row). Those resolved writes are committed
            // further down, via commitPendingMemberWrites(), AFTER the ordinary non-member
            // patch flow (below, completely unmodified) has bumped and persisted the Group's
            // real, final version -- there is only ever one place metadata gets computed, so one
            // PATCH request (member-only or mixed with other fields alike) produces exactly one
            // Group_4_0_0_History row and one N -> N+1 bump, not two.
            let pendingMemberWrites = null;
            let hasPendingMemberWrites = false;
            let pendingMemberWritesSourceAssigningAuthority = null;
            const memberOpsResult = this.groupMemberPatchStrategy.detectMemberOperations({
                patchContent,
                resourceType
            });
            // ====================================================================

            // Get current record
            // Query our collection for this observation
            /**
             * @type {Resource}
             */
            let foundResource;
            /**
             * @type {boolean}
             */
            const useAccessIndex = (this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex));

            /**
             * @type {{base_version, columns: Set, query: import('mongodb').Document}}
             */
            const {
                /** @type {import('mongodb').Document}**/
                query
                // /** @type {Set} **/
                // columns
            } = await this.searchManager.constructQueryAsync({
                user,
                scope,
                isUser,
                resourceType,
                useAccessIndex,
                personIdFromJwtToken,
                parsedArgs,
                operation: WRITE,
                accessRequested: 'write'
            });
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );

            const cursor = await databaseQueryManager.findAsync({ query, extraInfo });
            /**
             * @type {[Resource] | null}
             */
            const resources = await cursor.toObjectArrayAsync();

            if (resources.length > 1) {
                const sourceAssigningAuthorities = resources.flatMap(
                    r => r.meta && r.meta.security
                        ? r.meta.security
                            .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                            .map(tag => tag.code)
                        : []
                ).sort();
                throw new BadRequestError(new Error(
                    `Multiple resources found with id ${id}.  ` +
                    'Please either specify the owner/sourceAssigningAuthority tag: ' +
                    sourceAssigningAuthorities.map(sa => `${id}|${sa}`).join(' or ') +
                    ' OR use uuid to query.'
                ));
            } else if (resources.length === 0) {
                throw new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            }
            foundResource = resources[0];
            if (!foundResource) {
                throw new NotFoundError('Resource not found');
            }

            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo, resource: foundResource, base_version
            });

            // ============ EXECUTE GROUP MEMBER OPERATIONS (AFTER VALIDATION) ============
            // Now that we've validated the resource exists and user has access, determine which
            // group member type (if any) should handle the member ops. A plain embedded Group
            // determines to 'embedded' and falls through to the standard patch flow below,
            // completely unmodified -- its member[] add/remove already works via ordinary JSON
            // Patch array semantics, no new code needed. 'extended' and 'externalStorage' are
            // two entirely separate branches below, each calling its own dedicated strategy
            // method -- they don't share a commit path, so a change to one type's write
            // semantics can't silently affect the other.
            const groupMemberType = memberOpsResult
                ? this.groupMemberPatchStrategy.determineGroupMemberType({ requestInfo, foundResource })
                : null;

            if (groupMemberType === 'externalStorage') {
                groupMemberOperations = memberOpsResult.memberOps;
                hasOnlyMemberOperations = memberOpsResult.hasOnlyMemberOperations;
                if (!hasOnlyMemberOperations) {
                    // Mixed patch: will handle member ops now, then continue with non-member ops
                    effectivePatchContent = memberOpsResult.nonMemberOps;
                }

                const updatedResource = await this.groupMemberPatchStrategy.executeMemberOperations({
                    requestInfo,
                    parsedArgs,
                    resourceType,
                    id,
                    base_version,
                    memberOperations: groupMemberOperations,
                    foundResource
                });
                // If only member operations, update metadata and return
                if (hasOnlyMemberOperations) {
                    return await this.groupMemberPatchStrategy.buildMemberPatchResponse({
                        requestInfo,
                        parsedArgs,
                        resourceType,
                        id,
                        base_version,
                        updatedResource
                    });
                }
                // Mixed operations: continue with non-member patch below
            } else if (groupMemberType === 'extended') {
                // Mongo-native: always parse/resolve here, never write here -- the ordinary
                // non-member PATCH flow below always performs the Group's one-and-only version
                // bump (member-only or mixed with other fields alike), then the resolved writes
                // are committed right after it lands.
                groupMemberOperations = memberOpsResult.memberOps;
                hasOnlyMemberOperations = memberOpsResult.hasOnlyMemberOperations;
                effectivePatchContent = memberOpsResult.nonMemberOps;

                ({
                    pendingMemberWrites,
                    hasPendingMemberWrites,
                    sourceAssigningAuthority: pendingMemberWritesSourceAssigningAuthority
                } = await this.groupMemberPatchStrategy.prepareExtendedMemberWrites({
                    base_version,
                    memberOperations: groupMemberOperations,
                    foundResource
                }));
                // Always continue with the non-member flow below -- it now handles member-only
                // (effectivePatchContent empty, forced to bump via hasPendingMemberWrites) and
                // mixed patches identically.
            }
            // ====================================================================

            const originalResource = foundResource.clone();
            foundResource = await this.databaseAttachmentManager.transformAttachments(
                foundResource, RETRIEVE, effectivePatchContent
            );
            foundResource = await this.base64DataManager.transformAsync(
                foundResource, BLOB_OP.RETRIEVE, requestInfo
            );

            // Validate the patch
            const errors = validate(effectivePatchContent, foundResource);
            if (errors) {
                const error = Array.isArray(errors) && errors.length && errors.find(e => !!e) ? errors.find(e => !!e) : errors;
                throw new BadRequestError(error);
            }
            // Make the changes indicated in the patch
            /**
             * @type {Object}
             */
            const resource_incoming = this.resourceMerger.applyPatch({
                currentResource: foundResource, patchContent: effectivePatchContent
            });
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.createByResourceType(resource_incoming, resourceType);

            // DCON-4841: this must run whenever foundResource has metadata, not just when a
            // meta.source happens to be present -- overWriteNonWritableFields is what reverts any
            // attempted change to the owner/sourceAssigningAuthority tags and meta.source/versionId/
            // lastUpdated, so gating it on meta.source left resources with no meta.source on either
            // side (e.g. a deployment with REQUIRE_META_SOURCE_TAGS=false) able to have those fields
            // freely rewritten via PATCH -- a naming-convention-only blocklist elsewhere isn't enough
            // since none of those fields start with '_'.
            if (foundResource?.meta) {
                this.resourceMerger.overWriteNonWritableFields({
                    currentResource: foundResource, resourceToMerge: resource
                });
            }

            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            resource = await this.preSaveManager.preSaveAsync({ resource, options: preSaveOptions });

            // SEC-1580 F2/F3: the pre-patch check above ran against originalResource as stored, so any
            // access tag the patch itself added or removed still needs to be validated. JSON patch ops
            // are explicit adds/removes/replaces (not an append-only smart merge), so a code missing from
            // the patched resource is a real removal
            this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                requestInfo, currentResource: originalResource, updatedResource: resource
            });

            /**
             * @type {OperationOutcome|null}
             */
            let validationOperationOutcome = this.resourceValidator.validateResourceMetaSync(
                resource_incoming
            );
            if (!validationOperationOutcome) {
                validationOperationOutcome = await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: resource.id,
                    resourceType: resource.resourceType,
                    resourceToValidate: resource,
                    path,
                    resourceObj: resource,
                    currentResource: foundResource
                });
            }
            if (validationOperationOutcome) {
                httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                    operationResult: [{
                        id: foundResource.id,
                        uuid: foundResource._uuid,
                        sourceAssigningAuthority: foundResource._sourceAssigningAuthority,
                        resourceType: foundResource.resourceType,
                        operationOutcome: validationOperationOutcome,
                        created: false,
                        updated: false
                    }]
                });
                throw new NotValidatedError(validationOperationOutcome);
            }
            const dateColumnHandler = new DateColumnHandler();
            dateColumnHandler.setFlag(true);
            foundResource = await dateColumnHandler.preSaveAsync({ resource: foundResource });

            const appliedPatchContent = this.resourceMerger.compareObjects({
                currentObject: foundResource.toJSON(),
                mergedObject: resource.toJSON()
            });

            // hasPendingMemberWrites forces entry even when the non-member ops alone produced no
            // diff (appliedPatchContent.length === 0) -- true for every extended-regime
            // member-only patch (there are no non-member ops to diff at all), and also for a
            // mixed patch whose non-member half happened to be a no-diff. A pending member-roster
            // write still needs a real, fresh version bump in either case; skipping it here
            // would let two genuinely different member states share the same versionId. It's
            // already false, not just "no pending writes", when every requested write resolved
            // to a genuine no-op (e.g. removing an already-absent member) -- prepareExtendedMemberWrites
            // resolved that above, so an all-none member patch still correctly skips the bump
            // here even when it's the only thing in the request.
            if (appliedPatchContent.length > 0 || hasPendingMemberWrites) {
                this.resourceMerger.updateMeta({
                    patched_resource_incoming: resource,
                    currentResource: foundResource,
                    original_source: foundResource.meta?.source,
                    incrementVersion: true
                });

                // removing the files that are patched
                await this.databaseAttachmentManager.transformAttachments(
                    originalResource, DELETE, appliedPatchContent.filter(patch => patch.op !== 'add')
                );

                // converting attachment.data to attachment._file_id for the response
                resource = await this.databaseAttachmentManager.transformAttachments(resource);
                // TODO: remove alwaysCreateNew when this operation is updated to be version aware
                resource = await this.base64DataManager.transformAsync(resource, BLOB_OP.INSERT, requestInfo, { alwaysCreateNew: true });

                // A no-op unless resource is already extended, per its own guard -- reading that
                // flag here, before promoteExistingGroupIfNeeded below has a chance to run, is
                // what makes this safe: a not-yet-extended Group's flag is still false/undefined
                // at this point, so this can't mistake the fresh rows promoteGroup is about to
                // write for a forward-dangling orphan and delete them (running this the other way
                // round did exactly that -- see cleanupExtendedGroupOrphansIfNeeded's own
                // docstring). This patch may be metadata-only (no member ops in the request at
                // all), so this must still run unconditionally, not only alongside
                // groupMemberPatchStrategy's member handling.
                await cleanupExtendedGroupOrphansIfNeeded({
                    doc: resource,
                    requestInfo,
                    base_version,
                    configManager: this.configManager,
                    mongoGroupMemberRepository: this.mongoGroupMemberRepository
                });

                // An embedded Group whose member[] crosses groupMemberLimit via a standard
                // JSON-Patch add on /member is promoted here, before it's staged for its own
                // write. resource._uuid/_sourceAssigningAuthority are already
                // set (carried forward from foundResource). No-op for non-Group resources and for
                // an already-extended Group (whose resolved member writes are committed
                // separately below via groupMemberPatchStrategy.commitPendingMemberWrites).
                await promoteExistingGroupIfNeeded({
                    doc: resource,
                    requestInfo,
                    base_version,
                    configManager: this.configManager,
                    mongoGroupMemberRepository: this.mongoGroupMemberRepository
                });

                if (hasPendingMemberWrites) {
                    await this.groupMemberPatchStrategy.commitPendingMemberWrites({
                        requestInfo,
                        base_version,
                        groupUuid: resource._uuid,
                        groupVersionId: parseInt(resource.meta.versionId, 10),
                        groupLastUpdated: resource.meta.lastUpdated,
                        sourceAssigningAuthority: pendingMemberWritesSourceAssigningAuthority,
                        securityTags: resource.meta.security,
                        pendingMemberWrites
                    });
                }

                // Same as update from this point on
                // Insert/update our resource record
                const contextData = buildContextDataForHybridStorage(resourceType, resource, requestInfo);

                // Member ops are owned end-to-end by groupMemberPatchStrategy (ClickHouse already
                // wrote them above; the Mongo-native ones are committed right after this block) --
                // either way, skip the generic post-save member processing that would otherwise
                // try to handle them too.
                if (groupMemberOperations && groupMemberOperations.length > 0 && contextData) {
                    contextData.groupMemberEventsWritten = true;
                }

                await this.databaseBulkInserter.replaceOneAsync(
                    {
                        base_version,
                        requestInfo,
                        resourceType,
                        doc: resource,
                        uuid: resource._uuid,
                        patches: effectivePatchContent.map(
                            p => {
                                return {
                                    op: p.op,
                                    path: p.path,
                                    value: p.value
                                };
                            }
                        ),
                        contextData
                    }
                );
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
                    throw new BadRequestError(new Error(JSON.stringify(mergeResults[0].issue, getCircularReplacer())));
                }
                httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                    operationResult: mergeResults
                });
            }

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action: currentOperationName
            });

            // converting attachment._file_id to attachment.data for the response
            resource = await this.databaseAttachmentManager.transformAttachments(resource, RETRIEVE);
            resource = await this.base64DataManager.transformAsync(resource, BLOB_OP.RETRIEVE, requestInfo);

            // enrich resource
            this.identifierEnrichmentProvider.enrichIdentifierList(resource);
            GroupExtendedTagEnrichmentProvider.addExtendedTagIfNeeded(resource);
            resource = FhirResourceSerializer.serialize(resource.toJSONInternal());

            return {
                id: resource.id,
                created: false,
                updated: true,
                resource_version: resource.meta.versionId,
                resource
            };
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
    PatchOperation
};
