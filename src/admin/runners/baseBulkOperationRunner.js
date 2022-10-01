const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {BaseScriptRunner} = require('./baseScriptRunner');
const readline = require('readline');
const retry = require('async-retry');
const {mongoQueryStringify} = require('../../utils/mongoQueryStringify');
const {createClientAsync, disconnectClientAsync} = require('../../utils/connect');
const {auditEventMongoConfig, mongoConfig} = require('../../config');
const {AdminLogger} = require('../adminLogger');

/**
 * @classdesc Implements a loop for reading records from database (based on passed in query), calling a function to
 *              create bulk operations and then sending the bulk operations once batch size has been reached
 */
class BaseBulkOperationRunner extends BaseScriptRunner {
    /**
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     */
    constructor(
        {
            mongoCollectionManager,
            batchSize,
            adminLogger
        }) {
        super();

        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

        this.batchSize = batchSize;
        assertIsValid(batchSize, `batchSize is not valid: ${batchSize}`);

        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);
    }

    /**
     * runs the query in batches and calls the fnCreateBulkOperation for each record
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }} config
     * @param {string} sourceCollectionName
     * @param {string} destinationCollectionName
     * @param {import('mongodb').Filter<import('mongodb').Document>} query
     * @param {import('mongodb').Collection<import('mongodb').Document>|undefined} [projection]
     * @param {StartFromIdContainer} startFromIdContainer
     * @param {function(document: import('mongodb').DefaultSchema):Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>} fnCreateBulkOperationAsync
     * @param {boolean|undefined} [ordered]
     * @param {number} batchSize
     * @param {boolean} skipExistingIds
     * @param {boolean|undefined} [skipWhenCountIsSame]
     * @param {boolean|undefined} [dropDestinationIfCountIsDifferent]
     * @returns {Promise<string>}
     */
    async runForQueryBatchesAsync(
        {
            config,
            sourceCollectionName,
            destinationCollectionName,
            query,
            projection,
            startFromIdContainer,
            fnCreateBulkOperationAsync,
            ordered = false,
            batchSize,
            skipExistingIds,
            skipWhenCountIsSame,
            dropDestinationIfCountIsDifferent
        }
    ) {
        let lastCheckedId = '';
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(config);
        /**
         * @type {import('mongodb').Db}
         */
        const db = client.db(config.db_name);
        /**
         * @type {import('mongodb').Collection<import('mongodb').Document>}
         */
        const destinationCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db, collectionName: destinationCollectionName
            }
        );
        /**
         * @type {import('mongodb').Collection}
         */
        const sourceCollection = db.collection(sourceCollectionName);

        let operations = [];

        let currentDateTime = new Date();
        this.adminLogger.logTrace(`[${currentDateTime.toTimeString()}] ` +
            `Sending count query to Mongo: ${mongoQueryStringify(query)}. ` +
            `for ${sourceCollectionName} and ${destinationCollectionName}`);

        // first get the count
        const numberOfSourceDocuments = await sourceCollection.countDocuments(query, {});
        const numberOfDestinationDocuments = await destinationCollection.countDocuments(query, {});
        this.adminLogger.log(`Count in source: ${numberOfSourceDocuments.toLocaleString('en-US')}, ` +
            `destination: ${numberOfDestinationDocuments.toLocaleString('en-US')}`);

        if (numberOfSourceDocuments === numberOfDestinationDocuments) {
            if (skipWhenCountIsSame) {
                this.adminLogger.log(`Count matched and skipWhenCountIsSame is set so skipping collection ${destinationCollectionName}`);
                return '';
            }
        } else if (dropDestinationIfCountIsDifferent) {
            this.adminLogger.log(`dropDestinationIfCountIsDifferent is set so deleting all records in ${destinationCollectionName}`);
            await destinationCollection.deleteMany({});
        }

        if (skipExistingIds) {
            // get latest id from destination
            const lastIdFromDestinationList = await destinationCollection.find({}).sort({'id': -1}).project(
                {
                    id: 1,
                    _id: 0
                }
            ).limit(1).map(p => p.id).toArray();

            this.adminLogger.logTrace(`Received last id ${JSON.stringify(lastIdFromDestinationList)} from ${destinationCollectionName}`);

            if (!startFromIdContainer.startFromId &&
                lastIdFromDestinationList &&
                lastIdFromDestinationList.length === 0
            ) {
                startFromIdContainer.startFromId = lastIdFromDestinationList[0];
                this.adminLogger.logTrace(`Setting last id to ${startFromIdContainer.startFromId}`);
            }
        }

        if (startFromIdContainer.startFromId) {
            query.$and.push({'id': {$gt: startFromIdContainer.startFromId}});
        }

        this.adminLogger.logTrace(`[${currentDateTime.toTimeString()}] ` +
            `Sending query to Mongo: ${mongoQueryStringify(query)}. ` +
            `From ${sourceCollectionName} to ${destinationCollectionName}`);
        /**
         * @type {FindCursor<WithId<import('mongodb').Document>>}
         */
        let cursor = await sourceCollection
            .find(query, {})
            .sort({id: 1})
            .maxTimeMS(20 * 60 * 60 * 1000) // 20 hours
            .batchSize(batchSize);

        if (projection) {
            cursor = cursor.project(projection);
        }

        let count = 0;
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
            currentDateTime = new Date();
            process.stdout.write(`[${currentDateTime.toTimeString()}] ` +
                `${count.toLocaleString('en-US')} of ${numberOfSourceDocuments.toLocaleString('en-US')}`);
            /**
             * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>[]}
             */
            const bulkOperations = await fnCreateBulkOperationAsync(doc);
            for (const bulkOperation of bulkOperations) {
                operations.push(bulkOperation);
            }

            startFromIdContainer.convertedIds += 1;
            if (operations.length > 0 && (operations.length % this.batchSize === 0)) { // write every x items
                // https://www.npmjs.com/package/async-retry
                await retry(
                    // eslint-disable-next-line no-loop-func
                    async (bail, retryNumber) => {
                        currentDateTime = new Date();
                        this.adminLogger.logTrace(`\n[${currentDateTime.toTimeString()}] ` +
                            `Writing ${operations.length.toLocaleString('en-US')} operations in bulk to ${destinationCollectionName}. ` +
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
            if (operations.length > 0 && (operations.length % this.batchSize === 0)) { // show progress every x items
                currentDateTime = new Date();
                const message = `\n[${currentDateTime.toTimeString()}] ` +
                    `Processed ${startFromIdContainer.convertedIds.toLocaleString()}, ` +
                    `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                    `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')}, ` +
                    `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
                this.adminLogger.log(message);
            }
        }

        // now write out any remaining items
        if (operations.length > 0) { // if any items left to write
            currentDateTime = new Date();
            await retry(
                // eslint-disable-next-line no-loop-func
                async (bail, retryNumber) => {
                    this.adminLogger.logTrace(`\n[${currentDateTime.toTimeString()}] ` +
                        `Final writing ${operations.length.toLocaleString('en-US')} operations in bulk to ${destinationCollectionName}. ` +
                        (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                    const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                    startFromIdContainer.nModified += bulkResult.nModified;
                    startFromIdContainer.nUpserted += bulkResult.nUpserted;
                    const message = `\n[${currentDateTime.toTimeString()}] ` +
                        `Final write ${startFromIdContainer.convertedIds.toLocaleString()} ` +
                        `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                        `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')} ` +
                        `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
                    this.adminLogger.log(message);
                },
                {
                    retries: 5,
                }
            );
        }

        // get the count at the end
        const numberOfSourceDocumentsAtEnd = await sourceCollection.countDocuments(query, {});
        const numberOfDestinationDocumentsAtEnd = await destinationCollection.countDocuments(query, {});
        this.adminLogger.log(`Finished with count in source: ${numberOfSourceDocumentsAtEnd.toLocaleString('en-US')}, ` +
            `destination: ${numberOfDestinationDocumentsAtEnd.toLocaleString('en-US')}`);

        this.adminLogger.logTrace('Disconnecting from client...');

        // disconnect from db
        await disconnectClientAsync(client);
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
                    this.adminLogger.logTrace(`next() retry number: ${retryNumber}`);
                }
                return await cursor.next();
            },
            {
                onRetry: (error) => {
                    this.adminLogger.logError(`ERROR in next(): ${error}`);
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
                    this.adminLogger.logTrace(`hasNext() retry number: ${retryNumber}`);
                }
                return await cursor.hasNext();
            },
            {
                onRetry: (error) => {
                    this.adminLogger.logError(`ERROR in hasNext(): ${error}`);
                },
                retries: 5,
            });
    }

    /**
     * gets all collection names
     * @param {boolean} useAuditDatabase
     * @param {boolean|undefined} [includeHistoryCollections]
     * @returns {Promise<string[]>}
     */
    async getAllCollectionNamesAsync({useAuditDatabase, includeHistoryCollections}) {
        const config = useAuditDatabase ? auditEventMongoConfig : mongoConfig;
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(config);
        /**
         * @type {import('mongodb').Db}
         */
        const db = client.db(config.db_name);
        /**
         * @type {string[]}
         */
        let collectionNames = await this.mongoCollectionManager.getAllCollectionNames({db: db});
        // exclude history tables since we always search by id on those
        if (!includeHistoryCollections) {
            collectionNames = collectionNames.filter(c => !c.includes('_History'));
        }
        await disconnectClientAsync(client);
        return collectionNames;
    }
}

module.exports = {
    BaseBulkOperationRunner
};
