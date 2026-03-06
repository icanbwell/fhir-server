// noinspection ExceptionCaughtLocallyJS

const { BadRequestError, NotFoundError, NotValidatedError } = require('../../utils/httpErrors');
const { validate } = require('fast-json-patch');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { fhirContentTypes } = require('../../utils/contentTypes');
const { ParsedArgs } = require('../query/parsedArgs');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { ConfigManager } = require('../../utils/configManager');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { isTrue } = require('../../utils/isTrue');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { SearchManager } = require('../search/searchManager');
const { GRIDFS: { DELETE, RETRIEVE }, OPERATIONS: { WRITE }, ACCESS_LOGS_ENTRY_DATA } = require('../../constants');
const { ResourceMerger } = require('../common/resourceMerger');
const { ResourceValidator } = require('../common/resourceValidator');
const { DateColumnHandler } = require('../../preSaveHandlers/handlers/dateColumnHandler');
const httpContext = require('express-http-context');
const { PATCH_PATHS, PATCH_OPERATIONS } = require('../../constants/groupConstants');
const { createTooCostlyError } = require('../../utils/fhirErrorFactory');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { GroupMemberPatchStrategy } = require('./strategies/groupMemberPatchStrategy');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');

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
     * @param {ConfigManager} configManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {SearchManager} searchManager
     * @param {ResourceMerger} resourceMerger
     * @param {ResourceValidator} resourceValidator
     * @param {import('../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory} postSaveHandlerFactory
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
            configManager,
            bwellPersonFinder,
            searchManager,
            resourceMerger,
            resourceValidator,
            postSaveHandlerFactory
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
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

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
            databaseBulkInserter: this.databaseBulkInserter
        });
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
            // For storage-synced Groups, member operations bypass MongoDB array updates
            // and write directly to event log (FHIR R4B PATCH with RFC 6902)
            // IMPORTANT: We detect member ops early but validate/write AFTER security checks below
            let groupMemberOperations = null;
            let hasOnlyMemberOperations = false;
            let effectivePatchContent = patchContent;
            const memberOpsResult = this.groupMemberPatchStrategy.detectMemberOperations({
                patchContent,
                resourceType
            });
            if (memberOpsResult) {
                groupMemberOperations = memberOpsResult.memberOps;
                hasOnlyMemberOperations = memberOpsResult.hasOnlyMemberOperations;

                if (!hasOnlyMemberOperations) {
                    // Mixed patch: will handle member ops after validation, then continue with non-member ops
                    effectivePatchContent = memberOpsResult.nonMemberOps;
                }
            }
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
            // Now that we've validated the resource exists and user has access, handle member operations
            if (groupMemberOperations && groupMemberOperations.length > 0) {
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
            }
            // ====================================================================

            const originalResource = foundResource.clone();
            foundResource = await this.databaseAttachmentManager.transformAttachments(
                foundResource, RETRIEVE, effectivePatchContent
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

            // source in metadata must exist either in incoming resource or found resource
            if (foundResource?.meta && (foundResource.meta.source || (resource?.meta?.source))) {
                this.resourceMerger.overWriteNonWritableFields({
                    currentResource: foundResource, resourceToMerge: resource
                });
            }

            resource = await this.preSaveManager.preSaveAsync({ resource });

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

            if (appliedPatchContent.length > 0) {
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

                // Same as update from this point on
                // Insert/update our resource record
                const contextData = buildContextDataForHybridStorage(resourceType, resource);

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
