const { BadRequestError } = require('../../../utils/httpErrors');
const { PATCH_PATHS, PATCH_OPERATIONS, CONTEXT_KEYS } = require('../../../constants/groupConstants');
const { createTooCostlyError } = require('../../../utils/fhirErrorFactory');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const httpContext = require('express-http-context');
const { buildContextDataForHybridStorage } = require('../../../utils/contextDataBuilder');

/**
 * Strategy for handling Group.member PATCH operations
 *
 * Implements event-sourced member management for Groups:
 * - Detects member operations in PATCH requests
 * - Translates JSON Patch operations to ClickHouse events
 * - Bypasses MongoDB array updates (events written to ClickHouse only)
 * - Handles metadata updates for member-only patches
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
     */
    constructor({
        postSaveHandlerFactory,
        configManager,
        resourceMerger,
        databaseBulkInserter
    }) {
        this.postSaveHandlerFactory = postSaveHandlerFactory;
        this.configManager = configManager;
        this.resourceMerger = resourceMerger;
        this.databaseBulkInserter = databaseBulkInserter;
    }

    /**
     * Detects if patch contains Group member operations
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

        const handlers = this.postSaveHandlerFactory.getHandlers(resourceType);
        if (handlers.length === 0) {
            return null;
        }

        const memberOps = patchContent.filter(op =>
            op.path.startsWith(PATCH_PATHS.MEMBER_PREFIX)
        );
        const nonMemberOps = patchContent.filter(op =>
            !op.path.startsWith(PATCH_PATHS.MEMBER_PREFIX)
        );

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
     * Executes member operations by writing to ClickHouse event log
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
     * @returns {Promise<void>}
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
            if (op.op === PATCH_OPERATIONS.ADD && op.path === PATCH_PATHS.MEMBER_APPEND) {
                // RFC 6902: path "/member/-" means append to member array
                eventsToAdd.push({
                    entity: op.value.entity,
                    period: op.value.period,
                    inactive: op.value.inactive || false
                });
            } else if (op.op === PATCH_OPERATIONS.REMOVE && op.path === PATCH_PATHS.MEMBER_PREFIX && op.value?.entity) {
                // Server-side extension: remove member by entity reference
                // Creates MEMBER_REMOVED event in ClickHouse event log
                // Note: This is a pragmatic extension for event sourcing (not standard RFC 6902)
                eventsToRemove.push({
                    entity: op.value.entity,
                    period: op.value.period,
                    inactive: op.value.inactive || false
                });
            } else {
                // UNSUPPORTED: remove by index (e.g., /member/0)
                // Would require reading current state to resolve index
                const message = `Unsupported PATCH operation on Group.member: ${op.op} ${op.path}. ` +
                    `Supported operations: ` +
                    `1) Add member: {"op":"add","path":"${PATCH_PATHS.MEMBER_APPEND}","value":{"entity":{"reference":"Patient/123"}}} ` +
                    `2) Remove member: {"op":"remove","path":"${PATCH_PATHS.MEMBER_PREFIX}","value":{"entity":{"reference":"Patient/123"}}}`;
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

        // 3. Write events to storage (NO MongoDB member array update)
        // Direct translation: 1 operation = 1 event (added or removed)
        if (eventsToAdd.length > 0 || eventsToRemove.length > 0) {
            await groupHandler.writeEventsAsync({
                groupId,
                added: eventsToAdd,
                removed: eventsToRemove,
                groupResource: foundResource
            });

            // Set flag to tell post-save handler that events were already written
            // This prevents the handler from trying to compute a diff (which would be incorrect)
            httpContext.set(CONTEXT_KEYS.GROUP_MEMBER_EVENTS_WRITTEN(groupId), true);
        }

        // 4. Update Group metadata in MongoDB (increment versionId, update lastUpdated)
        // Note: This is handled by the response builder or the mixed patch logic
    }

    /**
     * Builds response for member-only PATCH
     * Returns Group metadata without the member array (members are in storage sync)
     *
     * SECURITY: This method is called AFTER the resource has been validated to exist
     * and the user's access has been verified by scopesValidator.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {ParsedArgs} params.parsedArgs
     * @param {string} params.resourceType
     * @param {string} params.id
     * @param {string} params.base_version
     * @param {Resource} params.foundResource - The validated Group resource from MongoDB
     * @returns {Promise<{id: string, created: boolean, resource_version: string, resource: Resource}>}
     */
    async buildMemberPatchResponse({
        requestInfo,
        parsedArgs,
        resourceType,
        id,
        base_version,
        foundResource
    }) {
        // Increment version and update lastUpdated
        const updatedResource = foundResource.clone();
        this.resourceMerger.updateMeta({
            patched_resource_incoming: updatedResource,
            currentResource: foundResource,
            original_source: foundResource.meta?.source,
            incrementVersion: true
        });

        // Update MongoDB metadata only (no member array)
        await this.databaseBulkInserter.replaceOneAsync({
            base_version,
            requestInfo,
            resourceType,
            doc: updatedResource,
            uuid: updatedResource._uuid,
            contextData: buildContextDataForHybridStorage(resourceType, foundResource)
        });

        await this.databaseBulkInserter.executeAsync({
            requestInfo,
            base_version
        });

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
