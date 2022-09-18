const {assertTypeEquals} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {BaseScriptRunner} = require('./baseScriptRunner');

class BaseBulkOperationRunner extends BaseScriptRunner {
    /**
     * @param {MongoCollectionManager} mongoCollectionManager
     */
    constructor({mongoCollectionManager}) {
        super();

        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);
    }

    /**
     * runs the query in batches and calls the fnCreateBulkOperation for each record
     * @param {import('mongodb').Db} db
     * @param {string} sourceCollectionName
     * @param {string} destinationCollectionName
     * @param {import('mongodb').Filter<import('mongodb').Document>} query
     * @param {StartFromIdContainer} startFromIdContainer
     * @param {function(document: import('mongodb').DefaultSchema):Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>} fnCreateBulkOperationAsync
     * @param {boolean|undefined} [ordered]
     * @returns {Promise<string>}
     */
    async runForQueryBatchesAsync(
        {
            db,
            sourceCollectionName,
            destinationCollectionName,
            query,
            startFromIdContainer,
            fnCreateBulkOperationAsync,
            ordered = false
        }
    ) {
        const batchSize = 10000;
        const progressBatchSize = 10000;
        let lastCheckedId = '';

        /**
         * @type {import('mongodb').Collection<import('mongodb').Document>}
         */
        const destinationCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db, collectionName: destinationCollectionName
            }
        );
        const sourceCollection = db.collection(sourceCollectionName);

        let operations = [];

        let currentDateTime = new Date();
        console.log(`[${currentDateTime.toTimeString()}] ` +
            `Sending query to Mongo: ${JSON.stringify(query)}. ` +
            `From ${sourceCollectionName} to ${destinationCollectionName}`);

        if (startFromIdContainer.startFromId) {
            query.$and.push({'id': {$gt: startFromIdContainer.startFromId}});
        }
        /**
         * @type {FindCursor<WithId<import('mongodb').Document>>}
         */
        const cursor = await sourceCollection
            .find(query, {})
            .sort({id: 1})
            .maxTimeMS(60 * 60 * 1000);

        while (await cursor.hasNext()) {
            /**
             * element
             * @type {import('mongodb').DefaultSchema}
             */
            const doc = await cursor.next();
            startFromIdContainer.startFromId = doc.id;
            lastCheckedId = doc.id;
            if (startFromIdContainer.skippedIdsForMissingAccessTags === 0 &&
                startFromIdContainer.convertedIds === 0 &&
                startFromIdContainer.skippedIdsForHavingAccessField === 0) {
                currentDateTime = new Date();
                console.log(`[${currentDateTime}] Started processing documents`);
            }

            // call the function passed in to get the bulk operation based on this doc/record
            const bulkOperations = await fnCreateBulkOperationAsync(doc);
            for (const bulkOperation of bulkOperations) {
                operations.push(bulkOperation);
            }

            startFromIdContainer.convertedIds += 1;
            if (startFromIdContainer.convertedIds % batchSize === 0) { // write every 100 items
                const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                startFromIdContainer.nModified += bulkResult.nModified;
                startFromIdContainer.nUpserted += bulkResult.nUpserted;
                // console.log(`Wrote: modified: ${bulkResult.nModified.toLocaleString()} (${nModified.toLocaleString()}), ` +
                //     `upserted: ${bulkResult.nUpserted} (${nUpserted.toLocaleString()})`);
                operations = [];
            }
            if (startFromIdContainer.convertedIds % progressBatchSize === 0) { // show progress every 1000 items
                currentDateTime = new Date();
                const message = `[${currentDateTime.toTimeString()}] Processed ${startFromIdContainer.convertedIds.toLocaleString()}, ` +
                    `modified: ${startFromIdContainer.nModified.toLocaleString()}, ` +
                    `upserted: ${startFromIdContainer.nUpserted.toLocaleString()}, ` +
                    `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
                console.log(message);
            }
        }
        if (operations.length > 0) { // if any items left to write
            currentDateTime = new Date();
            const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
            startFromIdContainer.nModified += bulkResult.nModified;
            startFromIdContainer.nUpserted += bulkResult.nUpserted;
            const message = `[${currentDateTime.toTimeString()}] Final write ${startFromIdContainer.convertedIds.toLocaleString()} ` +
                `modified: ${startFromIdContainer.nModified.toLocaleString()}, ` +
                `upserted: ${startFromIdContainer.nUpserted.toLocaleString()} ` +
                `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
            console.log(message);
        }
        return lastCheckedId;
    }
}

module.exports = {
    BaseBulkOperationRunner
};
