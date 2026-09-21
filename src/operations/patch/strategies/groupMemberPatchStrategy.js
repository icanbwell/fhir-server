const { BadRequestError } = require('../../../utils/httpErrors');
const { PATCH_PATHS, PATCH_OPERATIONS } = require('../../../constants/groupConstants');
const { createTooCostlyError } = require('../../../utils/fhirErrorFactory');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { buildContextDataForHybridStorage, USE_EXTERNAL_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');
const { isTrue } = require('../../../utils/isTrue');
const { enrichMemberReferences } = require('../../../utils/referenceEnricher');

/**
 * Strategy for handling Group.member PATCH operations
 *
 * Implements member management for Groups, against one of two group member types, with very
 * different underlying write models:
 * - ClickHouse (per-request `useexternalstorage` header) -- genuinely event-sourced; writes
 *   events to the ClickHouse event log via the Group's registered post-save handler.
 * - Mongo-native "extended" storage (permanent, internal, non-FHIR marker field on the Group
 *   resource class, design doc §3.1, DCON-5527) -- a plain resource write, not an event log:
 *   each requested add/remove resolves directly to a create/update/delete of a
 *   GroupMember_4_0_0 row through MongoGroupMemberRepository, targeting GroupMember_4_0_0 /
 *   GroupMember_4_0_0_History via the shared write pipeline. Split across two dedicated methods
 *   so patch.js's ordinary non-member PATCH flow can own the Group's one-and-only version bump:
 *   prepareExtendedMemberWrites() only parses, validates, enriches, and resolves each op into a
 *   write decision (it never writes), and commitPendingMemberWrites() writes the already-resolved
 *   rows once that bump has landed -- for both member-only and mixed requests alike. This keeps
 *   the two group member types on entirely separate methods, so a change to one type's commit
 *   semantics can't silently affect the other.
 *
 * Both types bypass MongoDB array updates on Group.member itself -- only the Group's own
 * metadata (versionId/lastUpdated) is written to Group_4_0_0. A plain embedded Group (neither
 * type) takes membership changes through the standard FHIR PATCH flow further down in
 * patch.js -- this strategy never runs for it (see determineGroupMemberType).
 *
 * Design: Single Responsibility Principle
 * - Encapsulates all Group member PATCH logic
 * - Separates from generic FHIR PATCH operation
 * - Makes patch.js focused on standard FHIR operations
 */
class GroupMemberPatchStrategy {
    /**
     * @param {Object} params
     * @param {import('../../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory} params.postSaveHandlerFactory
     * @param {import('../../../utils/configManager').ConfigManager} params.configManager
     * @param {import('../../common/resourceMerger').ResourceMerger} params.resourceMerger
     * @param {import('../../../dataLayer/databaseBulkInserter').DatabaseBulkInserter} params.databaseBulkInserter
     * @param {import('../../../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
     */
    constructor({
        postSaveHandlerFactory,
        configManager,
        resourceMerger,
        databaseBulkInserter,
        mongoGroupMemberRepository
    }) {
        this.postSaveHandlerFactory = postSaveHandlerFactory;
        this.configManager = configManager;
        this.resourceMerger = resourceMerger;
        this.databaseBulkInserter = databaseBulkInserter;
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
    }

    /**
     * Detects if patch contains Group member operations, regardless of which group member type
     * (if any) will end up handling them -- that decision is determineGroupMemberType's job,
     * made once the Group document is loaded.
     *
     * @param {Object} params
     * @param {Array<Object>} params.patchContent - JSON Patch operations
     * @param {string} params.resourceType - FHIR resource type
     * @returns {{memberOps: Array<Object>, nonMemberOps: Array<Object>, hasOnlyMemberOperations: boolean} | null}
     */
    detectMemberOperations({ patchContent, resourceType }) {
        if (resourceType !== 'Group') {
            return null;
        }

        const isMemberPath = (path) =>
            path === PATCH_PATHS.MEMBER_PREFIX ||
            path.startsWith(PATCH_PATHS.MEMBER_PREFIX + '/') ||
            path.startsWith(PATCH_PATHS.MEMBER_PREFIX + '-');
        const memberOps = patchContent.filter(op => isMemberPath(op.path));
        const nonMemberOps = patchContent.filter(op => !isMemberPath(op.path));

        if (memberOps.length === 0) {
            return null;
        }

        return {
            memberOps,
            nonMemberOps,
            hasOnlyMemberOperations: nonMemberOps.length === 0
        };
    }

    /**
     * Determines which type of Group member storage (if any) should handle a Group's member
     * PATCH ops, once the Group document itself has been loaded. The Mongo-native trigger is
     * checked first and wins unconditionally: it's a permanent, tamper-resistant internal field
     * on the hydrated Group resource itself (design doc §3.1) -- a recognized class property,
     * generated the same way as _uuid/_access, so it reads straight off foundResource with no
     * separate lookup -- recording a fixed per-Group storage fact, not a per-call choice. Once a
     * Group is extended, its real roster lives entirely in GroupMember_4_0_0; foundResource.member
     * doesn't exist to diff against, so the ClickHouse flow (which needs exactly that) could never
     * work correctly against it regardless of what header a caller sends. ClickHouse's own trigger
     * is a per-request opt-in header, but only takes effect if a ClickHouse post-save handler is
     * actually registered for Group (i.e. ENABLE_CLICKHOUSE + MONGO_WITH_CLICKHOUSE_RESOURCES) --
     * if ClickHouse is disabled server-side, the header is ignored rather than routing to a
     * backend with nowhere to write, matching the pre-refactor behavior of
     * detectMemberOperations's old `handlers.length === 0` guard.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {Resource} params.foundResource - the loaded Group
     * @returns {'externalStorage'|'extended'|'embedded'}
     */
    determineGroupMemberType({ requestInfo, foundResource }) {
        if (foundResource._extended === true) {
            if (!this.configManager.enableExtendedGroup) {
                throw new BadRequestError(new Error(
                    `Group ${foundResource.id || foundResource._uuid} uses a member-management feature ` +
                    'that is disabled on this server.'
                ));
            }
            return 'extended';
        }

        if (isTrue(requestInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER]) &&
            this.postSaveHandlerFactory.getHandlers(foundResource.resourceType).length > 0
        ) {
            return 'externalStorage';
        }

        return 'embedded';
    }

    /**
     * Executes member operations against the ClickHouse event log, for a Group with the
     * 'useexternalstorage' header set.
     *
     * IMPORTANT: Called AFTER security validation has passed
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {string} params.id - Group ID
     * @param {string} params.base_version
     * @param {Array<Object>} params.memberOperations - JSON Patch operations on /member
     * @param {Resource} params.foundResource - The validated Group resource from MongoDB
     * @returns {Promise<Resource>} The updated Group resource
     */
    async executeMemberOperations({
        requestInfo,
        parsedArgs,
        resourceType,
        id,
        base_version,
        memberOperations,
        foundResource
    }) {
        const groupId = id;

        const postSaveHandlers = this.postSaveHandlerFactory.getHandlers(resourceType);
        if (postSaveHandlers.length === 0) {
            throw new Error('No post-save handlers available for Group resource');
        }
        const groupHandler = postSaveHandlers[0];

        // 1. Enforce operations limit (empirically determined)
        const MAX_PATCH_OPERATIONS = this.configManager.groupPatchOperationsLimit;
        if (memberOperations.length > MAX_PATCH_OPERATIONS) {
            const batchCount = Math.ceil(memberOperations.length / MAX_PATCH_OPERATIONS);
            const { message, options } = createTooCostlyError({
                actual: memberOperations.length,
                limit: MAX_PATCH_OPERATIONS,
                operation: 'PATCH',
                customGuidance: `For writes: Split into ${batchCount} batches of ${MAX_PATCH_OPERATIONS} operations each`
            });
            throw new BadRequestError({ message }, options);
        }

        // 2. Parse member operations into add/remove events
        // IMPORTANT: Do NOT use fast-json-patch here. We're not applying patches to a document.
        // We're translating operations directly to event-sourced storage sync events.
        const eventsToAdd = [];
        const eventsToRemove = [];

        for (const op of memberOperations) {
            const isValidMemberPath = op.path === PATCH_PATHS.MEMBER_PATH || op.path === PATCH_PATHS.MEMBER_APPEND;

            // Validate required fields before accessing them
            if (isValidMemberPath && !op.value?.entity?.reference) {
                throw new BadRequestError({
                    message: `Missing required value.entity.reference in PATCH operation: ${JSON.stringify(op)}`,
                    toString: function () { return this.message; }
                }, {
                    issue: [new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'required',
                        diagnostics: 'Each member PATCH operation must include value.entity.reference'
                    })]
                });
            }

            if (op.op === PATCH_OPERATIONS.ADD && isValidMemberPath) {
                // RFC 6902: path "/member/-" means append to member array
                eventsToAdd.push({
                    entity: op.value.entity,
                    period: op.value.period,
                    inactive: op.value.inactive
                });
            } else if (op.op === PATCH_OPERATIONS.REMOVE && isValidMemberPath) {
                // Server-side extension: remove member by entity reference
                // Creates MEMBER_REMOVED event in ClickHouse event log
                // Note: This is a pragmatic extension for event sourcing (not standard RFC 6902)
                eventsToRemove.push({
                    entity: op.value.entity,
                    period: op.value.period,
                    inactive: op.value.inactive
                });
            } else {
                // UNSUPPORTED: remove by index (e.g., /member/0)
                // Would require reading current state to resolve index
                const message = `Unsupported PATCH operation on Group.member: ${op.op} ${op.path}. ` +
                    `Supported paths: "${PATCH_PATHS.MEMBER_PATH}" or "${PATCH_PATHS.MEMBER_APPEND}". ` +
                    `Supported operations: ` +
                    `1) Add member: {"op":"add","path":"${PATCH_PATHS.MEMBER_APPEND}","value":{"entity":{"reference":"Patient/123"}}} ` +
                    `2) Remove member: {"op":"remove","path":"${PATCH_PATHS.MEMBER_APPEND}","value":{"entity":{"reference":"Patient/123"}}}`;
                throw new BadRequestError({
                    message,
                    toString: function () {
                        return message;
                    }
                }, {
                    issue: [new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'not-supported',
                        diagnostics: message
                    })]
                });
            }
        }

        // 3. Validate sourceAssigningAuthority before any writes
        const sourceAssigningAuthority = foundResource._sourceAssigningAuthority;
        if (!sourceAssigningAuthority) {
            throw new Error(
                `Group ${foundResource.id || foundResource._uuid} has no _sourceAssigningAuthority; cannot enrich member references`
            );
        }

        // 4. Enrich member references with _uuid and _sourceId. PATCH bypasses the normal
        // pre-save pipeline (referenceGlobalIdHandler), so we must enrich references before
        // writing to ClickHouse.
        enrichMemberReferences(eventsToAdd, sourceAssigningAuthority);
        enrichMemberReferences(eventsToRemove, sourceAssigningAuthority);

        // 5. Update Group metadata in MongoDB FIRST (increment versionId, update lastUpdated)
        // IMPORTANT: Write MongoDB first, then ClickHouse (matches CREATE/UPDATE pattern)
        // Different write orders = different failure modes = unpredictable behavior
        const updatedResource = foundResource.clone ? foundResource.clone() : { ...foundResource };
        this.resourceMerger.updateMeta({
            patched_resource_incoming: updatedResource,
            currentResource: foundResource,
            original_source: foundResource.meta?.source,
            incrementVersion: true
        });

        // Build contextData and set flag to skip post-save handler
        // buildContextDataForHybridStorage now always returns an object for Groups (never null)
        const contextData = buildContextDataForHybridStorage(resourceType, foundResource, requestInfo);
        if (eventsToAdd.length > 0 || eventsToRemove.length > 0) {
            contextData.groupMemberEventsWritten = true;
        }

        // Update MongoDB metadata only (no member array)
        await this.databaseBulkInserter.replaceOneAsync({
            base_version,
            requestInfo,
            resourceType,
            doc: updatedResource,
            uuid: updatedResource._uuid,
            contextData
        });

        await this.databaseBulkInserter.executeAsync({
            requestInfo,
            base_version
        });

        // 6. Write events to ClickHouse (AFTER the Group's own MongoDB commit)
        if (eventsToAdd.length > 0 || eventsToRemove.length > 0) {
            // Direct translation: 1 operation = 1 event (added or removed). ClickHouse's event
            // log expects a concrete boolean, not undefined -- default a not-supplied inactive
            // to false here.
            await groupHandler.writeEventsAsync({
                groupId,
                added: eventsToAdd.map((event) => ({ ...event, inactive: event.inactive ?? false })),
                removed: eventsToRemove.map((event) => ({ ...event, inactive: event.inactive ?? false })),
                groupResource: updatedResource // Use updated resource with new versionId
            });
        }

        return updatedResource;
    }

    /**
     * Builds response for member-only PATCH
     * Returns Group metadata without the member array (members are in storage sync)
     *
     * SECURITY: This method is called AFTER the resource has been validated to exist
     * and the user's access has been verified by scopesValidator.
     *
     * NOTE: MongoDB update has already been performed by executeMemberOperations (correct write order)
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {string} params.id
     * @param {string} params.base_version
     * @param {Resource} params.updatedResource - The updated Group resource from executeMemberOperations
     * @returns {Promise<{id: string, created: boolean, resource_version: string, resource: Resource}>}
     */
    async buildMemberPatchResponse({
        requestInfo,
        parsedArgs,
        resourceType,
        id,
        base_version,
        updatedResource
    }) {

        // Return 200 OK with metadata only (no member array)
        return {
            id: updatedResource.id,
            created: false,
            updated: true,
            resource_version: updatedResource.meta.versionId,
            resource: updatedResource
        };
    }

    /**
     * Parses, validates, enriches, and resolves a Group PATCH's member operations into concrete
     * write decisions against the Mongo-native ("extended") roster in GroupMember_4_0_0 -- but
     * never writes anything and never touches the Group's own meta. Unlike ClickHouse's event
     * log, this regime's PATCH ops translate directly into real resource writes (create/update/
     * delete a GroupMember_4_0_0 row) -- there is no event stream to append to, so this method's
     * job is to figure out, ahead of time, exactly which kind of write each requested op will
     * need. patch.js's ordinary non-member PATCH flow always does the Group's one-and-only
     * version bump (using hasPendingMemberWrites to force a bump even for a member-only request
     * that produced no non-member diff), then commits these resolved writes via
     * commitPendingMemberWrites() once that bump has landed. This is the only behavior for
     * 'extended' -- there is no separate immediate-commit path for a pure member-only request,
     * so one Group PATCH always produces exactly one Group_4_0_0_History row regardless of
     * whether it's member-only or mixed with other fields.
     *
     * IMPORTANT: Called AFTER security validation has passed. Does NOT use fast-json-patch --
     * we're not applying patches to a document, we're resolving operations directly into
     * per-row write decisions, via resolveMemberWrite.
     *
     * @param {Object} params
     * @param {string} params.base_version
     * @param {Array<Object>} params.memberOperations - JSON Patch operations on /member
     * @param {Resource} params.foundResource - the loaded, extended Group
     * @returns {Promise<{pendingMemberWrites: Map, hasPendingMemberWrites: boolean, sourceAssigningAuthority: string}>}
     */
    async prepareExtendedMemberWrites({ base_version, memberOperations, foundResource }) {
        // 1. Enforce operations limit (empirically determined) -- same limit executeMemberOperations
        // enforces for ClickHouse.
        const MAX_PATCH_OPERATIONS = this.configManager.groupPatchOperationsLimit;
        if (memberOperations.length > MAX_PATCH_OPERATIONS) {
            const batchCount = Math.ceil(memberOperations.length / MAX_PATCH_OPERATIONS);
            const { message, options } = createTooCostlyError({
                actual: memberOperations.length,
                limit: MAX_PATCH_OPERATIONS,
                operation: 'PATCH',
                customGuidance: `For writes: Split into ${batchCount} batches of ${MAX_PATCH_OPERATIONS} operations each`
            });
            throw new BadRequestError({ message }, options);
        }

        // 2. Parse member operations into a single combined list of requested writes, tagging
        // each op inline with add/remove as it's encountered -- this preserves the client's
        // actual submitted sequence, unlike bucketing into separate add/remove arrays and
        // concatenating them back together (which would always place every remove after every
        // add regardless of the client's real op order, making resolveMemberWritesAsync's
        // last-wins-per-entity de-dupe always favor removal for a member that appears in both an
        // add and a remove op in the same PATCH, even when the client's actual last op for that
        // member was the add).
        const orderedMemberWriteRequests = [];

        for (const op of memberOperations) {
            const isValidMemberPath = op.path === PATCH_PATHS.MEMBER_PATH || op.path === PATCH_PATHS.MEMBER_APPEND;

            // Validate required fields before accessing them
            if (isValidMemberPath && !op.value?.entity?.reference) {
                throw new BadRequestError({
                    message: `Missing required value.entity.reference in PATCH operation: ${JSON.stringify(op)}`,
                    toString: function () { return this.message; }
                }, {
                    issue: [new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'required',
                        diagnostics: 'Each member PATCH operation must include value.entity.reference'
                    })]
                });
            }

            if (op.op === PATCH_OPERATIONS.ADD && isValidMemberPath) {
                // RFC 6902: path "/member/-" means append to member array
                orderedMemberWriteRequests.push({
                    entity: op.value.entity,
                    period: op.value.period,
                    inactive: op.value.inactive,
                    op: PATCH_OPERATIONS.ADD
                });
            } else if (op.op === PATCH_OPERATIONS.REMOVE && isValidMemberPath) {
                // Server-side extension: remove member by entity reference
                // Note: This is a pragmatic extension for identifying the target row to delete
                // (not standard RFC 6902)
                orderedMemberWriteRequests.push({
                    entity: op.value.entity,
                    period: op.value.period,
                    inactive: op.value.inactive,
                    op: PATCH_OPERATIONS.REMOVE
                });
            } else {
                // UNSUPPORTED: remove by index (e.g., /member/0)
                // Would require reading current state to resolve index
                const message = `Unsupported PATCH operation on Group.member: ${op.op} ${op.path}. ` +
                    `Supported paths: "${PATCH_PATHS.MEMBER_PATH}" or "${PATCH_PATHS.MEMBER_APPEND}". ` +
                    `Supported operations: ` +
                    `1) Add member: {"op":"add","path":"${PATCH_PATHS.MEMBER_APPEND}","value":{"entity":{"reference":"Patient/123"}}} ` +
                    `2) Remove member: {"op":"remove","path":"${PATCH_PATHS.MEMBER_APPEND}","value":{"entity":{"reference":"Patient/123"}}}`;
                throw new BadRequestError({
                    message,
                    toString: function () {
                        return message;
                    }
                }, {
                    issue: [new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'not-supported',
                        diagnostics: message
                    })]
                });
            }
        }

        // 3. Validate sourceAssigningAuthority before any writes
        const sourceAssigningAuthority = foundResource._sourceAssigningAuthority;
        if (!sourceAssigningAuthority) {
            throw new Error(
                `Group ${foundResource.id || foundResource._uuid} has no _sourceAssigningAuthority; cannot enrich member references`
            );
        }

        // 4. Enrich member references with _uuid and _sourceId. PATCH bypasses the normal
        // pre-save pipeline (referenceGlobalIdHandler), so we must enrich references before
        // resolving them.
        enrichMemberReferences(orderedMemberWriteRequests, sourceAssigningAuthority);

        // 5. Resolve each requested write against the current GroupMember_4_0_0 roster into
        // 'create'/'update'/'delete'/'none' -- so the caller knows, before committing anything,
        // exactly which resource write (if any) it will need.
        const pendingMemberWrites = await this.mongoGroupMemberRepository.resolveMemberWritesAsync({
            base_version,
            groupUuid: foundResource._uuid,
            writeRequests: orderedMemberWriteRequests
        });
        const hasPendingMemberWrites = [...pendingMemberWrites.values()].some((w) => w.writeType !== 'none');

        return { pendingMemberWrites, hasPendingMemberWrites, sourceAssigningAuthority };
    }

    /**
     * Writes the GroupMember_4_0_0 row create/update/deletes that prepareExtendedMemberWrites()
     * resolved earlier, now that the caller's own non-member patch flow has committed the
     * Group's real, final version. This is the only point of contact patch.js needs with the
     * Mongo-native member storage -- it never touches mongoGroupMemberRepository or a resolved
     * writes Map directly.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.groupUuid
     * @param {number} params.groupVersionId - the Group's just-committed meta.versionId
     * @param {Date} params.groupLastUpdated - the Group's just-committed meta.lastUpdated
     * @param {string} params.sourceAssigningAuthority
     * @param {Coding[]|undefined} params.securityTags
     * @param {Map} params.pendingMemberWrites - from prepareExtendedMemberWrites's result
     * @returns {Promise<void>}
     */
    async commitPendingMemberWrites({
        requestInfo,
        base_version,
        groupUuid,
        groupVersionId,
        groupLastUpdated,
        sourceAssigningAuthority,
        securityTags,
        pendingMemberWrites
    }) {
        await this.mongoGroupMemberRepository.applyResolvedMemberWritesAsync({
            requestInfo,
            base_version,
            groupUuid,
            groupVersionId,
            groupLastUpdated,
            sourceAssigningAuthority,
            securityTags,
            resolvedMemberWrites: pendingMemberWrites
        });
    }
}

module.exports = {
    GroupMemberPatchStrategy
};
