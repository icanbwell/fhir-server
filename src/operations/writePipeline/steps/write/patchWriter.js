const { assertTypeEquals } = require('../../../../utils/assertType');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const {
    MongoGroupMemberRepository
} = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { GroupMemberPatchStrategy } = require('../../../patch/strategies/groupMemberPatchStrategy');
const { ConfigManager } = require('../../../../utils/configManager');
const { promoteExistingGroupIfNeeded } = require('../../../../utils/groupPromotion');
const { buildContextDataForHybridStorage } = require('../../../../utils/contextDataBuilder');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { GRIDFS: { DELETE } } = require('../../../../constants');
const { WRITE_ITEM_STATUS, WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The writer for the `write` step of a PATCH, per item: marks the stored GridFS files the patch
 * removed or replaced inactive, promotes an embedded Group that went over the member limit,
 * commits an extended Group's member rows and queues the document by `_uuid` alone, as the old
 * PATCH path does. After the flush, it writes an external-storage Group's ClickHouse member events
 * for each Group the flush updated. PATCH never inserts.
 */
class PatchWriter {
    /**
     * Keeps the collaborators the PATCH write uses and checks that each has the expected type.
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {GroupMemberPatchStrategy} groupMemberPatchStrategy
     * @param {MongoGroupMemberRepository} mongoGroupMemberRepository
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {ConfigManager} configManager
     */
    constructor ({
        databaseBulkInserter,
        groupMemberPatchStrategy,
        mongoGroupMemberRepository,
        databaseAttachmentManager,
        configManager
    }) {
        /**
         * @type {FastDatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, FastDatabaseBulkInserter);
        /**
         * @type {GroupMemberPatchStrategy}
         */
        this.groupMemberPatchStrategy = groupMemberPatchStrategy;
        assertTypeEquals(groupMemberPatchStrategy, GroupMemberPatchStrategy);
        /**
         * @type {MongoGroupMemberRepository}
         */
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
        assertTypeEquals(mongoGroupMemberRepository, MongoGroupMemberRepository);
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
    }

    /**
     * Write-serializes the candidate in place, as the old path does once the patched resource has
     * passed validation, so a value the patch added is stored as a written resource stores it (an
     * added security tag gets its id, an undefined field is dropped). Then marks inactive the
     * stored GridFS files of the paths the patch removed or replaced, promotes
     * the candidate if it is an embedded Group over `groupMemberPromotionLimit` and then rebuilds
     * its context data from the promoted document, as the old path builds it after promotion,
     * commits an extended Group's pending member rows with the candidate's version, sets
     * `groupMemberEventsWritten` on the context data when the patch has member operations, and
     * queues the candidate with `replaceOneAsync` by `_uuid`, with no version filter.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueUpdateAsync ({ item, context }) {
        const { requestInfo, base_version } = context;
        const doc = FhirResourceWriteSerializer.serialize({ obj: item.candidate });
        item.candidate = doc;
        await this.databaseAttachmentManager.transformAttachments(
            item.stored,
            DELETE,
            item.appliedPatch.filter((operation) => operation.op !== 'add')
        );
        const promotedMemberWrites = await promoteExistingGroupIfNeeded({
            doc,
            requestInfo,
            base_version,
            configManager: this.configManager,
            mongoGroupMemberRepository: this.mongoGroupMemberRepository
        });
        if (promotedMemberWrites) {
            item.contextData = buildContextDataForHybridStorage(doc.resourceType, doc, requestInfo);
        }
        await this.commitExtendedMemberWritesAsync({ item, context });
        if (item.memberWrites && item.memberWrites.memberOperationCount > 0 && item.contextData) {
            item.contextData.groupMemberEventsWritten = true;
        }
        await this.databaseBulkInserter.replaceOneAsync({
            requestInfo,
            resourceType: doc.resourceType,
            doc,
            uuid: doc._uuid,
            contextData: item.contextData
        });
    }

    /**
     * Throws: a PATCH only updates a stored document, so an insert is a programming error.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueInsertAsync ({ item, context }) {
        throw new Error('PATCH never inserts a document');
    }

    /**
     * Runs after the flush with every item, failed ones included: for each queued external-storage
     * Group whose flush result for its `_uuid` is `updated`, writes its ClickHouse member events
     * with the Group at its new version. A PATCH has one item, and `groupId` is the request's
     * `parsedArgs.id`, as the old path passes. An error from the strategy is thrown.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {Object[]} executedResults The results the bulk flush returned.
     * @returns {Promise<void>}
     */
    async afterFlushAsync ({ items, context, executedResults }) {
        const updatedItems = items.filter(
            (item) =>
                item.status === WRITE_ITEM_STATUS.QUEUED &&
                item.memberWrites?.type === 'externalStorage' &&
                this.executedResultFor({ item, executedResults })?.updated === true
        );
        for (const item of updatedItems) {
            await this.groupMemberPatchStrategy.writeClickHouseMemberEventsAsync({
                resourceType: item.candidate.resourceType,
                groupId: context.parsedArgs.id,
                events: item.memberWrites.events,
                groupResource: item.candidate
            });
        }
    }

    /**
     * Commits an extended Group's pending member rows, stamped with the candidate's version,
     * last-updated and security tags, and does nothing for any other item.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async commitExtendedMemberWritesAsync ({ item, context }) {
        const { memberWrites } = item;
        if (memberWrites?.type !== 'extended' || !memberWrites.hasPendingMemberWrites) {
            return;
        }
        const doc = item.candidate;
        await this.groupMemberPatchStrategy.commitPendingMemberWrites({
            requestInfo: context.requestInfo,
            base_version: context.base_version,
            groupUuid: doc._uuid,
            groupVersionId: parseInt(doc.meta.versionId, 10),
            groupLastUpdated: doc.meta.lastUpdated,
            sourceAssigningAuthority: memberWrites.sourceAssigningAuthority,
            securityTags: doc.meta.security,
            pendingMemberWrites: memberWrites.pendingMemberWrites
        });
    }

    /**
     * Returns the flush result with the item's resource type and `_uuid`, or undefined.
     * @param {WriteItem} item
     * @param {Object[]} executedResults
     * @returns {Object|undefined}
     */
    executedResultFor ({ item, executedResults }) {
        const { resourceType, _uuid } = item.candidate;
        return executedResults.find(
            (result) => result?.resourceType === resourceType && result?._uuid === _uuid
        );
    }
}

module.exports = {
    PatchWriter
};
