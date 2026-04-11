/**
 * Processes a single daily partition: reads AuditEvent docs from Atlas Data Federation,
 * transforms them, and inserts into ClickHouse in batches.
 *
 * Resume-safe: if interrupted, resumes from last_mongo_id checkpoint.
 */

const { ObjectId } = require('mongodb');
const { AuditEventTransformer } = require('./auditEventTransformer');
const { logInfo, logWarn } = require('../../operations/common/logging');

class PartitionWorker {
    /**
     * @param {Object} params
     * @param {import('mongodb').Db} params.sourceDb - Atlas Data Federation database
     * @param {string} params.collectionName - Source collection name
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./migrationStateManager').MigrationStateManager} params.stateManager
     * @param {number} params.batchSize
     * @param {boolean} params.dryRun
     */
    constructor({
        sourceDb,
        collectionName,
        clickHouseClientManager,
        stateManager,
        batchSize,
        dryRun
    }) {
        this.sourceDb = sourceDb;
        this.collectionName = collectionName;
        this.clickHouseClientManager = clickHouseClientManager;
        this.stateManager = stateManager;
        this.batchSize = batchSize;
        this.dryRun = dryRun;
        this.transformer = new AuditEventTransformer();
    }

    /**
     * Process a single day partition
     * @param {Object} params
     * @param {string} params.partitionDay - 'YYYY-MM-DD'
     * @param {string} params.lastMongoId - Resume point (empty string if fresh start)
     * @returns {Promise<{insertedCount: number, sourceCount: number, skippedCount: number}>}
     */
    async processAsync({ partitionDay, lastMongoId }) {
        const dayStart = new Date(partitionDay + 'T00:00:00.000Z');
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

        const collection = this.sourceDb.collection(this.collectionName);

        // Build query: filter by recorded date range + resume from last_mongo_id
        // Use Date objects (not ISO strings) so the query matches both ISODate and string storage
        const query = {
            recorded: { $gte: dayStart, $lt: dayEnd }
        };
        if (lastMongoId) {
            query._id = { $gt: new ObjectId(lastMongoId) };
        }

        // Get source count for this day (for verification)
        const sourceCountQuery = {
            recorded: { $gte: dayStart, $lt: dayEnd }
        };
        const sourceCount = await collection.countDocuments(sourceCountQuery);

        if (sourceCount === 0) {
            await this.stateManager.markCompletedAsync({
                partitionDay,
                insertedCount: 0,
                sourceCount: 0
            });
            return { insertedCount: 0, sourceCount: 0, skippedCount: 0 };
        }

        await this.stateManager.markInProgressAsync(partitionDay);

        const cursor = collection.find(query).sort({ _id: 1 }).batchSize(this.batchSize);

        let batch = [];
        let insertedCount = lastMongoId
            ? await this._getExistingInsertedCountAsync(partitionDay)
            : 0;
        let skippedCount = 0;
        let lastId = lastMongoId;

        try {
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                batch.push(doc);

                if (batch.length >= this.batchSize) {
                    logInfo('Batch insert starting', {
                        partitionDay,
                        batchSize: batch.length,
                        firstId: batch[0]._id.toString(),
                        firstRecorded: batch[0].recorded,
                        lastId: batch[batch.length - 1]._id.toString(),
                        lastRecorded: batch[batch.length - 1].recorded
                    });

                    const result = await this._processBatchAsync(batch);
                    insertedCount += result.inserted;
                    skippedCount += result.skipped;

                    lastId = batch[batch.length - 1]._id.toString();

                    // Checkpoint after each batch
                    await this.stateManager.updateCheckpointAsync({
                        partitionDay,
                        lastMongoId: lastId,
                        insertedCount
                    });

                    batch = [];
                }
            }

            // Process remaining docs
            if (batch.length > 0) {
                logInfo('Batch insert starting', {
                    partitionDay,
                    batchSize: batch.length,
                    firstId: batch[0]._id.toString(),
                    firstRecorded: batch[0].recorded,
                    lastId: batch[batch.length - 1]._id.toString(),
                    lastRecorded: batch[batch.length - 1].recorded
                });

                const result = await this._processBatchAsync(batch);
                insertedCount += result.inserted;
                skippedCount += result.skipped;
                lastId = batch[batch.length - 1]._id.toString();
            }

            // Mark completed
            await this.stateManager.markCompletedAsync({
                partitionDay,
                insertedCount,
                sourceCount,
                lastMongoId: lastId
            });

            return { insertedCount, sourceCount, skippedCount };
        } catch (error) {
            await this.stateManager.markFailedAsync({
                partitionDay,
                errorMessage: error.message,
                insertedCount
            });
            throw error;
        } finally {
            await cursor.close();
        }
    }

    /**
     * Transform and insert a batch into ClickHouse
     * @private
     * @param {Object[]} docs
     * @returns {Promise<{inserted: number, skipped: number}>}
     */
    async _processBatchAsync(docs) {
        const { rows, skipped } = this.transformer.transformBatch(docs);

        if (rows.length > 0 && !this.dryRun) {
            await this._insertWithRetryAsync(rows);
        }

        return { inserted: rows.length, skipped };
    }

    /**
     * Insert rows into ClickHouse. On failure, splits the batch in half and
     * retries each half recursively. Once the batch is small enough
     * (≤ MIN_CHUNK_SIZE), falls back to exponential backoff retries.
     * @private
     * @param {Object[]} rows
     * @returns {Promise<void>}
     */
    async _insertWithRetryAsync(rows) {
        const MIN_CHUNK_SIZE = 1000;

        try {
            await this.clickHouseClientManager.insertAsync({
                table: 'fhir.AuditEvent_4_0_0',
                values: rows,
                format: 'JSONEachRow'
            });
        } catch (error) {
            const errorMsg = error.original_error?.message || error.nested?.message || error.message;
            const isSizeError = errorMsg === 'Invalid string length' ||
                errorMsg.includes('string length') ||
                errorMsg.includes('allocation failed');

            if (isSizeError && rows.length > MIN_CHUNK_SIZE) {
                const mid = Math.ceil(rows.length / 2);
                logWarn('ClickHouse insert failed due to payload size, splitting batch', {
                    originalSize: rows.length,
                    newSize: mid,
                    error: error.message
                });
                await this._insertWithRetryAsync(rows.slice(0, mid));
                await this._insertWithRetryAsync(rows.slice(mid));
            } else {
                // Non-size error or already small batch — retry with exponential backoff
                const maxRetries = 3;
                let delay = 2000;
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        await this.clickHouseClientManager.insertAsync({
                            table: 'fhir.AuditEvent_4_0_0',
                            values: rows,
                            format: 'JSONEachRow'
                        });
                        return;
                    } catch (retryError) {
                        if (attempt === maxRetries) {
                            throw new Error(
                                `ClickHouse insert failed after ${maxRetries} attempts (batch size ${rows.length}): ${retryError.message}`
                            );
                        }
                        logWarn('ClickHouse insert failed, retrying', {
                            attempt,
                            batchSize: rows.length,
                            delay,
                            error: retryError.message
                        });
                        await new Promise((resolve) => setTimeout(resolve, delay));
                        delay *= 2;
                    }
                }
            }
        }
    }

    /**
     * Gets the current inserted count for a partition being resumed
     * @private
     * @param {string} partitionDay
     * @returns {Promise<number>}
     */
    async _getExistingInsertedCountAsync(partitionDay) {
        const state = await this.stateManager.getStateForDayAsync(partitionDay);
        return Number(state?.inserted_count) || 0;
    }
}

module.exports = { PartitionWorker };
