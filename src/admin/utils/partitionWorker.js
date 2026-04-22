/**
 * Processes a single daily partition: reads AuditEvent docs from Atlas Data Federation,
 * transforms them, and inserts into ClickHouse in batches.
 *
 * Resume-safe: if interrupted, resumes from last_mongo_id checkpoint.
 */

const { ObjectId } = require('mongodb');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { logInfo, logWarn } = require('../../operations/common/logging');

/**
 * Normalize a `recorded` field value to an ISO-8601 string for checkpoint storage.
 * Online Archive may return either a Date (ISODate-backed docs) or a string
 * (legacy string-backed docs); both need to round-trip back through
 * `new Date(lastRecorded)` on resume.
 * @param {Date|string|null|undefined} value
 * @returns {string}
 */
function toIsoString(value) {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    // Already a string; trust it if it parses, otherwise store as-is so a human
    // can investigate rather than silently losing the checkpoint.
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

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
     * @param {string} params.lastMongoId - Resume point _id (empty string if fresh start)
     * @param {string} params.lastRecorded - Resume point `recorded` ISO-8601 (empty string if fresh start)
     * @returns {Promise<{insertedCount: number, sourceCount: number, skippedCount: number}>}
     */
    async processAsync({ partitionDay, lastMongoId, lastRecorded }) {
        const dayStart = new Date(partitionDay + 'T00:00:00.000Z');
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

        const collection = this.sourceDb.collection(this.collectionName);

        // Build query: filter by recorded date range + resume from (recorded, _id) checkpoint.
        //
        // Ordering by (recorded, _id) matches the Online Archive partition layout
        // (archive field is `recorded`), so the federation engine can stream S3 objects
        // in order instead of materializing + sorting a full day's worth of documents.
        //
        // Resume filter uses $or so the `recorded` bound can prune S3 partitions on the
        // archive side, unlike a bare `_id: {$gt}` which would force a full-day scan.
        let query;
        if (lastRecorded && lastMongoId) {
            const lastRecordedDate = new Date(lastRecorded);
            query = {
                $and: [
                    { recorded: { $gte: dayStart, $lt: dayEnd } },
                    {
                        $or: [
                            { recorded: { $gt: lastRecordedDate } },
                            {
                                recorded: lastRecordedDate,
                                _id: { $gt: new ObjectId(lastMongoId) }
                            }
                        ]
                    }
                ]
            };
        } else {
            query = { recorded: { $gte: dayStart, $lt: dayEnd } };
        }

        // Get source count for this day (for verification)
        const sourceCountQuery = {
            recorded: { $gte: dayStart, $lt: dayEnd }
        };
        logInfo('MongoDB query', {
            operation: 'countDocuments',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionDay,
            query: sourceCountQuery
        });
        const sourceCount = await collection.countDocuments(sourceCountQuery);

        if (this.dryRun) {
            logInfo('Dry run partition count', {
                partitionDay,
                sourceCount
            });
        }

        if (sourceCount === 0) {
            await this.stateManager.markCompletedAsync({
                partitionDay,
                insertedCount: 0,
                sourceCount: 0
            });
            return { insertedCount: 0, sourceCount: 0, skippedCount: 0 };
        }

        await this.stateManager.markInProgressAsync(partitionDay);

        const sort = { recorded: 1, _id: 1 };
        logInfo('MongoDB query', {
            operation: 'find',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionDay,
            query,
            sort,
            batchSize: this.batchSize
        });
        const cursor = collection.find(query).sort(sort).batchSize(this.batchSize);

        let batch = [];
        let insertedCount = lastMongoId
            ? await this._getExistingInsertedCountAsync(partitionDay)
            : 0;
        let skippedCount = 0;
        let lastId = lastMongoId;
        let lastRecordedCheckpoint = lastRecorded || '';

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

                    const tailDoc = batch[batch.length - 1];
                    lastId = tailDoc._id.toString();
                    lastRecordedCheckpoint = toIsoString(tailDoc.recorded);

                    // Checkpoint after each batch
                    await this.stateManager.updateCheckpointAsync({
                        partitionDay,
                        lastMongoId: lastId,
                        lastRecorded: lastRecordedCheckpoint,
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
                const tailDoc = batch[batch.length - 1];
                lastId = tailDoc._id.toString();
                lastRecordedCheckpoint = toIsoString(tailDoc.recorded);
            }

            // Mark completed
            await this.stateManager.markCompletedAsync({
                partitionDay,
                insertedCount,
                sourceCount,
                lastMongoId: lastId,
                lastRecorded: lastRecordedCheckpoint
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
