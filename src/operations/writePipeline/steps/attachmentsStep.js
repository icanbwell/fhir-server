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
const { storesMembersInClickHouse, membersNotStored } = require('../groupMemberWrites');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `attachments` step, per item with a built document: gets the document ready to store. It
 * runs preSave, hands the document to `DatabaseAttachmentManager` and `Base64DataManager`, which
 * store its attachment and base64 data where configured, and builds the hybrid-storage context data
 * for the write. For an update it also keeps the stored ClickHouse Group members on the document
 * and drops duplicate `meta.security` tags. It runs after every check, so attachments are only
 * written for items that passed them all. An error fails only that item at the `ATTACHMENTS` stage.
 *
 * With `alwaysCreateNewBase64` on, the base64 insert uploads a fresh live object for every
 * over-threshold payload instead of skipping an unchanged one (`Base64DataManager`'s
 * `alwaysCreateNew`), as an operation with no version check needs. It is off by default.
 */
class AttachmentsStep {
    /**
     * @param {PreSaveManager} preSaveManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {ConfigManager} configManager
     * @param {boolean} [alwaysCreateNewBase64] when true, the base64 insert is called with
     *        `{ alwaysCreateNew: true }`; when false (the default), it is called without options
     */
    constructor ({
        preSaveManager,
        databaseAttachmentManager,
        base64DataManager,
        configManager,
        alwaysCreateNewBase64 = false
    }) {
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
        /**
         * @type {boolean}
         */
        this.alwaysCreateNewBase64 = alwaysCreateNewBase64;
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
     * Prepares one item and sets its `candidate` and `contextData`; an error fails only that item.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async prepareOneAsync ({ item, context }) {
        try {
            await this.prepareAsync({ item, context });
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
     * Prepares the item's document: preSave, attachments, base64 data and the hybrid-storage
     * context data. An update also keeps the stored ClickHouse members (see
     * `keepStoredClickHouseMembers`) and drops duplicate `meta.security` tags. Sets `candidate` and
     * `contextData`, and wraps an error in a `RethrownError` that names the document's `_uuid`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async prepareAsync ({ item, context }) {
        const { requestInfo, smartMerge } = context;
        const isUpdate = item.writeMode === 'update';
        let doc = item.candidate;
        try {
            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            doc = await this.preSaveManager.preSaveAsync({ resource: doc, options: preSaveOptions });
            doc = await this.databaseAttachmentManager.transformAttachments(doc);
            doc = this.alwaysCreateNewBase64
                ? await this.base64DataManager.transformAsync(doc, BLOB_OP.INSERT, requestInfo, {
                    alwaysCreateNew: true
                })
                : await this.base64DataManager.transformAsync(doc, BLOB_OP.INSERT, requestInfo);

            const contextData = isUpdate
                ? buildContextDataForHybridStorage(doc.resourceType, doc, requestInfo, { smartMerge })
                : buildContextDataForHybridStorage(doc.resourceType, doc, requestInfo);
            if (isUpdate) {
                this.keepStoredClickHouseMembers({ doc, contextData, stored: item.stored, smartMerge });
                this.dropDuplicateSecurityTags(doc);
            }

            item.candidate = doc;
            item.contextData = contextData;
        } catch (e) {
            throw new RethrownError({
                message: `Error ${isUpdate ? 'updating' : 'inserting'}: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }

    /**
     * For a smart merge that asked for external storage, of a resource whose members are written to
     * ClickHouse and whose stored document has members: puts only the members the stored document
     * doesn't have in the context data, and keeps the stored members on the document.
     * @param {Object} doc
     * @param {Object|null} contextData
     * @param {Object} stored
     * @param {boolean} smartMerge
     * @returns {void}
     */
    keepStoredClickHouseMembers ({ doc, contextData, stored, smartMerge }) {
        const storedMembers = stored.member;
        if (
            smartMerge &&
            contextData?.useExternalStorage &&
            storedMembers &&
            storesMembersInClickHouse({ resourceType: doc.resourceType, configManager: this.configManager })
        ) {
            contextData.groupMembers = membersNotStored({ members: doc.member, storedMembers });
            doc.member = storedMembers;
        }
    }

    /**
     * Removes each `meta.security` tag whose system and code repeat an earlier tag, in place.
     * @param {Object} doc
     * @returns {void}
     */
    dropDuplicateSecurityTags (doc) {
        if (!Array.isArray(doc.meta?.security)) {
            return;
        }
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
}

module.exports = {
    AttachmentsStep
};
