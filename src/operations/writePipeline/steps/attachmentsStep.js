const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../../preSaveHandlers/preSaveOptions');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { RethrownError } = require('../../../utils/rethrownError');
const { BLOB_OP } = require('../../../constants');
const { buildContextDataForHybridStorage } = require('../../../utils/contextDataBuilder');
const { runInChunks } = require('../runInChunks');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `attachments` step, per item with a built document: runs preSave, hands the document to
 * `DatabaseAttachmentManager` and `Base64DataManager`, which store its attachment and base64 data
 * where configured, and builds the hybrid-storage context data for the write. It runs after every
 * check, so attachments are only written for items that passed them all. An error fails only that
 * item at the `ATTACHMENTS` stage.
 */
class AttachmentsStep {
    /**
     * @param {PreSaveManager} preSaveManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {ConfigManager} configManager
     */
    constructor ({ preSaveManager, databaseAttachmentManager, base64DataManager, configManager }) {
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
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
    }

    /**
     * Prepares every item that has a candidate, in parallel chunks of `mergeParallelChunkSize`.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        await runInChunks({
            items: items.filter((item) => item.candidate !== null),
            chunkSize: this.configManager.mergeParallelChunkSize,
            func: async (item) => await this.prepareOneAsync({ item, context })
        });
    }

    /**
     * Prepares one item as an update or an insert; an error fails only that item.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async prepareOneAsync ({ item, context }) {
        try {
            if (item.writeMode === 'update') {
                await this.prepareUpdateAsync({ item, context });
            } else {
                await this.prepareInsertAsync({ item, context });
            }
        } catch (error) {
            item.fail({
                failure: new WriteFailure({
                    stage: WRITE_FAILURE_STAGE.ATTACHMENTS,
                    subject: WriteFailure.subjectOf(item.incoming),
                    error
                })
            });
        }
    }

    /**
     * Prepares a merged document: preSave, attachments, base64 data and context data, then drops
     * duplicate `meta.security` tags. For a smart merge of a resource whose members are kept in
     * ClickHouse, it keeps the stored members on the document and puts only the new members in the
     * context data. Sets `candidate` and `contextData`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async prepareUpdateAsync ({ item, context }) {
        const { requestInfo, smartMerge } = context;
        let doc = item.candidate;
        try {
            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            doc = await this.preSaveManager.preSaveAsync({ resource: doc, options: preSaveOptions });
            doc = await this.databaseAttachmentManager.transformAttachments(doc);
            doc = await this.base64DataManager.transformAsync(doc, BLOB_OP.INSERT, requestInfo);

            const contextData = buildContextDataForHybridStorage(doc.resourceType, doc, requestInfo, { smartMerge });

            const currentMembers = item.stored.member;
            if (smartMerge && contextData?.useExternalStorage && currentMembers &&
                this.configManager.enableClickHouse &&
                this.configManager.mongoWithClickHouseResources.includes(doc.resourceType)) {
                const currentRefs = new Set(
                    (currentMembers || []).map(m => m.entity?.reference).filter(Boolean)
                );
                contextData.groupMembers = (doc.member || []).filter(
                    m => m.entity?.reference && !currentRefs.has(m.entity.reference)
                );
                doc.member = currentMembers;
            }

            if (Array.isArray(doc.meta?.security)) {
                const seenSecurityTags = new Set();
                doc.meta.security = doc.meta.security.filter((tag) => {
                    const key = `${tag.system}|${tag.code}`;
                    if (seenSecurityTags.has(key)) {
                        return false;
                    }
                    seenSecurityTags.add(key);
                    return true;
                });
            }

            item.candidate = doc;
            item.contextData = contextData;
        } catch (e) {
            throw new RethrownError({
                message: `Error updating: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }

    /**
     * Prepares a new document: preSave, attachments, base64 data and context data. Sets `candidate`
     * and `contextData`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async prepareInsertAsync ({ item, context }) {
        const { requestInfo } = context;
        let doc = item.candidate;
        try {
            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            await this.preSaveManager.preSaveAsync({ resource: doc, options: preSaveOptions });
            doc = await this.databaseAttachmentManager.transformAttachments(doc);
            doc = await this.base64DataManager.transformAsync(doc, BLOB_OP.INSERT, requestInfo);

            const contextData = buildContextDataForHybridStorage(doc.resourceType, doc, requestInfo);

            item.candidate = doc;
            item.contextData = contextData;
        } catch (e) {
            throw new RethrownError({
                message: `Error inserting: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }
}

module.exports = {
    AttachmentsStep
};
