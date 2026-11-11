const { assertTypeEquals } = require('../../../utils/assertType');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { RethrownError } = require('../../../utils/rethrownError');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `write` step, per item: queues each item's document in the bulk inserter, as an update of the
 * stored version or as an insert, and marks it queued. Nothing reaches the database until
 * `WritePipeline.executeAsync` flushes the queue once for the batch. An error fails only that item
 * at the `WRITE` stage.
 */
class WriteStep {
    /**
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     */
    constructor ({ databaseBulkInserter }) {
        /**
         * @type {FastDatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, FastDatabaseBulkInserter);
    }

    /**
     * Queues the items one at a time in request order, so each write sees the writes already queued
     * for the same `_uuid`.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        for (const item of items) {
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
    }

    /**
     * Queues the merged document with `mergeOneAsync`, passing the stored `versionId` as the
     * previous version and the context data.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueUpdateAsync ({ item, context }) {
        const { requestInfo, smartMerge } = context;
        const doc = item.candidate;
        try {
            await this.databaseBulkInserter.mergeOneAsync({
                requestInfo,
                resourceType: doc.resourceType,
                doc,
                previousVersionId: item.stored.meta.versionId,
                contextData: item.contextData,
                smartMerge
            });
        } catch (e) {
            throw new RethrownError({
                message: `Error updating: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }

    /**
     * Queues the new document with `insertOneAsync` and its context data.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueInsertAsync ({ item, context }) {
        const { requestInfo } = context;
        const doc = item.candidate;
        try {
            await this.databaseBulkInserter.insertOneAsync({
                requestInfo,
                resourceType: doc.resourceType,
                doc,
                contextData: item.contextData
            });
        } catch (e) {
            throw new RethrownError({
                message: `Error inserting: resource_uuid=${doc._uuid}`,
                error: e
            });
        }
    }
}

module.exports = {
    WriteStep
};
