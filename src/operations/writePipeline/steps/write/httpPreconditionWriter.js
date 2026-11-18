const { assertTypeEquals } = require('../../../../utils/assertType');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { ConfigManager } = require('../../../../utils/configManager');
const { HttpPreconditions } = require('../../httpPreconditions');
const { writesClickHouseMembers } = require('../../groupMemberWrites');
const { VersionedWriter } = require('./versionedWriter');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The writer for the `write` step of a write that honors the request's `If-Match` and
 * `If-None-Match` headers (PUT), per item: queues the write with those preconditions, so a write
 * that loses a race checks them again.
 */
class HttpPreconditionWriter {
    /**
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {ConfigManager} configManager
     * @param {VersionedWriter} versionedWriter
     */
    constructor ({ databaseBulkInserter, configManager, versionedWriter }) {
        /**
         * @type {FastDatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, FastDatabaseBulkInserter);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {VersionedWriter}
         */
        this.versionedWriter = versionedWriter;
        assertTypeEquals(versionedWriter, VersionedWriter);
    }

    /**
     * Queues the item's document with `mergeOneAsync` and the arguments of `updateArgs`. When the
     * document keeps the stored `versionId` (the forced Group write), it queues it with
     * `replaceOneAsync` and the arguments of `forcedReplaceArgs` instead.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueUpdateAsync ({ item, context }) {
        const preconditions = HttpPreconditions.fromRequestInfo(context.requestInfo);
        if (item.candidate.meta.versionId === item.stored.meta.versionId) {
            await this.databaseBulkInserter.replaceOneAsync(
                this.forcedReplaceArgs({ item, context, preconditions })
            );
        } else {
            await this.databaseBulkInserter.mergeOneAsync(
                this.updateArgs({ item, context, preconditions })
            );
        }
    }

    /**
     * Queues the item's document with `insertOneAsync` and the arguments of `insertArgs`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueInsertAsync ({ item, context }) {
        const preconditions = HttpPreconditions.fromRequestInfo(context.requestInfo);
        await this.databaseBulkInserter.insertOneAsync(
            this.insertArgs({ item, context, preconditions })
        );
    }

    /**
     * Returns the versioned writer's update arguments with the request's `If-Match` precondition,
     * so a replayed write checks it again. It is queued with no previous version, so it is written
     * by `_uuid` alone, when no specific `If-Match` was sent (no header, or `*`) and either
     * concurrency handling is off, because then a lost versioned write would not be replayed, or
     * the item writes ClickHouse Group members (see `writesClickHouseMembers`). Otherwise it keeps
     * the stored `versionId` as the previous version, which the build already checked is in a
     * specific `If-Match` list.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {HttpPreconditions} preconditions
     * @returns {Object}
     */
    updateArgs ({ item, context, preconditions }) {
        const { ifMatchVersionIds, writePrecondition } = preconditions;
        const hasSpecificIfMatch = ifMatchVersionIds.length > 0 && !ifMatchVersionIds.includes('*');
        const writeByUuidOnly =
            (
                !this.configManager.handleConcurrency ||
                writesClickHouseMembers({ item, configManager: this.configManager })
            ) &&
            !hasSpecificIfMatch;
        return {
            ...this.versionedWriter.updateArgs({ item, context }),
            previousVersionId: writeByUuidOnly ? null : item.stored.meta.versionId,
            writePrecondition
        };
    }

    /**
     * Returns the `replaceOneAsync` arguments for the forced Group write, the same ones update's old
     * path passes: the document, its `_uuid`, the context data and the request's `If-Match` version
     * list, so a specific `If-Match` is in the replace filter and a replay checks it again.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {HttpPreconditions} preconditions
     * @returns {Object}
     */
    forcedReplaceArgs ({ item, context, preconditions }) {
        const doc = item.candidate;
        return {
            requestInfo: context.requestInfo,
            resourceType: doc.resourceType,
            doc,
            uuid: doc._uuid,
            contextData: item.contextData,
            ifMatchVersionIds: preconditions.ifMatchVersionIds
        };
    }

    /**
     * Returns the versioned writer's insert arguments with `rejectIfExists` set for
     * `If-None-Match: *` and the context's `smartMerge`, which decides how a lost create is folded
     * into the stored document.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {HttpPreconditions} preconditions
     * @returns {Object}
     */
    insertArgs ({ item, context, preconditions }) {
        return {
            ...this.versionedWriter.insertArgs({ item, context }),
            rejectIfExists: preconditions.ifNoneMatch === '*',
            smartMerge: context.smartMerge
        };
    }
}

module.exports = {
    HttpPreconditionWriter
};
