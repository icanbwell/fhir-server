const { assertTypeEquals } = require('../../utils/assertType');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { generateUUID } = require('../../utils/uid.util');
const { filterJsonByKeys } = require('../../utils/object');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY } = require('../../constants');
const { RethrownError } = require('../../utils/rethrownError');
const { ConfigManager } = require('../../utils/configManager');
const moment = require('moment-timezone');
const { ObjectId } = require('mongodb');
const { BaseScriptRunner } = require('./baseScriptRunner');

/**
 * @classdesc migrates History data to cloud storage, adding link in original document
 */
class MigrateHistoryToCloudStorageRunner extends BaseScriptRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string} collectionName,
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {number|undefined} limit
     * @param {number|undefined} skip
     * @param {string|undefined} startFromId
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     * @param {ConfigManager} configManager
     */
    constructor({
        mongoCollectionManager,
        mongoDatabaseManager,
        collectionName,
        batchSize,
        adminLogger,
        limit,
        startAfterId,
        historyResourceCloudStorageClient,
        configManager
    }) {
        super({
            mongoCollectionManager,
            adminLogger,
            mongoDatabaseManager
        });

        /**
         * @type {string}
         */
        this.collectionName = collectionName;

        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {string|undefined}
         */
        this.startAfterId = startAfterId;

        /**
         * @type {CloudStorageClient | null}
         */
        this.historyResourceCloudStorageClient = historyResourceCloudStorageClient;
        if (historyResourceCloudStorageClient) {
            assertTypeEquals(historyResourceCloudStorageClient, CloudStorageClient);
        }

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.documentsUploaded = 0;
        this.documentsUpdated = 0;
        this.documentsSkipped = 0;
        this.batchCount = 1;
        this.lastBatchDocId = null;
        this.historyBatch = [];
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        const operations = [];
        // skip if record is in old format where resource is stored at top level
        if (!doc.resource) {
            this.adminLogger.logError(
                `Resource with _id: ${doc._id} is in old format of history and is skipped`
            );
            this.documentsSkipped += 1;
            return [];
        }
        const fileId = generateUUID();

        const filePath = `${this.collectionName}/${doc.resource._uuid}/${fileId}.json`;
        // upload doc to S3
        try {
            await this.historyResourceCloudStorageClient.uploadAsync({
                filePath,
                data: Buffer.from(JSON.stringify(doc))
            });
        } catch (error) {
            this.adminLogger.logError(
                `Failed to upload resource with _id: ${doc._id} to cloud storage and is skipped due to error: ${error}`
            );
            this.documentsSkipped += 1;
            return [];
        }

        // filter only required fields to be saved in MongoDB
        let filteredDoc = filterJsonByKeys(doc, this.configManager.historyResourceMongodbFields);
        filteredDoc[RESOURCE_CLOUD_STORAGE_PATH_KEY] = fileId;
        operations.push({
            replaceOne: {
                filter: {
                    _id: doc._id
                },
                replacement: filteredDoc
            }
        });
        this.documentsUploaded += 1;
        return operations;
    }

    /**
     * Process all documents in current batch
     * @param {import('mongodb').Collection<import('mongodb').Document>} collection
     * @param {import('mongodb').ClientSession} session
     * @returns {Promise<void>}
     */
    async processBatch(collection, session) {
        this.adminLogger.logInfo(`Processing Batch ${this.batchCount}`);
        let operations = await Promise.all(
            this.historyBatch.map(async (hisResource) => {
                return await this.processRecordAsync(hisResource);
            })
        );
        const bulkResult = await collection.bulkWrite(operations.flat(), {
            session
        });
        this.lastProcessId = this.lastBatchDocId;
        this.documentsUpdated += bulkResult.modifiedCount;
        this.historyBatch = [];

        const message =
            `Processed batch ${this.batchCount}, ` +
            `modified: ${bulkResult.modifiedCount}, ` +
            `upserted: ${bulkResult.upsertedCount}, ` +
            `last id: ${this.lastProcessId}`;
        this.adminLogger.logInfo(message);
        this.batchCount += 1;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        if (!this.collectionName.endsWith('_History')) {
            this.adminLogger.logError(
                `Only History collections are supported. Provided collection name: ${this.collectionName}`
            );
        }
        let query = { [RESOURCE_CLOUD_STORAGE_PATH_KEY]: { $exists: false } };

        if (this.startAfterId) {
            query = { $and: [query, { _id: { $gt: new ObjectId(this.startAfterId) } }] };
        }

        try {
            try {
                const historyDbConfig =
                    await this.mongoDatabaseManager.getResourceHistoryConfigAsync();
                const historyDBClient =
                    await this.mongoDatabaseManager.createClientAsync(historyDbConfig);

                const session = historyDBClient.startSession();

                /**
                 * @type {import('mongodb').ServerSessionId}
                 */
                const sessionId = session.serverSession.id;
                this.adminLogger.logInfo('Started Mongo session', { 'session id': sessionId });

                const historyDB = historyDBClient.db(historyDbConfig.db_name);
                const historyCollection =
                    await this.mongoCollectionManager.getOrCreateCollectionAsync({
                        db: historyDB,
                        collectionName: this.collectionName
                    });

                /**
                 * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
                 */
                let cursor = await historyCollection
                    .find(query)
                    .sort({ _id: 1 })
                    .maxTimeMS(20 * 60 * 60 * 1000) // 20 hours
                    .batchSize(this.batchSize)
                    .addCursorFlag('noCursorTimeout', true);

                if (this.limit) {
                    cursor = cursor.limit(this.limit);
                }

                let refreshTimestamp = moment(); // take note of time at operation start
                const numberOfSecondsBetweenSessionRefreshes = 10 * 60; // 10mins

                while (await cursor.hasNext()) {
                    if (
                        moment().diff(refreshTimestamp, 'seconds') >
                        numberOfSecondsBetweenSessionRefreshes
                    ) {
                        this.adminLogger.logInfo('refreshing session with sessionId', {
                            session_id: sessionId
                        });
                        /**
                         * @type {import('mongodb').Document}
                         */
                        const adminResult = await historyDB
                            .admin()
                            .command({ refreshSessions: [sessionId] });
                        this.adminLogger.logInfo('result from refreshing session', {
                            result: adminResult
                        });
                        refreshTimestamp = moment();
                    }

                    let historyResource = await cursor.next();
                    if (!historyResource) {
                        this.adminLogger.logError('error in getting next document from cursor');
                        break;
                    }

                    this.historyBatch.push(historyResource);
                    this.lastBatchDocId = historyResource._id;

                    if (this.historyBatch.length >= this.batchSize) {
                        await this.processBatch(historyCollection, session);
                    }
                }
                if (this.historyBatch.length > 0) {
                    await this.processBatch(historyCollection, session);
                }
                await session.endSession();
            } catch (e) {
                console.log(e.message, e);
                this.adminLogger.logError(
                    `Got error ${e}. Last processed _id: ${this.lastProcessId}. Successfully updated ${this.documentsUpdated} documents`,
                    { upload_count: this.documentsUploaded, skip_count: this.documentsSkipped }
                );

                throw new RethrownError({
                    message: `Error processing history cloud storage upload for ${this.collectionName}: ${e.message}`,
                    error: e,
                    args: {
                        query
                    },
                    source: 'MigrateHistoryToCloudStorageRunner.processAsync'
                });
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo(
                `Last processed _id: ${this.lastProcessId}. Successfully updated ${this.documentsUpdated} documents`,
                { upload_count: this.documentsUploaded, skip_count: this.documentsSkipped }
            );
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    MigrateHistoryToCloudStorageRunner
};
