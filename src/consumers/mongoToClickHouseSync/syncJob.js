const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');
const { logInfo, logError, logDebug } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');

const SESSION_REFRESH_INTERVAL_SECONDS = 10 * 60; // 10 minutes

class SyncJob {
    /**
     * @param {Object} params
     * @param {import('../../utils/mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./checkpointManager').CheckpointManager} params.checkpointManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({
        mongoDatabaseManager,
        clickHouseClientManager,
        checkpointManager,
        configManager
    }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
        this.clickHouseClientManager = clickHouseClientManager;
        this.checkpointManager = checkpointManager;
        this.configManager = configManager;

        /** @type {boolean} */
        this.shuttingDown = false;
    }

    /**
     * Executes a sync job using the provided profile
     * @param {Object} command
     * @param {string} command.jobId
     * @param {string} [command.syncType]
     * @param {string} [command.resourceType]
     * @param {string} [command.collection]
     * @param {string} [command.from]
     * @param {string} [command.to]
     * @param {Object} profile - sync profile defining DB config, transformer, etc.
     * @returns {Promise<void>}
     */
    async executeAsync(command, profile) {
        logInfo('SyncJob: starting', {
            args: { jobId: command.jobId, syncType: profile.syncType, resourceType: command.resourceType }
        });

        if (this.shuttingDown) {
            logInfo('SyncJob: shutting down, skipping execution', {
                args: { jobId: command.jobId }
            });
            return;
        }

        await this._syncCollectionAsync(command, profile);

        logInfo('SyncJob: completed', { args: { jobId: command.jobId } });
    }

    /**
     * Syncs a single collection
     * @param {Object} command
     * @param {Object} profile
     * @returns {Promise<void>}
     */
    async _syncCollectionAsync(command, profile) {
        const collectionName = profile.getCollectionName(command);
        const checkpointKey = profile.getCheckpointKey(command);
        const batchSize = profile.getBatchSize(this.configManager);
        const deleteFromMongo = profile.getDeleteFromMongo(this.configManager);

        logInfo('SyncJob: syncing collection', {
            args: {
                jobId: command.jobId,
                syncType: profile.syncType,
                collectionName,
                checkpointKey
            }
        });

        // Resolve start point
        let startId;
        if (command.from) {
            startId = ObjectId.createFromTime(Math.floor(new Date(command.from).getTime() / 1000));
        } else {
            const checkpoint = await this.checkpointManager.getCheckpointAsync(checkpointKey);
            if (checkpoint) {
                startId = new ObjectId(checkpoint.lastMongoId);
                logInfo('SyncJob: resuming from checkpoint', {
                    args: { jobId: command.jobId, checkpointKey, lastMongoId: checkpoint.lastMongoId }
                });
            } else {
                startId = new ObjectId('000000000000000000000000');
                logInfo('SyncJob: no checkpoint, starting from beginning', {
                    args: { jobId: command.jobId, checkpointKey }
                });
            }
        }

        // Build query
        const query = { _id: { $gt: startId } };
        if (command.to) {
            const endId = ObjectId.createFromTime(Math.floor(new Date(command.to).getTime() / 1000));
            query._id.$lte = endId;
        }

        // Open cursor using the DB config from the profile
        const dbConfig = await profile.getDbConfigAsync(this.mongoDatabaseManager);
        const dbClient = await this.mongoDatabaseManager.createClientAsync(dbConfig);
        let session;

        try {
            session = dbClient.startSession();
            const sessionId = session.serverSession.id;
            const db = dbClient.db(dbConfig.db_name);
            const collection = db.collection(collectionName);

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
                    logDebug('SyncJob: refreshing MongoDB session', {
                        args: { jobId: command.jobId, collectionName, sessionId }
                    });
                    await db.admin().command({ refreshSessions: [sessionId] });
                    refreshTimestamp = moment();
                }

                const doc = await cursor.next();
                if (!doc) {
                    break;
                }

                const row = profile.transformer.transform(doc);
                if (row) {
                    batch.push(row);
                    batchMongoIds.push(doc._id);
                    // Track original ISO date for checkpoint
                    lastIsoDate = profile.getTimestamp(doc);
                }

                // Process batch when full
                if (batch.length >= batchSize) {
                    batchCount++;
                    await this._processBatchAsync({
                        command,
                        profile,
                        batch,
                        batchMongoIds,
                        lastIsoDate,
                        collection,
                        batchNumber: batchCount,
                        deleteFromMongo
                    });
                    totalProcessed += batch.length;
                    batch = [];
                    batchMongoIds = [];
                    lastIsoDate = null;

                    logInfo('SyncJob: batch processed', {
                        args: {
                            jobId: command.jobId,
                            collectionName,
                            batchNumber: batchCount,
                            totalProcessed
                        }
                    });

                    if (this.shuttingDown) {
                        logInfo('SyncJob: shutting down after batch', {
                            args: { jobId: command.jobId, collectionName, batchNumber: batchCount }
                        });
                        break;
                    }
                }
            }

            // Process remaining documents
            if (batch.length > 0) {
                batchCount++;
                await this._processBatchAsync({
                    command,
                    profile,
                    batch,
                    batchMongoIds,
                    lastIsoDate,
                    collection,
                    batchNumber: batchCount,
                    deleteFromMongo
                });
                totalProcessed += batch.length;
            }

            // Mark checkpoint as completed after all batches processed
            await this.checkpointManager.completeCheckpointAsync(checkpointKey);

            logInfo('SyncJob: collection sync complete', {
                args: { jobId: command.jobId, collectionName, totalProcessed, batchCount }
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
     * @param {Object} params.command
     * @param {Object} params.profile
     * @param {Object[]} params.batch
     * @param {import('mongodb').ObjectId[]} params.batchMongoIds
     * @param {string} params.lastIsoDate
     * @param {import('mongodb').Collection} params.collection
     * @param {number} params.batchNumber
     * @param {boolean} params.deleteFromMongo
     * @returns {Promise<void>}
     */
    async _processBatchAsync({
        command,
        profile,
        batch,
        batchMongoIds,
        lastIsoDate,
        collection,
        batchNumber,
        deleteFromMongo
    }) {
        // 1. Insert into ClickHouse with retry
        await this._insertWithRetryAsync(batch, profile.clickHouseTable);

        // 2. Verify insert using profile-specific query
        const firstMongoId = batch[0].mongo_id;
        const lastMongoId = batch[batch.length - 1].mongo_id;
        const verified = await this._verifyInsertAsync(command, profile, batch.length, firstMongoId, lastMongoId);
        if (!verified) {
            throw new Error(
                `SyncJob: ClickHouse verification failed for batch ${batchNumber} ` +
                `(expected ${batch.length} rows)`
            );
        }

        // 3. Delete from MongoDB (non-fatal on failure, disabled by default)
        if (deleteFromMongo) {
            try {
                const deleteResult = await collection.deleteMany({ _id: { $in: batchMongoIds } });
                logDebug('SyncJob: deleted from MongoDB', {
                    args: { jobId: command.jobId, batchNumber, deletedCount: deleteResult.deletedCount }
                });
            } catch (deleteError) {
                logError('SyncJob: MongoDB delete failed (non-fatal, data safe in ClickHouse)', {
                    args: { jobId: command.jobId, batchNumber, error: deleteError.message }
                });
            }
        }

        // 4. Update checkpoint with last mongo_id and original ISO date
        const checkpointKey = profile.getCheckpointKey(command);
        const lastDoc = batch[batch.length - 1];
        await this.checkpointManager.updateCheckpointAsync(
            checkpointKey,
            lastDoc.mongo_id,
            lastIsoDate
        );
    }

    /**
     * Inserts batch into ClickHouse with retry
     * @param {Object[]} batch
     * @param {string} tableName
     * @returns {Promise<void>}
     */
    async _insertWithRetryAsync(batch, tableName) {
        const maxRetries = this.configManager.historySyncMaxRetries;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.clickHouseClientManager.insertAsync({
                    table: tableName,
                    values: batch,
                    format: 'JSONEachRow'
                });
                return;
            } catch (error) {
                lastError = error;
                logError('SyncJob: ClickHouse insert failed', {
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
     * Verifies that the batch was written to ClickHouse using a profile-specific query
     * @param {Object} command
     * @param {Object} profile
     * @param {number} expectedCount
     * @param {string} firstMongoId
     * @param {string} lastMongoId
     * @returns {Promise<boolean>}
     */
    async _verifyInsertAsync(command, profile, expectedCount, firstMongoId, lastMongoId) {
        try {
            const { query, query_params } = profile.getVerificationQuery(command, firstMongoId, lastMongoId);
            const result = await this.clickHouseClientManager.queryAsync({
                query,
                query_params
            });
            const count = result?.[0]?.cnt || 0;
            return Number(count) >= expectedCount;
        } catch (error) {
            logError('SyncJob: ClickHouse verification query failed', {
                args: { error: error.message }
            });
            return false;
        }
    }
}

module.exports = { SyncJob };
