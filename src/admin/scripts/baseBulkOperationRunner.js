const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {BaseScriptRunner} = require('./baseScriptRunner');
const readline = require('readline');
const retry = require('async-retry');

/**
 * @classdesc Implements a loop for reading records from database (based on passed in query), calling a function to
 *              create bulk operations and then sending the bulk operations once batch size has been reached
 */
class BaseBulkOperationRunner extends BaseScriptRunner {
    /**
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     */
    constructor({mongoCollectionManager, batchSize}) {
        super();

        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

        this.batchSize = batchSize;
        assertIsValid(batchSize, `batchSize is not valid: ${batchSize}`);
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
            .maxTimeMS(60 * 60 * 1000)
            .batchSize(1000);

        let count = 0;
        /**
         * cache all the documents as the cursor can time out if open for a while
         * @type {import('mongodb').DefaultSchem}[]}
         */
        const documents = [];
        while (await this.hasNext(cursor)) {
            /**
             * element
             * @type {import('mongodb').DefaultSchema}
             */
            const doc = await this.next(cursor);
            startFromIdContainer.startFromId = doc.id;
            lastCheckedId = doc.id;
            count += 1;
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`${count.toLocaleString('en-US')} read from database...`);
            documents.push(doc);
        }

        // Now iterate through the docs
        for (const /** @type {import('mongodb').DefaultSchema} */ doc of documents) {
            // call the function passed in to get the bulk operation based on this doc/record
            const bulkOperations = await fnCreateBulkOperationAsync(doc);
            for (const bulkOperation of bulkOperations) {
                operations.push(bulkOperation);
            }

            startFromIdContainer.convertedIds += 1;
            if (startFromIdContainer.convertedIds % this.batchSize === 0) { // write every x items
                // https://www.npmjs.com/package/async-retry
                await retry(
                    // eslint-disable-next-line no-loop-func
                    async (bail, retryNumber) => {
                        currentDateTime = new Date();
                        console.log(`\n[${currentDateTime.toTimeString()}] ` +
                            `Writing ${operations.length.toLocaleString('en-US')} operations in bulk. ` +
                            (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                        const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                        startFromIdContainer.nModified += bulkResult.nModified;
                        startFromIdContainer.nUpserted += bulkResult.nUpserted;
                        // console.log(`Wrote: modified: ${bulkResult.nModified.toLocaleString()} (${nModified.toLocaleString()}), ` +
                        //     `upserted: ${bulkResult.nUpserted} (${nUpserted.toLocaleString()})`);
                        operations = [];
                    },
                    {
                        retries: 5,
                    }
                );
            }
            if (startFromIdContainer.convertedIds % this.batchSize === 0) { // show progress every x items
                currentDateTime = new Date();
                const message = `\n[${currentDateTime.toTimeString()}] ` +
                    `Processed ${startFromIdContainer.convertedIds.toLocaleString()}, ` +
                    `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                    `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')}, ` +
                    `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
                console.log(message);
            }
        }
        if (operations.length > 0) { // if any items left to write
            currentDateTime = new Date();
            await retry(
                // eslint-disable-next-line no-loop-func
                async (bail, retryNumber) => {
                    console.log(`\n[${currentDateTime.toTimeString()}] ` +
                        `Final writing ${operations.length.toLocaleString('en-US')} operations in bulk. ` +
                        (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                    const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                    startFromIdContainer.nModified += bulkResult.nModified;
                    startFromIdContainer.nUpserted += bulkResult.nUpserted;
                    const message = `\n[${currentDateTime.toTimeString()}] ` +
                        `Final write ${startFromIdContainer.convertedIds.toLocaleString()} ` +
                        `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                        `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')} ` +
                        `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
                    console.log(message);
                },
                {
                    retries: 5,
                }
            );
        }
        return lastCheckedId;
    }

    /**
     *
     * @param {FindCursor<WithId<import('mongodb').Document>>} cursor
     * @returns {Promise<*>}
     */
    async next(cursor) {
        return await retry(
            // eslint-disable-next-line no-loop-func
            async (bail, retryNumber) => {
                if (retryNumber > 1) {
                    console.log(`next() retry number: ${retryNumber}`);
                }
                return await cursor.next();
            },
            {
                onRetry: (error) => {
                    console.error(`ERROR in next(): ${error}`);
                },
                retries: 5,
            });
    }

    /**
     *
     * @param {FindCursor<WithId<import('mongodb').Document>>} cursor
     * @returns {Promise<unknown>}
     */
    async hasNext(cursor) {
        return await retry(
            // eslint-disable-next-line no-loop-func
            async (bail, retryNumber) => {
                if (retryNumber > 1) {
                    console.log(`hasNext() retry number: ${retryNumber}`);
                }
                return await cursor.hasNext();
            },
            {
                onRetry: (error) => {
                    console.error(`ERROR in hasNext(): ${error}`);
                },
                retries: 5,
            });
    }
}

module.exports = {
    BaseBulkOperationRunner
};
