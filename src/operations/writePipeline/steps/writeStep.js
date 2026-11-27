const { assertIsValid, assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { RethrownError } = require('../../../utils/rethrownError');
const { runInOrderInChunks } = require('../runInChunks');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `write` step, per item: has the writer queue each item's document in the bulk inserter, as an
 * update of the stored version or as an insert, and marks it queued. Nothing reaches the database
 * until `WritePipeline.executeAsync` flushes the queue once for the batch. An error fails only that
 * item at the `WRITE` stage. After the flush, `WritePipeline.runAsync` calls `afterFlushAsync`, which
 * runs the writer's own `afterFlushAsync` hook if it has one; the default writers have none.
 */
class WriteStep {
    /**
     * @param {{queueUpdateAsync: function({item: WriteItem, context: WriteContext}): Promise<void>, queueInsertAsync: function({item: WriteItem, context: WriteContext}): Promise<void>, afterFlushAsync?: function({items: WriteItem[], context: WriteContext, executedResults: Object[]}): Promise<void>}} writer
     * @param {ConfigManager} configManager
     */
    constructor ({ writer, configManager }) {
        /**
         * @type {{queueUpdateAsync: function, queueInsertAsync: function, afterFlushAsync?: function}}
         */
        this.writer = writer;
        assertIsValid(writer, 'writer is required');
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
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
     * Runs once after the bulk flush: calls the writer's `afterFlushAsync` with the items and the
     * flush results when the writer has one, and does nothing when it has none. An error from the
     * hook is thrown, not recorded on an item, because the flush has already happened. The hook
     * receives every item, failed ones included, so a writer's hook must select the items it queued
     * and whose flush result succeeded.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {Object[]} executedResults The results the bulk flush returned.
     * @returns {Promise<void>}
     */
    async afterFlushAsync ({ items, context, executedResults }) {
        if (typeof this.writer.afterFlushAsync === 'function') {
            await this.writer.afterFlushAsync({ items, context, executedResults });
        }
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
     * Has the writer queue the item's update, and wraps an error it throws in a `RethrownError`
     * that names the document's `_uuid`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueUpdateAsync ({ item, context }) {
        try {
            await this.writer.queueUpdateAsync({ item, context });
        } catch (e) {
            throw new RethrownError({
                message: `Error updating: resource_uuid=${item.candidate._uuid}`,
                error: e
            });
        }
    }

    /**
     * Has the writer queue the item's insert, and wraps an error it throws in a `RethrownError`
     * that names the document's `_uuid`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueInsertAsync ({ item, context }) {
        try {
            await this.writer.queueInsertAsync({ item, context });
        } catch (e) {
            throw new RethrownError({
                message: `Error inserting: resource_uuid=${item.candidate._uuid}`,
                error: e
            });
        }
    }
}

module.exports = {
    WriteStep
};
