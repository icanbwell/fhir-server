/**
 * Processes a single hourly partition: reads AuditEvent docs from Atlas Data Federation,
 * transforms them, and inserts into ClickHouse in batches.
 *
 * Retry semantics: partitions are atomic at the hour grain. If the state row
 * already has inserted_count > 0, the worker skips the hour with a warning to
 * avoid duplicates. To rewrite such an hour, operators must either clear
 * ClickHouse via --delete-partitions/--delete-month and re-run plain migrate,
 * or use --reset-state (accepting that duplicates are possible if CH rows
 * still exist).
 *
 * Partition keys are 'YYYY-MM-DDTHH' in UTC.
 */

const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { hourKeyToDate } = require('./migrationStateManager');
const { logInfo, logWarn } = require('../../operations/common/logging');

class PartitionWorker {
    /**
     * @param {Object} params
     * @param {import('mongodb').Db} params.sourceDb - Atlas Data Federation database
     * @param {string} params.collectionName - Source collection name
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./migrationStateManager').MigrationStateManager} params.stateManager
     * @param {number} params.batchSize
     * @param {boolean} [params.deleteSource] - When true, after each successful
     *   ClickHouse batch insert the worker deletes the batch's source docs from
     *   the Mongo source by _id. Requires sourceDb to be the live/primary cluster
     *   (Online Archive federation does not support deletes).
     */
    constructor({
        sourceDb,
        collectionName,
        clickHouseClientManager,
        stateManager,
        batchSize,
        deleteSource = false
    }) {
        this.sourceDb = sourceDb;
        this.collectionName = collectionName;
        this.clickHouseClientManager = clickHouseClientManager;
        this.stateManager = stateManager;
        this.batchSize = batchSize;
        this.deleteSource = deleteSource;
        this.transformer = new AuditEventTransformer();
    }

    /**
     * Process a single hour partition.
     *
     * @param {Object} params
     * @param {string} params.partitionHour - 'YYYY-MM-DDTHH'
     * @param {number} [params.priorInsertedCount] - inserted_count from the state row.
     *   A prior insert (>0) causes the hour to be skipped with a warning so
     *   existing data isn't touched. To rewrite, clear CH first via
     *   --delete-partitions / --delete-month or --reset-state.
     * @param {number} [params.priorSourceCount] - source_count from the state row.
     *   Populated by --init; the worker trusts this value instead of re-querying
     *   Mongo. If 0, the hour is treated as empty and marked completed without
     *   scanning Mongo.
     * @returns {Promise<{insertedCount: number, sourceCount: number, skippedCount: number, skippedReason?: string}>}
     */
    async processAsync({ partitionHour, priorInsertedCount = 0, priorSourceCount = 0 }) {
        const hourStart = hourKeyToDate(partitionHour);
        const hourEnd = new Date(hourStart);
        hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);

        const collection = this.sourceDb.collection(this.collectionName);

        if (priorInsertedCount > 0) {
            logWarn(
                'Skipping partition with prior inserted rows ' +
                '(clear CH via --delete-partitions or --reset-state to rewrite)',
                { partitionHour, priorInsertedCount }
            );
            return {
                insertedCount: 0,
                sourceCount: priorSourceCount,
                skippedCount: 0,
                skippedReason: 'priorInsertedCount>0'
            };
        }

        const sourceCount = priorSourceCount;
        const query = { recorded: { $gte: hourStart, $lt: hourEnd } };

        if (sourceCount === 0) {
            await this.stateManager.markCompletedAsync({
                partitionHour,
                insertedCount: 0,
                sourceCount: 0
            });
            return { insertedCount: 0, sourceCount: 0, skippedCount: 0 };
        }

        await this.stateManager.markInProgressAsync(partitionHour);

        logInfo('MongoDB query', {
            operation: 'find',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionHour,
            query,
            batchSize: this.batchSize
        });
        // No server-side sort: let the federation engine stream S3 objects in
        // whatever order is fastest. Hour atomicity on retry means ordering
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
                    const result = await this._processBatchAsync(batch);
                    insertedCount += result.inserted;
                    skippedCount += result.skipped;

                    await this.stateManager.updateProgressAsync({
                        partitionHour,
                        insertedCount
                    });
                    if (this.deleteSource) {
                        await this._deleteSourceBatchAsync({ collection, batch, partitionHour });
                    }
                    logInfo('Batch inserted', {
                        partitionHour,
                        progress: `${insertedCount}/${sourceCount}`,
                        batchInserted: result.inserted,
                        batchSkipped: result.skipped,
                        sourceDeleted: this.deleteSource ? batch.length : undefined
                    });
                    batch = [];
                }
            }

            if (batch.length > 0) {
                const result = await this._processBatchAsync(batch);
                insertedCount += result.inserted;
                skippedCount += result.skipped;

                if (this.deleteSource) {
                    await this._deleteSourceBatchAsync({ collection, batch, partitionHour });
                }
                logInfo('Batch inserted', {
                    partitionHour,
                    progress: `${insertedCount}/${sourceCount}`,
                    batchInserted: result.inserted,
                    batchSkipped: result.skipped,
                    sourceDeleted: this.deleteSource ? batch.length : undefined
                });
            }

            await this.stateManager.markCompletedAsync({
                partitionHour,
                insertedCount,
                sourceCount
            });

            return { insertedCount, sourceCount, skippedCount };
        } catch (error) {
            await this.stateManager.markFailedAsync({
                partitionHour,
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
     * Delete the batch's docs from the source Mongo collection by _id. Called
     * only when --delete-source is set AND the live/primary cluster is the
     * source (Online Archive federation does not support deletes).
     *
     * Runs AFTER a successful ClickHouse insert for the same batch, so a crash
     * between the insert and the delete leaves those docs in Mongo for a later
     * --resume to pick up again (which would re-DELETE them from ClickHouse
     * and re-migrate them, including re-delete from Mongo).
     *
     * @private
     * @param {Object} params
     * @param {import('mongodb').Collection} params.collection
     * @param {Object[]} params.batch - raw source docs (with _id)
     * @param {string} params.partitionHour
     */
    async _deleteSourceBatchAsync({ collection, batch, partitionHour }) {
        if (batch.length === 0) return;
        const ids = batch.map((doc) => doc._id);
        const result = await collection.deleteMany({ _id: { $in: ids } });
        if (result.deletedCount !== ids.length) {
            logWarn('Source deleteMany returned fewer deletions than requested', {
                partitionHour,
                requested: ids.length,
                deleted: result.deletedCount
            });
        }
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
