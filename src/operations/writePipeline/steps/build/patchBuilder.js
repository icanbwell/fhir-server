const deepcopy = require('deepcopy');
const { validate } = require('fast-json-patch');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../../../preSaveHandlers/preSaveOptions');
const { DateColumnHandler } = require('../../../../preSaveHandlers/handlers/dateColumnHandler');
const { ResourceMerger } = require('../../../common/resourceMerger');
const { GroupMemberMerger } = require('../../../common/groupMemberMerger');
const { unchangedStoredEntries } = require('../../../common/groupMemberDedupe');
const { GroupMemberPatchStrategy } = require('../../../patch/strategies/groupMemberPatchStrategy');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { FhirResourceWriteNormalizeSerializer } = require('../../../../fhir/fhirResourceWriteNormalizeSerializer');
const { BadRequestError } = require('../../../../utils/httpErrors');
const { removeUnderscoreFieldsRecursive } = require('../../../../utils/removeUnderscoreFields');
const { validateResource } = require('../../../../utils/validator.util');
const { recordValidationFailure, VALIDATION_STAGE, PATH } = require('../../../../utils/metrics');
const { GRIDFS: { RETRIEVE }, BLOB_OP } = require('../../../../constants');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The builder for the `buildDocument` step of a PATCH, per item: prepares the writes to a Group's
 * members kept outside the document, then applies the rest of the JSON Patch to a hydrated copy of
 * the stored document, reverts the fields a write may not change, runs preSave, keeps one entry
 * per member of an embedded Group, checks the patched document against the FHIR schema before it
 * is normalized and bumps the version when anything changed. It writes nothing and never modifies
 * `item.stored`.
 */
class PatchBuilder {
    /**
     * Keeps the collaborators the PATCH build uses and checks that each has the expected type.
     * @param {ResourceMerger} resourceMerger
     * @param {PreSaveManager} preSaveManager
     * @param {GroupMemberMerger} groupMemberMerger
     * @param {GroupMemberPatchStrategy} groupMemberPatchStrategy
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     */
    constructor ({
        resourceMerger,
        preSaveManager,
        groupMemberMerger,
        groupMemberPatchStrategy,
        databaseAttachmentManager,
        base64DataManager
    }) {
        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
        /**
         * @type {GroupMemberMerger}
         */
        this.groupMemberMerger = groupMemberMerger;
        assertTypeEquals(groupMemberMerger, GroupMemberMerger);
        /**
         * @type {GroupMemberPatchStrategy}
         */
        this.groupMemberPatchStrategy = groupMemberPatchStrategy;
        assertTypeEquals(groupMemberPatchStrategy, GroupMemberPatchStrategy);
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
    }

    /**
     * Builds the patched document and sets `memberWrites`, `appliedPatch`, `candidate` (null when
     * nothing changes) and `writeMode` 'update'. Throws the errors the old PATCH path throws, which
     * the step turns into a `BUILD` failure. Returns the schema failure of the patched document,
     * before anything else is set, or null.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async buildAsync ({ item, context }) {
        const { requestInfo } = context;
        const effectivePatch = await this.prepareMemberWritesAsync({ item, context });
        const hydrated = await this.hydrateStoredAsync({
            stored: item.stored,
            effectivePatch,
            requestInfo
        });
        const resource = await this.applyPatchAsync({ hydrated, effectivePatch, requestInfo });
        const schemaFailure = await this.schemaFailureAsync({
            stored: item.stored,
            resource,
            requestInfo
        });
        if (schemaFailure) {
            return schemaFailure;
        }
        item.appliedPatch = await this.appliedPatchAsync({ hydrated, resource });
        item.candidate = null;
        if (item.appliedPatch.length > 0 || this.hasMemberWritesToMake(item.memberWrites)) {
            this.resourceMerger.fastUpdateMeta({
                patched_resource_incoming: resource,
                currentResource: hydrated,
                original_source: hydrated.meta?.source,
                incrementVersion: true
            });
            item.candidate = resource;
        }
        item.writeMode = 'update';
        return null;
    }

    /**
     * Sets `memberWrites` and returns the operations to apply to the document. For a Group whose
     * members are kept outside the document ('extended' or 'externalStorage'), the member
     * operations are prepared as member writes and only the other operations are returned. For an
     * embedded Group and any other resource, `memberWrites` is null and every operation is
     * returned. The member type is only worked out when the patch has member operations.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<Object[]>}
     */
    async prepareMemberWritesAsync ({ item, context }) {
        const { requestInfo, base_version } = context;
        const resourceType = item.stored.resourceType;
        item.memberWrites = null;
        const memberOpsResult = this.groupMemberPatchStrategy.detectMemberOperations({
            patchContent: item.patch,
            resourceType
        });
        if (!memberOpsResult) {
            return item.patch;
        }
        const { memberOps, nonMemberOps } = memberOpsResult;
        const groupMemberType = this.groupMemberPatchStrategy.determineGroupMemberType({
            requestInfo,
            foundResource: item.stored
        });
        if (groupMemberType === 'extended') {
            const { pendingMemberWrites, hasPendingMemberWrites, sourceAssigningAuthority } =
                await this.groupMemberPatchStrategy.prepareExtendedMemberWrites({
                    base_version,
                    memberOperations: memberOps,
                    foundResource: item.stored
                });
            item.memberWrites = {
                type: 'extended',
                memberOperationCount: memberOps.length,
                pendingMemberWrites,
                hasPendingMemberWrites,
                sourceAssigningAuthority
            };
            return nonMemberOps;
        }
        if (groupMemberType === 'externalStorage') {
            const { eventsToAdd, eventsToRemove } =
                this.groupMemberPatchStrategy.prepareClickHouseMemberWrites({
                    resourceType,
                    memberOperations: memberOps,
                    foundResource: item.stored
                });
            item.memberWrites = {
                type: 'externalStorage',
                memberOperationCount: memberOps.length,
                events: { eventsToAdd, eventsToRemove }
            };
            return nonMemberOps;
        }
        return item.patch;
    }

