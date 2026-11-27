const { assertTypeEquals } = require('../../../../utils/assertType');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The writer for the `write` step, per item: queues an update that is written only if the stored
 * document still has the version the new document was built from, or an insert.
 */
class VersionedWriter {
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
     * Queues the item's document with `mergeOneAsync` and the arguments of `updateArgs`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueUpdateAsync ({ item, context }) {
        await this.databaseBulkInserter.mergeOneAsync(this.updateArgs({ item, context }));
    }

    /**
     * Queues the item's document with `insertOneAsync` and the arguments of `insertArgs`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async queueInsertAsync ({ item, context }) {
        await this.databaseBulkInserter.insertOneAsync(this.insertArgs({ item, context }));
    }

    /**
     * Returns the `mergeOneAsync` arguments for an update: the built document, the stored
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
}

module.exports = {
    VersionedWriter
};
