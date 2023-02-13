const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {BaseScriptRunner} = require('./baseScriptRunner');
const readline = require('readline');
const retry = require('async-retry');
const {mongoQueryStringify} = require('../../utils/mongoQueryStringify');
const {AdminLogger} = require('../adminLogger');
const deepcopy = require('deepcopy');
const moment = require('moment-timezone');
const {MongoNetworkTimeoutError} = require('mongodb');
const {MemoryManager} = require('../../utils/memoryManager');
const {MongoDatabaseManager} = require('../../utils/mongoDatabaseManager');


/**
 * @classdesc Implements a loop for reading records from database (based on passed in query), calling a function to
 *              create bulk operations and then sending the bulk operations once batch size has been reached
 */
class BaseBulkOperationRunner extends BaseScriptRunner {
    /**
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor(
        {
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
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

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
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
        let {
            sourceClient,
            destinationClient,
            session,
            sessionId,
            destinationCollection,
            sourceCollection
        } = await this.createConnectionAsync({config, destinationCollectionName, sourceCollectionName});

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
        lastCheckedId = await this.runLoopAsync(
            {
                startFromIdContainer,
                query,
                config,
                destinationCollectionName,
                sourceCollectionName,
                currentDateTime,
                batchSize,
                projection,
                skipExistingIds,
                numberOfSourceDocuments,
                numberOfDestinationDocuments,
                lastCheckedId,
                fnCreateBulkOperationAsync,
                ordered
            });

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
        this.adminLogger.logTrace('Disconnecting from sourceClient...');
        await this.mongoDatabaseManager.disconnectClientAsync(sourceClient);
        await this.mongoDatabaseManager.disconnectClientAsync(destinationClient);

        return lastCheckedId;
    }

    /**
     * runs the loop
     * @param {StartFromIdContainer} startFromIdContainer
     * @param {import('mongodb').Filter<import('mongodb').Document>} query
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }} config     * @param destinationCollectionName
     * @param {string} destinationCollectionName
     * @param {string} sourceCollectionName
     * @param {Moment} currentDateTime
     * @param {number} batchSize
     * @param {import('mongodb').Collection<import('mongodb').Document>|undefined} [projection]
     * @param {boolean} skipExistingIds
     * @param {number} numberOfSourceDocuments
     * @param {number} numberOfDestinationDocuments
     * @param {string} lastCheckedId
     * @param {function(document: import('mongodb').DefaultSchema):Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>} fnCreateBulkOperationAsync     * @param operations
     * @param {boolean|undefined} [ordered]
     * @returns {Promise<string>}
     */
    async runLoopAsync(
        {
            startFromIdContainer,
            query,
            config,
            destinationCollectionName,
            sourceCollectionName,
            currentDateTime,
            batchSize,
            projection,
            skipExistingIds,
            numberOfSourceDocuments,
            numberOfDestinationDocuments,
            lastCheckedId,
            fnCreateBulkOperationAsync,
            ordered
        }) {
        const maxTimeMS = 20 * 60 * 60 * 1000;
        const numberOfSecondsBetweenSessionRefreshes = 30;
        let loopRetryNumber = 0;
        const maxLoopRetries = 5;
        let continueLoop = true;
        let operations = [];
        let previouslyCheckedId = lastCheckedId;

        while (continueLoop && (loopRetryNumber < maxLoopRetries)) {
            if (startFromIdContainer.startFromId) {
                query.$and.push({'id': {$gt: startFromIdContainer.startFromId}});
            }

            loopRetryNumber += 1;

            try {
                let {
                    session,
                    sessionId,
                    sourceDb,
                    destinationCollection,
                    sourceCollection
                } = await this.createConnectionAsync(
                    {
                        config, destinationCollectionName, sourceCollectionName
                    });

                this.adminLogger.logTrace(`[${currentDateTime.toISOString()}] ` +
                `Sending query to Mongo: ${mongoQueryStringify(query)}. ` +
                `From ${sourceCollectionName} to ${destinationCollectionName}` +
                loopRetryNumber > 0 ? ` [Retry: ${loopRetryNumber}/${maxLoopRetries}]` : '');

                // pass session to find query per:
                // https://stackoverflow.com/questions/68607254/mongodb-node-js-driver-4-0-0-cursor-session-id-issues-in-production-on-vercel
                /**
                 * @type {FindCursor<WithId<import('mongodb').Document>>}
                 */
                let cursor = await sourceCollection
                    .find(query, {session, timeout: false, noCursorTimeout: true, maxTimeMS: maxTimeMS})
                    .sort({id: 1})
                    .maxTimeMS(maxTimeMS) // 20 hours
                    .batchSize(batchSize)
                    .addCursorFlag('noCursorTimeout', true);

                if (projection) {
                    cursor = cursor.project(projection);
                }

                let count = 0;
                var refreshTimestamp = moment(); // take note of time at operation start
                // const fnRefreshSessionAsync = async () => await db.admin().command({'refreshSessions': [sessionId]});
                // const fnRefreshSessionAsync = async () => {
                //     session = sourceClient.startSession();
                //     sessionId = session.serverSession.id;
                //     logInfo('Restarted session', {'session id': sessionId});
                // };
                while (await this.hasNext(cursor)) {
                    // Check if more than 5 minutes have passed since the last refresh
                    if (moment().diff(refreshTimestamp, 'seconds') > numberOfSecondsBetweenSessionRefreshes) {
                        this.adminLogger.logTrace(
                            `refreshing session with sessionId: ${JSON.stringify(sessionId)}`);
                        const memoryUsage = process.memoryUsage();
                        const memoryManager = new MemoryManager();
                        this.adminLogger.logTrace(`Memory used (RSS): ${memoryManager.formatBytes(memoryUsage.rss)}`);
                        /**
                         * @type {import('mongodb').Document}
                         */
                        const adminResult = await sourceDb.admin().command({'refreshSessions': [sessionId]});
                        this.adminLogger.logTrace(
                            `result from refreshing session: ${JSON.stringify(adminResult)}`);
                        refreshTimestamp = moment();
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
                    previouslyCheckedId = doc.id;
                    count += 1;
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(`[${moment().toISOString()}] ` +
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
                                this.adminLogger.logTrace('\n');
                                this.adminLogger.logTrace(
                                    `Writing ${operations.length.toLocaleString('en-US')} operations in bulk to ${destinationCollectionName}. ` +
                                    (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                                const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                                startFromIdContainer.nModified += bulkResult.nModified;
                                startFromIdContainer.nUpserted += bulkResult.nUpserted;
                                startFromIdContainer.startFromId = previouslyCheckedId;
                                operations = [];
                            },
                            {
                                retries: 5,
                            }
                        );
                        currentDateTime = moment();
                        const message =
                            `Processed ${startFromIdContainer.convertedIds.toLocaleString()}, ` +
                            `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                            `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')}, ` +
                            `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${previouslyCheckedId}`;
                        this.adminLogger.log('\n');
                        this.adminLogger.log(message);
                        // https://nodejs.org/api/process.html#process_process_memoryusage
                        // heapTotal and heapUsed refer to V8's memory usage.
                        // external refers to the memory usage of C++ objects bound to JavaScript objects managed by V8.
                        // rss, Resident Set Size, is the amount of space occupied in the main memory device (that is a subset of the total allocated memory) for the process, including all C++ and JavaScript objects and code.
                        // arrayBuffers refers to memory allocated for ArrayBuffers and SharedArrayBuffers, including all Node.js Buffers. This is also included in the external value. When Node.js is used as an embedded library, this value may be 0 because allocations for ArrayBuffers may not be tracked in that case.
                        const memoryUsage = process.memoryUsage();
                        const memoryManager = new MemoryManager();
                        this.adminLogger.logTrace(`Memory used (RSS): ${memoryManager.formatBytes(memoryUsage.rss)}`);
                    }
                }

                // now write out any remaining items
                if (operations.length > 0) { // if any items left to write
                    currentDateTime = moment();
                    await retry(
                        // eslint-disable-next-line no-loop-func
                        async (bail, retryNumber) => {
                            this.adminLogger.logTrace('\n');
                            this.adminLogger.logTrace(
                                `Final writing ${operations.length.toLocaleString('en-US')} operations in bulk to ${destinationCollectionName}. ` +
                                (retryNumber > 1 ? `retry=${retryNumber}` : ''));
                            const bulkResult = await destinationCollection.bulkWrite(operations, {ordered: ordered});
                            startFromIdContainer.nModified += bulkResult.nModified;
                            startFromIdContainer.nUpserted += bulkResult.nUpserted;
                            startFromIdContainer.startFromId = previouslyCheckedId;
                            const message =
                                `Final write ${startFromIdContainer.convertedIds.toLocaleString()} ` +
                                `modified: ${startFromIdContainer.nModified.toLocaleString('en-US')}, ` +
                                `upserted: ${startFromIdContainer.nUpserted.toLocaleString('en-US')} ` +
                                `from ${sourceCollectionName} to ${destinationCollectionName}. last id: ${previouslyCheckedId}`;
                            this.adminLogger.log('\n');
                            this.adminLogger.log(message);
                        },
                        {
                            retries: 5,
                        }
                    );
                }
                continueLoop = false; // done
            } catch (e) {
                if (e instanceof MongoNetworkTimeoutError) {
                    // statements to handle TypeError exceptions
                    this.adminLogger.logError(`Caught MongoNetworkTimeoutError: ${e}: ${JSON.stringify(e)}`);
                    continueLoop = true;
                } else {
                    this.adminLogger.logError(`Caught UnKnown error: ${e}: ${JSON.stringify(e)}`);
                    // statements to handle any unspecified exceptions
                    throw (e); // pass exception object to error handler
                }
            }
        }
        return previouslyCheckedId;
    }

    async createConnectionAsync({config, destinationCollectionName, sourceCollectionName}) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        let sourceClient = await this.mongoDatabaseManager.createClientAsync(config);
        /**
         * @type {import('mongodb').MongoClient}
         */
        let destinationClient = await this.mongoDatabaseManager.createClientAsync(config);
        /**
         * @type {import('mongodb').ClientSession}
         */
        let session = sourceClient.startSession();
        /**
         * @type {import('mongodb').ServerSessionId}
         */
        let sessionId = session.serverSession.id;
        this.adminLogger.logTrace(`Started session ${JSON.stringify(sessionId)}`);
        /**
         * @type {import('mongodb').Db}
         */
        const sourceDb = sourceClient.db(config.db_name);
        /**
         * @type {import('mongodb').Db}
         */
        const destinationDb = sourceClient.db(config.db_name);
        /**
         * @type {import('mongodb').Collection<import('mongodb').Document>}
         */
        const destinationCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: destinationDb, collectionName: destinationCollectionName
            }
        );
        /**
         * @type {import('mongodb').Collection}
         */
        const sourceCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: sourceDb, collectionName: sourceCollectionName
            }
        );
        return {sourceClient, destinationClient, session, sessionId, sourceDb, destinationCollection, sourceCollection};
    }

    /**
     *
     * @param {FindCursor<WithId<import('mongodb').Document>>} cursor
     * @returns {Promise<*>}
     */
    async next(cursor) {
        return await cursor.next();
    }

    /**
     *
     * @param {FindCursor<WithId<import('mongodb').Document>>} cursor
     * @returns {Promise<unknown>}
     */
    async hasNext(cursor) {
        // noinspection JSDeprecatedSymbols,JSCheckFunctionSignatures
        return await cursor.hasNext();
    }

    /**
     * gets all collection names
     * @param {boolean} useAuditDatabase
     * @param {boolean|undefined} [includeHistoryCollections]
     * @returns {Promise<string[]>}
     */
    async getAllCollectionNamesAsync({useAuditDatabase, includeHistoryCollections}) {
        const config = useAuditDatabase ? this.mongoDatabaseManager.getAuditConfig() : this.mongoDatabaseManager.getClientConfig();
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(config);
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
        await this.mongoDatabaseManager.disconnectClientAsync(client);
        return collectionNames;
    }
}

module.exports = {
    BaseBulkOperationRunner
};
