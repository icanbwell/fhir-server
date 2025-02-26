const moment = require('moment-timezone');
const { logError, logInfo } = require('../../common/logging');
const { generateUUID } = require('../../../utils/uid.util');
const { filterJsonByKeys } = require('../../../utils/object');
const { assertTypeEquals } = require('../../../utils/assertType');
const { RESOURCE_CLOUD_STORAGE_PATH_KEY, HISTORY_MIGRATION_LAST_UPDATED_DEFAULT_TIME } = require('../../../constants');
const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
const { CloudStorageClient } = require('../../../utils/cloudStorageClient');
const { ConfigManager } = require('../../../utils/configManager');
const { RethrownError } = require('../../../utils/rethrownError');

/**
 * @classdesc migrates History data to cloud storage, adding link in original document
 */
class MigrateToCloudStorageRunner {
    /**
     * constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string} collectionName,
     * @param {number} batchSize
     * @param {number|undefined} limit
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     * @param {ConfigManager} configManager
     */
    constructor({ mongoDatabaseManager, collectionName, batchSize, limit, historyResourceCloudStorageClient, configManager }) {
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
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

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
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)|null>}
     */
    async processRecordAsync(doc) {
        // skip if record is in old format where resource is stored at top level
        if (!doc.resource) {
            logError(`Resource with _id: ${doc._id} is in old format of history and is skipped`);
            this.documentsSkipped += 1;
            return null;
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
            logError(`Failed to upload resource with _id: ${doc._id} to cloud storage and is skipped due to error: ${error}`);
            this.documentsSkipped += 1;
            return null;
        }

        // filter only required fields to be saved in MongoDB
        let filteredDoc = filterJsonByKeys(doc, this.configManager.historyResourceMongodbFields);
        filteredDoc[RESOURCE_CLOUD_STORAGE_PATH_KEY] = fileId;
        this.documentsUploaded += 1;
        return {
            replaceOne: {
                filter: {
                    _id: doc._id
                },
                replacement: filteredDoc
            }
        };
    }

    /**
     * Process all documents in current batch
     * @param {import('mongodb').Collection<import('mongodb').Document>} collection
     * @param {import('mongodb').ClientSession} session
     * @returns {Promise<void>}
     */
    async processBatch(collection, session) {
        logInfo(`Processing Batch ${this.batchCount}`);
        let operations = await Promise.all(
            this.historyBatch.map(async (hisResource) => {
                return await this.processRecordAsync(hisResource);
            })
        );
        const bulkResult = await collection.bulkWrite(
            operations.filter((item) => item !== null),
            {
                session
            }
        );
        this.lastProcessId = this.lastBatchDocId;
        this.documentsUpdated += bulkResult.modifiedCount;
        this.historyBatch = [];

        const message =
            `Processed batch ${this.batchCount}, ` +
            `modified: ${bulkResult.modifiedCount}, ` +
            `upserted: ${bulkResult.upsertedCount}, ` +
            `last id: ${this.lastProcessId}`;
        logInfo(message);
        this.batchCount += 1;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        let query = {
            [RESOURCE_CLOUD_STORAGE_PATH_KEY]: { $exists: false },
            'resource.meta.lastUpdated': { $lt: new Date(Date.now() - HISTORY_MIGRATION_LAST_UPDATED_DEFAULT_TIME) }
        };

        try {
            try {
                const historyDbConfig = await this.mongoDatabaseManager.getResourceHistoryConfigAsync();
                const historyDBClient = await this.mongoDatabaseManager.createClientAsync(historyDbConfig);

                const session = historyDBClient.startSession();

                /**
                 * @type {import('mongodb').ServerSessionId}
                 */
                const sessionId = session.serverSession.id;
                logInfo('Started Mongo session', { 'session id': sessionId });

                const historyDB = historyDBClient.db(historyDbConfig.db_name);
                const historyCollection = historyDB.collection(this.collectionName);

                /**
                 * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
                 */
                let cursor = historyCollection
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
                    if (moment().diff(refreshTimestamp, 'seconds') > numberOfSecondsBetweenSessionRefreshes) {
                        logInfo('refreshing session with sessionId', {
                            session_id: sessionId
                        });
                        /**
                         * @type {import('mongodb').Document}
                         */
                        const adminResult = await historyDB.admin().command({ refreshSessions: [sessionId] });
                        logInfo('result from refreshing session', {
                            result: adminResult
                        });
                        refreshTimestamp = moment();
                    }

                    let historyResource = await cursor.next();
                    if (!historyResource) {
                        logError('error in getting next document from cursor');
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
                logError(`Got error ${e}. Last processed _id: ${this.lastProcessId}. Successfully updated ${this.documentsUpdated} documents`, {
                    upload_count: this.documentsUploaded,
                    skip_count: this.documentsSkipped
                });

                throw new RethrownError({
                    message: `Error processing history cloud storage upload for ${this.collectionName}: ${e.message}`,
                    error: e,
                    args: {
                        query
                    },
                    source: 'MigrateToCloudStorageRunner.processAsync'
                });
            }

            logInfo(`Finished script. Last processed _id: ${this.lastProcessId}. Successfully updated ${this.documentsUpdated} documents`, {
                upload_count: this.documentsUploaded,
                skip_count: this.documentsSkipped
            });
        } catch (e) {
            logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    MigrateToCloudStorageRunner
};
