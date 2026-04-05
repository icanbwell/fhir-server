const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');
const { logInfo, logError, logDebug } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');

const SESSION_REFRESH_INTERVAL_SECONDS = 10 * 60; // 10 minutes

class HistorySyncJob {
    /**
     * @param {Object} params
     * @param {import('../../utils/mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./checkpointManager').CheckpointManager} params.checkpointManager
     * @param {import('./historySyncTransformer').HistorySyncTransformer} params.historySyncTransformer
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({
        mongoDatabaseManager,
        clickHouseClientManager,
        checkpointManager,
        historySyncTransformer,
        configManager
    }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
        this.clickHouseClientManager = clickHouseClientManager;
        this.checkpointManager = checkpointManager;
        this.historySyncTransformer = historySyncTransformer;
        this.configManager = configManager;

        /** @type {boolean} */
        this.shuttingDown = false;
    }

    /**
     * Executes a history sync job
     * @param {Object} command
     * @param {string} command.jobId
     * @param {string} command.resourceType
     * @param {string} [command.from]
     * @param {string} [command.to]
     * @returns {Promise<void>}
     */
    async executeAsync({ jobId, resourceType, from, to }) {
        logInfo('HistorySyncJob: starting', { args: { jobId, resourceType, from, to } });

        if (this.shuttingDown) {
            logInfo('HistorySyncJob: shutting down, skipping execution', {
                args: { jobId, resourceType }
            });
            return;
        }

        await this._syncResourceTypeAsync({ jobId, resourceType, from, to });

        logInfo('HistorySyncJob: completed', { args: { jobId } });
    }

    /**
     * Syncs a single resource type
     * @param {Object} params
     * @param {string} params.jobId
     * @param {string} params.resourceType
     * @param {string} [params.from]
     * @param {string} [params.to]
     * @returns {Promise<void>}
     */
    async _syncResourceTypeAsync({ jobId, resourceType, from, to }) {
        logInfo('HistorySyncJob: syncing resource type', {
            args: { jobId, resourceType, from, to }
        });

        const batchSize = this.configManager.historySyncBatchSize;
        const collectionName = `${resourceType}_4_0_0_History`;

        // Resolve start point
        let startId;
        if (from) {
            startId = ObjectId.createFromTime(Math.floor(new Date(from).getTime() / 1000));
        } else {
            const checkpoint = await this.checkpointManager.getCheckpointAsync(resourceType);
            if (checkpoint) {
                startId = new ObjectId(checkpoint.lastMongoId);
                logInfo('HistorySyncJob: resuming from checkpoint', {
                    args: { jobId, resourceType, lastMongoId: checkpoint.lastMongoId }
                });
            } else {
                startId = new ObjectId('000000000000000000000000');
                logInfo('HistorySyncJob: no checkpoint, starting from beginning', {
                    args: { jobId, resourceType }
                });
            }
        }

        // Build query
        const query = { _id: { $gt: startId } };
        if (to) {
            const endId = ObjectId.createFromTime(Math.floor(new Date(to).getTime() / 1000));
            query._id.$lte = endId;
        }

        // Open cursor using the migration runner pattern
        const historyDbConfig = await this.mongoDatabaseManager.getResourceHistoryConfigAsync();
        const historyDBClient = await this.mongoDatabaseManager.createClientAsync(historyDbConfig);
        let session;

        try {
            session = historyDBClient.startSession();
            const sessionId = session.serverSession.id;
            const historyDB = historyDBClient.db(historyDbConfig.db_name);
            const collection = historyDB.collection(collectionName);

            const cursor = collection
                .find(query)
                .sort({ _id: 1 })
                .maxTimeMS(20 * 60 * 60 * 1000) // 20 hours
                .batchSize(batchSize)
                .addCursorFlag('noCursorTimeout', true);

            let refreshTimestamp = moment();
            let batch = [];
            let batchMongoIds = [];
            let lastIsoDate = null;
            let totalProcessed = 0;
            let batchCount = 0;

            while (await cursor.hasNext()) {
                // Refresh session to prevent timeout
                if (moment().diff(refreshTimestamp, 'seconds') > SESSION_REFRESH_INTERVAL_SECONDS) {
                    logDebug('HistorySyncJob: refreshing MongoDB session', {
                        args: { jobId, resourceType, sessionId }
                    });
                    await historyDB.admin().command({ refreshSessions: [sessionId] });
                    refreshTimestamp = moment();
                }

                const doc = await cursor.next();
                if (!doc) {
                    break;
                }

                const row = this.historySyncTransformer.transform(doc);
                if (row) {
                    batch.push(row);
                    batchMongoIds.push(doc._id);
                    // Track original ISO date for checkpoint (not the ClickHouse-formatted one)
                    const lu = doc.resource?.meta?.lastUpdated;
                    lastIsoDate = lu instanceof Date ? lu.toISOString() : lu;
                }

                // Process batch when full
                if (batch.length >= batchSize) {
                    batchCount++;
                    await this._processBatchAsync({
                        jobId,
                        resourceType,
                        batch,
                        batchMongoIds,
                        lastIsoDate,
                        collection,
                        batchNumber: batchCount
                    });
                    totalProcessed += batch.length;
                    batch = [];
                    batchMongoIds = [];
                    lastIsoDate = null;

                    logInfo('HistorySyncJob: batch processed', {
                        args: { jobId, resourceType, batchNumber: batchCount, totalProcessed }
                    });

                    if (this.shuttingDown) {
                        logInfo('HistorySyncJob: shutting down after batch', {
                            args: { jobId, resourceType, batchNumber: batchCount }
                        });
                        break;
                    }
                }
            }

            // Process remaining documents
            if (batch.length > 0) {
                batchCount++;
                await this._processBatchAsync({
                    jobId,
                    resourceType,
                    batch,
                    batchMongoIds,
                    lastIsoDate,
                    collection,
                    batchNumber: batchCount
                });
                totalProcessed += batch.length;
            }

            // Mark checkpoint as completed after all batches processed
            await this.checkpointManager.completeCheckpointAsync(resourceType);

            logInfo('HistorySyncJob: resource type sync complete', {
                args: { jobId, resourceType, totalProcessed, batchCount }
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }

    /**
     * Processes a single batch: insert into ClickHouse, verify, delete from MongoDB, update checkpoint
     * @param {Object} params
     * @param {string} params.jobId
     * @param {string} params.resourceType
     * @param {Object[]} params.batch
     * @param {import('mongodb').ObjectId[]} params.batchMongoIds
     * @param {string} params.lastIsoDate
     * @param {import('mongodb').Collection} params.collection
     * @param {number} params.batchNumber
     * @returns {Promise<void>}
     */
    async _processBatchAsync({ jobId, resourceType, batch, batchMongoIds, lastIsoDate, collection, batchNumber }) {
        // 1. Insert into ClickHouse with retry
        await this._insertWithRetryAsync(batch);

        // 2. Verify insert using range query (avoids ClickHouse field size limit with large batches)
        const firstMongoId = batch[0].mongo_id;
        const lastMongoId = batch[batch.length - 1].mongo_id;
        const verified = await this._verifyInsertAsync(resourceType, batch.length, firstMongoId, lastMongoId);
        if (!verified) {
            throw new Error(
                `HistorySyncJob: ClickHouse verification failed for batch ${batchNumber} ` +
                `of ${resourceType} (expected ${batch.length} rows)`
            );
        }

        // 3. Delete from MongoDB (non-fatal on failure, disabled by default)
        if (this.configManager.historySyncDeleteFromMongo) {
            try {
                const deleteResult = await collection.deleteMany({ _id: { $in: batchMongoIds } });
                logDebug('HistorySyncJob: deleted from MongoDB', {
                    args: { jobId, resourceType, batchNumber, deletedCount: deleteResult.deletedCount }
                });
            } catch (deleteError) {
                logError('HistorySyncJob: MongoDB delete failed (non-fatal, data safe in ClickHouse)', {
                    args: { jobId, resourceType, batchNumber, error: deleteError.message }
                });
            }
        }

        // 4. Update checkpoint with last mongo_id and original ISO date
        const lastDoc = batch[batch.length - 1];
        await this.checkpointManager.updateCheckpointAsync(
            resourceType,
            lastDoc.mongo_id,
            lastIsoDate
        );
    }

    /**
     * Inserts batch into ClickHouse with retry
     * @param {Object[]} batch
     * @returns {Promise<void>}
     */
    async _insertWithRetryAsync(batch) {
        const maxRetries = this.configManager.historySyncMaxRetries;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.clickHouseClientManager.insertAsync({
                    table: 'fhir.fhir_resource_history',
                    values: batch,
                    format: 'JSONEachRow'
                });
                return;
            } catch (error) {
                lastError = error;
                logError('HistorySyncJob: ClickHouse insert failed', {
                    args: { attempt, maxRetries, error: error.message }
                });
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new RethrownError({
            message: `ClickHouse insert failed after ${maxRetries} attempts`,
            error: lastError
        });
    }

    /**
     * Verifies that the batch was written to ClickHouse using a range query
     * @param {string} resourceType
     * @param {number} expectedCount
     * @param {string} firstMongoId
     * @param {string} lastMongoId
     * @returns {Promise<boolean>}
     */
    async _verifyInsertAsync(resourceType, expectedCount, firstMongoId, lastMongoId) {
        try {
            const result = await this.clickHouseClientManager.queryAsync({
                query: `SELECT count() as cnt FROM fhir.fhir_resource_history
                    WHERE resource_type = {resourceType:String}
                    AND mongo_id >= {firstId:String}
                    AND mongo_id <= {lastId:String}`,
                query_params: { resourceType, firstId: firstMongoId, lastId: lastMongoId }
            });
            const count = result?.[0]?.cnt || 0;
            return Number(count) >= expectedCount;
        } catch (error) {
            logError('HistorySyncJob: ClickHouse verification query failed', {
                args: { error: error.message }
            });
            return false;
        }
    }
}

module.exports = { HistorySyncJob };
