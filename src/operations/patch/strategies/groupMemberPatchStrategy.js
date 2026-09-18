const { BadRequestError } = require('../../../utils/httpErrors');
const { PATCH_PATHS, PATCH_OPERATIONS } = require('../../../constants/groupConstants');
const { createTooCostlyError } = require('../../../utils/fhirErrorFactory');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { buildContextDataForHybridStorage, USE_EXTERNAL_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');
const { isTrue } = require('../../../utils/isTrue');
const { enrichMemberReferences } = require('../../../utils/referenceEnricher');
const { isGroupExtendedAsync } = require('../../../utils/mongoGroupExtendedTag');

/**
 * Strategy for handling Group.member PATCH operations
 *
 * Implements event-sourced member management for Groups, against one of two group member types:
 * - ClickHouse (per-request `useexternalstorage` header) -- writes events to the ClickHouse
 *   event log via the Group's registered post-save handler.
 * - Mongo-native "extended" storage (permanent, internal, non-FHIR marker field on the raw
 *   Group document, design doc §3.1, DCON-5527) -- writes rows through MongoGroupMemberRepository,
 *   targeting GroupMember_4_0_0 / GroupMember_4_0_0_History via the shared write pipeline.
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
     * @param {import('../../common/resourceLocatorFactory').ResourceLocatorFactory} params.resourceLocatorFactory
     */
    constructor({
        postSaveHandlerFactory,
        configManager,
        resourceMerger,
        databaseBulkInserter,
        mongoGroupMemberRepository,
        resourceLocatorFactory
    }) {
        this.postSaveHandlerFactory = postSaveHandlerFactory;
        this.configManager = configManager;
        this.resourceMerger = resourceMerger;
        this.databaseBulkInserter = databaseBulkInserter;
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
        this.resourceLocatorFactory = resourceLocatorFactory;
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
     * PATCH ops, once the Group document itself has been loaded. ClickHouse's trigger is a
     * per-request opt-in header, unchanged; the Mongo-native trigger is a permanent,
     * tamper-resistant internal field (design doc §3.1) read directly off the raw Group
     * document via a dedicated lookup -- not off the hydrated foundResource, since that field
     * isn't a recognized property on the Group class and never survives hydration. There is no
     * header for this trigger, since "extended" is a fixed per-Group state, not a per-call
     * choice. The two triggers are mutually exclusive by construction (§3.1), so checking the
     * header first is sufficient -- no defensive double-check needed.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {Resource} params.foundResource - the loaded Group
     * @param {string} params.base_version
     * @returns {Promise<'externalStorage'|'extended'|'embedded'>}
     */
    async determineGroupMemberType({ requestInfo, foundResource, base_version }) {
        if (isTrue(requestInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER])) {
            return 'externalStorage';
        }

        const extended = await isGroupExtendedAsync({
            resourceLocatorFactory: this.resourceLocatorFactory,
            base_version,
            groupUuid: foundResource._uuid
        });
        if (extended) {
            if (!this.configManager.enableExtendedGroup) {
                throw new BadRequestError(new Error(
                    `Group ${foundResource.id || foundResource._uuid} uses extended member storage, ` +
                    'which is disabled on this server (ENABLE_EXTENDED_GROUP is not set).'
                ));
            }
            return 'extended';
        }

        return 'embedded';
    }

    /**
     * Executes member operations against the determined group member type: the ClickHouse event
     * log for 'externalStorage', or GroupMember_4_0_0 rows via MongoGroupMemberRepository for
     * 'extended'.
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
     * @param {'externalStorage'|'extended'} params.groupMemberType - determined by determineGroupMemberType()
     * @returns {Promise<Resource>} The updated Group resource
     */
    async executeMemberOperations({
        requestInfo,
        parsedArgs,
        resourceType,
        id,
        base_version,
        memberOperations,
        foundResource,
        groupMemberType
    }) {
        const groupId = id;

        let groupHandler;
        if (groupMemberType === 'externalStorage') {
            const postSaveHandlers = this.postSaveHandlerFactory.getHandlers(resourceType);
            if (postSaveHandlers.length === 0) {
                throw new Error('No post-save handlers available for Group resource');
            }
            groupHandler = postSaveHandlers[0];
        }

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

        // 4. Update Group metadata in MongoDB FIRST (increment versionId, update lastUpdated)
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

        // 5. Enrich member references with _uuid and _sourceId
        // PATCH bypasses the normal pre-save pipeline (referenceGlobalIdHandler),
        // so we must enrich references before writing to either group member type.
        enrichMemberReferences(eventsToAdd, sourceAssigningAuthority);
        enrichMemberReferences(eventsToRemove, sourceAssigningAuthority);

        // 6. Write events per the determined group member type (AFTER the Group's own MongoDB commit)
        if (eventsToAdd.length > 0 || eventsToRemove.length > 0) {
            if (groupMemberType === 'externalStorage') {
                // Direct translation: 1 operation = 1 event (added or removed). ClickHouse's event
                // log expects a concrete boolean, not undefined -- default a not-supplied inactive
                // to false here, scoped to this branch only. (The Mongo-native branch below reads
                // eventsToAdd/eventsToRemove's inactive as-is, since it needs to tell "not
                // supplied" apart from "explicitly false" -- see resolveMemberWrite.js.)
                await groupHandler.writeEventsAsync({
                    groupId,
                    added: eventsToAdd.map((event) => ({ ...event, inactive: event.inactive ?? false })),
                    removed: eventsToRemove.map((event) => ({ ...event, inactive: event.inactive ?? false })),
                    groupResource: updatedResource // Use updated resource with new versionId
                });
            } else {
                // Mongo-native (extended) regime: targeted row writes against GroupMember_4_0_0,
                // via the four-way state table (resolveMemberWrite) -- a single combined event
                // list, tagged with the op that produced it.
                const events = [
                    ...eventsToAdd.map((event) => ({ ...event, op: PATCH_OPERATIONS.ADD })),
                    ...eventsToRemove.map((event) => ({ ...event, op: PATCH_OPERATIONS.REMOVE }))
                ];
                // applyMemberEventsAsync flushes its own buffered writes before returning.
                await this.mongoGroupMemberRepository.applyMemberEventsAsync({
                    requestInfo,
                    base_version,
                    groupUuid: updatedResource._uuid,
                    groupVersionId: parseInt(updatedResource.meta.versionId, 10),
                    sourceAssigningAuthority,
                    securityTags: updatedResource.meta.security,
                    events
                });
            }
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
}

module.exports = {
    GroupMemberPatchStrategy
};
