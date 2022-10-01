const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {BaseScriptRunner} = require('./baseScriptRunner');
const readline = require('readline');
const retry = require('async-retry');
const {mongoQueryStringify} = require('../../utils/mongoQueryStringify');
const {createClientAsync, disconnectClientAsync} = require('../../utils/connect');
const {auditEventMongoConfig, mongoConfig} = require('../../config');
const {AdminLogger} = require('../adminLogger');
const deepcopy = require('deepcopy');
const moment = require('moment-timezone');


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

        /**
         * @type {moment.Moment}
         */
        let currentDateTime = moment();
        this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
            `Sending count query to Mongo: ${mongoQueryStringify(query)}. ` +
            `for ${sourceCollectionName} and ${destinationCollectionName}`);

        // first get the count
        const numberOfSourceDocuments = await sourceCollection.countDocuments(query, {});
        this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
            `Sending distinct count query to Mongo: ${mongoQueryStringify(query)}. ` +
            `for ${sourceCollectionName} and ${destinationCollectionName}`);
        /**
         * @type {number}
         */
        const numberOfSourceDocumentsWithDistinctId = await this.mongoCollectionManager.distinctCountAsync(
            {
                collection: sourceCollection,
                query,
                groupKey: 'id'
            });
        const numberOfDestinationDocuments = await destinationCollection.countDocuments(query, {});
        this.adminLogger.log(`[${currentDateTime.toISOString()}] ` +
            `Count in source: ${numberOfSourceDocuments.toLocaleString('en-US')}, ` +
            `Count in source distinct by id: ${numberOfSourceDocumentsWithDistinctId.toLocaleString('en-US')}, ` +
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

            this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
                `Received last id ${JSON.stringify(lastIdFromDestinationList)} from ${destinationCollectionName}`);

            if (!startFromIdContainer.startFromId &&
                lastIdFromDestinationList &&
                lastIdFromDestinationList.length >= 0 &&
                lastIdFromDestinationList[0]
            ) {
                startFromIdContainer.startFromId = lastIdFromDestinationList[0];
                this.adminLogger.logTrace(`Setting last id to ${startFromIdContainer.startFromId}`);
            }
        }

        const originalQuery = deepcopy(query);

        if (startFromIdContainer.startFromId) {
            query.$and.push({'id': {$gt: startFromIdContainer.startFromId}});
        }
        /**
         * @type {import('mongodb').ClientSession}
         */
        const session = client.startSession();
        /**
         * @type {import('mongodb').ServerSessionId}
         */
        const sessionId = session.serverSession.id;
        this.adminLogger.logTrace(`Started session ${JSON.stringify(sessionId)}`);

        this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
            `Sending query to Mongo: ${mongoQueryStringify(query)}. ` +
            `From ${sourceCollectionName} to ${destinationCollectionName}`);

        /**
         * @type {FindCursor<WithId<import('mongodb').Document>>}
         */
        let cursor = await sourceCollection
            .find(query, {})
            .sort({id: 1})
            .maxTimeMS(20 * 60 * 60 * 1000) // 20 hours
            .batchSize(batchSize)
            .addCursorFlag('noCursorTimeout', true);

        if (projection) {
            cursor = cursor.project(projection);
        }

        let count = 0;
        var refreshTimestamp = new Date(); // take note of time at operation start
        while (await this.hasNext(cursor)) {
            // Check if more than 5 minutes have passed since the last refresh
            const numberOfSecondsBetweenSessionRefreshes = 300;
            if ((new Date() - refreshTimestamp) / 1000 > numberOfSecondsBetweenSessionRefreshes) {
                this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
                    `refreshing session with sessionId: ${JSON.stringify(sessionId)}`);
                /**
                 * @type {import('mongodb').Document}
                 */
                const adminResult = await db.admin().command({'refreshSessions': [sessionId]});
                this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
                    `result from refreshing session: ${JSON.stringify(adminResult)}`);
                refreshTimestamp = new Date();
            }
            /**
             * element
             * @type {import('mongodb').DefaultSchema}
             */
            const doc = await this.next(cursor);
            startFromIdContainer.startFromId = doc.id;
            const numberOfDocumentsToCopy = skipExistingIds ?
                numberOfSourceDocuments - numberOfDestinationDocuments :
                numberOfSourceDocuments;
            lastCheckedId = doc.id;
            count += 1;
            readline.cursorTo(process.stdout, 0);
            currentDateTime = moment();
            process.stdout.write(`[${currentDateTime.toISOString()}] ` +
                `${count.toLocaleString('en-US')} of ${numberOfDocumentsToCopy.toLocaleString('en-US')}`);
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
                        currentDateTime = moment();
                        this.adminLogger.logTrace(`\n[${currentDateTime.toISOString()}] ` +
                            `Writing ${operations.length.toLocaleString('en-US')} operations in bulk to ${destinationCollectionName}. ` +
                            (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                        const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                        startFromIdContainer.nModified += bulkResult.nModified;
                        startFromIdContainer.nUpserted += bulkResult.nUpserted;
                        // console.log(`Wrote: modified: ${bulkResult.nModified.toLocaleString()} (${nModified.toLocaleString()}), ` +
                        //     `upserted: ${bulkResult.nUpserted} (${nUpserted.toLocaleString()})`);
                        operations = [];
                        // await session.commitTransaction();
                    },
                    {
                        retries: 5,
                    }
                );
            }
            if (operations.length > 0 && (operations.length % this.batchSize === 0)) { // show progress every x items
                currentDateTime = moment();
                const message = `\n[${currentDateTime.toISOString()}] ` +
                    `Processed ${startFromIdContainer.convertedIds.toLocaleString()}, ` +
                    `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                    `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')}, ` +
                    `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${lastCheckedId}`;
                this.adminLogger.log(message);
            }
        }

        // now write out any remaining items
        if (operations.length > 0) { // if any items left to write
            currentDateTime = moment();
            await retry(
                // eslint-disable-next-line no-loop-func
                async (bail, retryNumber) => {
                    this.adminLogger.logTrace(`\n[${currentDateTime.toISOString()}] ` +
                        `Final writing ${operations.length.toLocaleString('en-US')} operations in bulk to ${destinationCollectionName}. ` +
                        (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                    const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                    // await session.commitTransaction();
                    startFromIdContainer.nModified += bulkResult.nModified;
                    startFromIdContainer.nUpserted += bulkResult.nUpserted;
                    const message = `\n[${currentDateTime.toISOString()}] ` +
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
        this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
            `Getting count afterward in ${destinationCollectionName}: ${mongoQueryStringify(originalQuery)}`);
        const numberOfDestinationDocumentsAtEnd = await destinationCollection.countDocuments(originalQuery, {});
        this.adminLogger.log(`[${currentDateTime.toISOString()}] ` +
            `Count in source: ${numberOfSourceDocuments.toLocaleString('en-US')}, ` +
            `Count in source distinct by id: ${numberOfSourceDocumentsWithDistinctId.toLocaleString('en-US')}, ` +
            `destination: ${numberOfDestinationDocumentsAtEnd.toLocaleString('en-US')}`);

        // end session
        this.adminLogger.logTrace(`Ending session ${JSON.stringify(sessionId)}...`);
        await session.endSession();

        // disconnect from db
        this.adminLogger.logTrace('Disconnecting from client...');
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
                // noinspection JSDeprecatedSymbols,JSCheckFunctionSignatures
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
