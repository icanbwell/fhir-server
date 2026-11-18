const { assertTypeEquals } = require('../../../utils/assertType');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { ConfigManager } = require('../../../utils/configManager');
const { RethrownError } = require('../../../utils/rethrownError');
const { runInOrderInChunks } = require('../runInChunks');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');
const { HttpPreconditions } = require('../httpPreconditions');

/**
 * The `write` step, per item: queues each item's document in the bulk inserter, as an update of the
 * stored version or as an insert, and marks it queued. Nothing reaches the database until
 * `WritePipeline.executeAsync` flushes the queue once for the batch. An error fails only that item
 * at the `WRITE` stage. With `honorHttpPreconditions`, it also queues the request's `If-Match` and
 * `If-None-Match: *` preconditions, so a write that loses a race re-checks them.
 */
class WriteStep {
    /**
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {ConfigManager} configManager
     * @param {boolean} [honorHttpPreconditions] - queue the request's `If-Match` and `If-None-Match`
     * preconditions with each write
     */
    constructor ({ databaseBulkInserter, configManager, honorHttpPreconditions = false }) {
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
         * @type {boolean}
         */
        this.honorHttpPreconditions = honorHttpPreconditions;
    }

    /**
     * Queues the items one at a time in request order, so each write sees the writes already queued
     * for the same `_uuid`, and yields to the event loop after every `mergeParallelChunkSize` items.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        await runInOrderInChunks({
            items,
            chunkSize: this.configManager.mergeParallelChunkSize,
            func: async (item) => await this.queueOneAsync({ item, context })
        });
    }

    /**
     * Queues one item as an update or an insert and marks it queued, or fails it at the `WRITE`
     * stage if queueing throws.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueOneAsync ({ item, context }) {
        try {
            if (item.writeMode === 'update') {
                await this.queueUpdateAsync({ item, context });
            } else {
                await this.queueInsertAsync({ item, context });
            }
            item.markQueued();
        } catch (error) {
            item.fail({
                failure: new WriteFailure({
                    stage: WRITE_FAILURE_STAGE.WRITE,
                    subject: WriteFailure.subjectOf(item.incoming),
                    error
                })
            });
        }
    }

    /**
     * Queues the merged document with `mergeOneAsync`, with the arguments of `updateArgs`, or of
     * `preconditionUpdateArgs` when the step honors the HTTP preconditions. When the step honors
     * them and the candidate keeps the stored `versionId` (the forced Group write), it queues it
     * with `replaceOneAsync` and the arguments of `forcedReplaceArgs` instead.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueUpdateAsync ({ item, context }) {
        const doc = item.candidate;
        try {
            if (!this.honorHttpPreconditions) {
                await this.databaseBulkInserter.mergeOneAsync(this.updateArgs({ item, context }));
            } else if (doc.meta.versionId === item.stored.meta.versionId) {
                await this.databaseBulkInserter.replaceOneAsync(
                    this.forcedReplaceArgs({ item, context })
                );
            } else {
                await this.databaseBulkInserter.mergeOneAsync(
                    this.preconditionUpdateArgs({ item, context })
                );
            }
        } catch (e) {
            throw new RethrownError({
                message: `Error updating: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }

    /**
     * Returns the `mergeOneAsync` arguments for an update: the merged document, the stored
     * `versionId` as the previous version, the context data and the context's `smartMerge`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Object}
     */
    updateArgs ({ item, context }) {
        const { requestInfo, smartMerge } = context;
        const doc = item.candidate;
        return {
            requestInfo,
            resourceType: doc.resourceType,
            doc,
            previousVersionId: item.stored.meta.versionId,
            contextData: item.contextData,
            smartMerge
        };
    }

    /**
     * Returns the `updateArgs` with the request's `If-Match` precondition, so a replayed write
     * checks it again. It is queued with no previous version, so it is written by `_uuid` alone,
     * when no specific `If-Match` was sent (no header, or `*`) and either concurrency handling is
     * off, because then a lost versioned write would not be replayed, or the item writes ClickHouse
     * Group members (see `writesClickHouseMembers`). Otherwise it keeps the stored `versionId` as
     * the previous version, which the build already checked is in a specific `If-Match` list.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Object}
     */
    preconditionUpdateArgs ({ item, context }) {
        const { ifMatchVersionIds, writePrecondition } = HttpPreconditions.fromRequestInfo(context.requestInfo);
        const hasSpecificIfMatch = ifMatchVersionIds.length > 0 && !ifMatchVersionIds.includes('*');
        // ClickHouse Group members are not in the stored document, so a lost versioned write whose
        // replay finds the document unchanged is skipped together with its member write. Writing
        // these by _uuid alone, as PUT did before, never loses the race, so the members are written.
        const writeByUuidOnly =
            (!this.configManager.handleConcurrency || this.writesClickHouseMembers(item)) &&
            !hasSpecificIfMatch;
        return {
            ...this.updateArgs({ item, context }),
            previousVersionId: writeByUuidOnly ? null : item.stored.meta.versionId,
            writePrecondition
        };
    }

    /**
     * Returns true when the item's write also writes Group members to ClickHouse: the request asked
     * for external storage, the body carries `member` (an empty list counts, it removes them all),
     * and ClickHouse is on for the item's resource type.
     * @param {WriteItem} item
     * @returns {boolean}
     */
    writesClickHouseMembers (item) {
        const contextData = item.contextData;
        return contextData?.useExternalStorage === true &&
            contextData.groupMembers !== undefined &&
            this.configManager.enableClickHouse &&
            this.configManager.mongoWithClickHouseResources.includes(item.candidate.resourceType);
    }

    /**
     * Returns the `replaceOneAsync` arguments for the forced Group write, the same ones update's old
     * path passes: the candidate, its `_uuid`, the context data and the request's `If-Match`
     * version list, so a specific `If-Match` is in the replace filter and a replay checks it again.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Object}
     */
    forcedReplaceArgs ({ item, context }) {
        const doc = item.candidate;
        return {
            requestInfo: context.requestInfo,
            resourceType: doc.resourceType,
            doc,
            uuid: doc._uuid,
            contextData: item.contextData,
            ifMatchVersionIds: HttpPreconditions.fromRequestInfo(context.requestInfo).ifMatchVersionIds
        };
    }

    /**
     * Queues the new document with `insertOneAsync`, with the arguments of `insertArgs`, or of
     * `preconditionInsertArgs` when the step honors the HTTP preconditions.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueInsertAsync ({ item, context }) {
        const doc = item.candidate;
        try {
            await this.databaseBulkInserter.insertOneAsync(
                this.honorHttpPreconditions
                    ? this.preconditionInsertArgs({ item, context })
                    : this.insertArgs({ item, context })
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error inserting: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }

    /**
     * Returns the `insertOneAsync` arguments for an insert: the new document and its context data.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Object}
     */
    insertArgs ({ item, context }) {
        const doc = item.candidate;
        return {
            requestInfo: context.requestInfo,
            resourceType: doc.resourceType,
            doc,
            contextData: item.contextData
        };
    }

    /**
     * Returns the `insertArgs` with `rejectIfExists` set for `If-None-Match: *` and the context's
     * `smartMerge`, which decides how a lost create is folded into the stored document.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Object}
     */
    preconditionInsertArgs ({ item, context }) {
        return {
            ...this.insertArgs({ item, context }),
            rejectIfExists: HttpPreconditions.fromRequestInfo(context.requestInfo).ifNoneMatch === '*',
            smartMerge: context.smartMerge
        };
    }
}

module.exports = {
    WriteStep
};
