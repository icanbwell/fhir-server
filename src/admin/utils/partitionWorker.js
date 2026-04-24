/**
 * Processes a single daily partition: reads AuditEvent docs from Atlas Data Federation,
 * transforms them, and inserts into ClickHouse in batches.
 *
 * Retry semantics: partitions are atomic at the day grain. If a prior attempt
 * wrote any rows (inserted_count > 0), the worker DELETEs the day from
 * fhir.AuditEvent_4_0_0 and re-migrates from scratch. No mid-day checkpoints.
 */

const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { logInfo, logWarn } = require('../../operations/common/logging');

class PartitionWorker {
    /**
     * @param {Object} params
     * @param {import('mongodb').Db} params.sourceDb - Atlas Data Federation database
     * @param {string} params.collectionName - Source collection name
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./migrationStateManager').MigrationStateManager} params.stateManager
     * @param {number} params.batchSize
     */
    constructor({
        sourceDb,
        collectionName,
        clickHouseClientManager,
        stateManager,
        batchSize
    }) {
        this.sourceDb = sourceDb;
        this.collectionName = collectionName;
        this.clickHouseClientManager = clickHouseClientManager;
        this.stateManager = stateManager;
        this.batchSize = batchSize;
        this.transformer = new AuditEventTransformer();
    }

    /**
     * Process a single day partition.
     *
     * @param {Object} params
     * @param {string} params.partitionDay - 'YYYY-MM-DD'
     * @param {number} [params.priorInsertedCount] - inserted_count from the state row.
     *   When > 0, the day was partially migrated by a prior attempt; the worker
     *   DELETEs those rows before re-migrating.
     * @returns {Promise<{insertedCount: number, sourceCount: number, skippedCount: number}>}
     */
    async processAsync({ partitionDay, priorInsertedCount = 0 }) {
        const dayStart = new Date(partitionDay + 'T00:00:00.000Z');
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

        const collection = this.sourceDb.collection(this.collectionName);

        // If a prior attempt left rows behind, wipe them before re-migrating so
        // we don't duplicate. Skipped on fresh days (priorInsertedCount == 0) so
        // the 1,553-partition baseline pays nothing.
        if (priorInsertedCount > 0) {
            logInfo('Deleting prior partial write before retry', {
                partitionDay,
                priorInsertedCount
            });
            // mutations_sync = 2 blocks until the mutation finishes on all replicas
            // so the subsequent insert can't race with tombstone propagation.
            await this.clickHouseClientManager.queryAsync({
                query: `ALTER TABLE fhir.AuditEvent_4_0_0
                        DELETE WHERE toDate(recorded) = {day:String}
                        SETTINGS mutations_sync = 2`,
                query_params: { day: partitionDay }
            });
            await this.stateManager.clearInsertedCountAsync(partitionDay);
        }

        const query = { recorded: { $gte: dayStart, $lt: dayEnd } };

        logInfo('MongoDB query', {
            operation: 'countDocuments',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionDay,
            query
        });
        const sourceCount = await collection.countDocuments(query);

        if (sourceCount === 0) {
            await this.stateManager.markCompletedAsync({
                partitionDay,
                insertedCount: 0,
                sourceCount: 0
            });
            return { insertedCount: 0, sourceCount: 0, skippedCount: 0 };
        }

        await this.stateManager.markInProgressAsync(partitionDay);

        logInfo('MongoDB query', {
            operation: 'find',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionDay,
            query,
            batchSize: this.batchSize
        });
        // No server-side sort: let the federation engine stream S3 objects in
        // whatever order is fastest. Day atomicity on retry means ordering
        // doesn't matter for correctness.
        const cursor = collection.find(query).batchSize(this.batchSize);

        let batch = [];
        let insertedCount = 0;
        let skippedCount = 0;

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
                    batch = [];
                }
            }

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
            }

            await this.stateManager.markCompletedAsync({
                partitionDay,
                insertedCount,
                sourceCount
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

        if (rows.length > 0) {
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
}

module.exports = { PartitionWorker };