    /**
     * Returns a copy of the stored document with its GridFS attachments and its base64 data kept
     * in cloud storage read back in. The stored document is not modified.
     * @param {Object} stored
     * @param {Object[]} effectivePatch
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Promise<Object>}
     */
    async hydrateStoredAsync ({ stored, effectivePatch, requestInfo }) {
        const hydrated = await this.databaseAttachmentManager.transformAttachments(
            deepcopy(stored), RETRIEVE, effectivePatch
        );
        return await this.base64DataManager.transformAsync(hydrated, BLOB_OP.RETRIEVE, requestInfo);
    }

    /**
     * Validates the patch against the hydrated document, throwing a `BadRequestError` with the
     * first error, then applies it to a copy, reverts the fields a write may not change when the
     * document has `meta`, runs preSave and keeps one entry per member of an embedded Group, where
     * an entry the patch added or changed wins over a stored one. Returns the patched document.
     * @param {Object} hydrated
     * @param {Object[]} effectivePatch
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Promise<Object>}
     */
    async applyPatchAsync ({ hydrated, effectivePatch, requestInfo }) {
        const errors = validate(
            effectivePatch,
            FhirResourceWriteNormalizeSerializer.serialize({ obj: deepcopy(hydrated) })
        );
        if (errors) {
            const error = Array.isArray(errors) && errors.length && errors.find(e => !!e)
                ? errors.find(e => !!e)
                : errors;
            throw new BadRequestError(error);
        }
        let resource = this.resourceMerger.fastApplyPatch({
            currentResource: deepcopy(hydrated),
            patchContent: deepcopy(effectivePatch)
        });
        if (hydrated.meta) {
            this.resourceMerger.overWriteNonWritableFields({
                currentResource: hydrated,
                resourceToMerge: resource
            });
        }
        resource = await this.preSaveManager.preSaveAsync({
            resource,
            options: PreSaveOptions.fromRequestInfo(requestInfo)
        });
        return this.groupMemberMerger.mergeMembers({
            resource,
            requestInfo,
            olderEntries: unchangedStoredEntries(hydrated.member)
        });
    }

    /**
     * Checks a copy of the patched document, with its `_` fields removed, its dates as strings and
     * no `meta.lastUpdated`, against the FHIR schema, as the old PATCH path does before it
     * normalizes the document. So a field the patch added that FHIR does not define is rejected
     * rather than dropped by the normalized copy `validateResult` checks, even when it is the
     * patch's only change. Records a schema validation failure and returns a `RESULT_VALIDATION`
     * failure with the stored document's identity and the outcome; null when the copy is valid.
     * @param {Object} stored
     * @param {Object} resource
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Promise<WriteFailure|null>}
     */
    async schemaFailureAsync ({ stored, resource, requestInfo }) {
        let resourceToValidate = deepcopy(resource);
        removeUnderscoreFieldsRecursive(resourceToValidate);
        const dateColumnHandler = new DateColumnHandler();
        dateColumnHandler.setFlag(true);
        resourceToValidate = await dateColumnHandler.preSaveAsync({ resource: resourceToValidate });
        delete resourceToValidate.meta?.lastUpdated;
        const operationOutcome = validateResource({
            resourceBody: resourceToValidate,
            resourceName: stored.resourceType,
            path: requestInfo.path
        });
        if (!operationOutcome) {
            return null;
        }
        recordValidationFailure(
            operationOutcome,
            stored.resourceType,
            VALIDATION_STAGE.SCHEMA,
            PATH.SAVE
        );
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
            subject: WriteFailure.subjectOf(stored),
            operationOutcome
        });
    }

    /**
     * Returns the JSON Patch operations that turn the hydrated stored document into the patched
     * one, with dates on both sides as strings and both normalize-serialized. Converts the dates
     * of the hydrated copy in place; the patched document is not modified.
     * @param {Object} hydrated
     * @param {Object} resource
     * @returns {Promise<Object[]>}
     */
    async appliedPatchAsync ({ hydrated, resource }) {
        const dateColumnHandler = new DateColumnHandler();
        dateColumnHandler.setFlag(true);
        await dateColumnHandler.preSaveAsync({ resource: hydrated });
        const mergedObject = deepcopy(resource);
        await dateColumnHandler.preSaveAsync({ resource: mergedObject });
        FhirResourceWriteNormalizeSerializer.serialize({ obj: hydrated });
        FhirResourceWriteNormalizeSerializer.serialize({ obj: mergedObject });
        return this.resourceMerger.compareObjects({ currentObject: hydrated, mergedObject });
    }

    /**
     * Whether the member writes need a new version of the Group although its document did not
     * change: an extended Group with a pending member write, or an external storage Group with at
     * least one member event.
     * @param {Object|null} memberWrites
     * @returns {boolean}
     */
    hasMemberWritesToMake (memberWrites) {
        if (memberWrites?.type === 'extended') {
            return memberWrites.hasPendingMemberWrites;
        }
        if (memberWrites?.type === 'externalStorage') {
            const { eventsToAdd, eventsToRemove } = memberWrites.events;
            return eventsToAdd.length > 0 || eventsToRemove.length > 0;
        }
        return false;
    }
}

module.exports = {
    PatchBuilder
};
