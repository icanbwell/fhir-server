/**
 * Processes a single hourly partition: reads AuditEvent docs from Atlas Data Federation,
 * transforms them, and inserts into ClickHouse in batches.
 *
 * Retry semantics: partitions are atomic at the hour grain. If a prior attempt
 * wrote any rows (inserted_count > 0) the worker DELETEs that hour from
 * fhir.AuditEvent_4_0_0 and re-migrates from scratch — but only when
 * rewriteExisting=true (orchestrator passes this from --resume). Without
 * --resume the day is skipped with a warning so existing data isn't touched.
 *
 * Partition keys are 'YYYY-MM-DDTHH' in UTC.
 */

const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { hourKeyToDate, toClickHouseDateTime64 } = require('./migrationStateManager');
const { logInfo, logWarn } = require('../../operations/common/logging');

class PartitionWorker {
    /**
     * @param {Object} params
     * @param {import('mongodb').Db} params.sourceDb - Atlas Data Federation database
     * @param {string} params.collectionName - Source collection name
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./migrationStateManager').MigrationStateManager} params.stateManager
     * @param {number} params.batchSize
     * @param {boolean} [params.rewriteExisting] - When true and a partition has a prior
     *   partial write (inserted_count > 0), DELETE those rows before re-migrating.
     *   When false (default), skip the partition with a warning so existing data isn't
     *   touched. Only --resume sets this true.
     */
    constructor({
        sourceDb,
        collectionName,
        clickHouseClientManager,
        stateManager,
        batchSize,
        rewriteExisting = false
    }) {
        this.sourceDb = sourceDb;
        this.collectionName = collectionName;
        this.clickHouseClientManager = clickHouseClientManager;
        this.stateManager = stateManager;
        this.batchSize = batchSize;
        this.rewriteExisting = rewriteExisting;
        this.transformer = new AuditEventTransformer();
    }

    /**
     * Process a single hour partition.
     *
     * @param {Object} params
     * @param {string} params.partitionHour - 'YYYY-MM-DDTHH'
     * @param {number} [params.priorInsertedCount] - inserted_count from the state row.
     *   With rewriteExisting=false (default), a prior insert (>0) causes the hour
     *   to be skipped with a warning so existing data isn't touched.
     *   With rewriteExisting=true (--resume), the worker unconditionally DELETEs
     *   the hour before re-migrating, regardless of priorInsertedCount — the
     *   operator has explicitly opted into the destructive path.
     * @returns {Promise<{insertedCount: number, sourceCount: number, skippedCount: number, skippedReason?: string}>}
     */
    async processAsync({ partitionHour, priorInsertedCount = 0 }) {
        const hourStart = hourKeyToDate(partitionHour);
        const hourEnd = new Date(hourStart);
        hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);

        const collection = this.sourceDb.collection(this.collectionName);

        if (this.rewriteExisting) {
            logInfo('Deleting hour before re-migrating (--resume)', {
                partitionHour,
                priorInsertedCount
            });
            // mutations_sync = 2 blocks until the mutation finishes on all replicas
            // so the subsequent insert can't race with tombstone propagation.
            await this.clickHouseClientManager.queryAsync({
                query: `ALTER TABLE fhir.AuditEvent_4_0_0
                        DELETE WHERE recorded >= {hourStart:DateTime64(3, 'UTC')}
                                 AND recorded < {hourEnd:DateTime64(3, 'UTC')}
                        SETTINGS mutations_sync = 2`,
                query_params: {
                    hourStart: toClickHouseDateTime64(hourStart),
                    hourEnd: toClickHouseDateTime64(hourEnd)
                }
            });
            await this.stateManager.clearInsertedCountAsync(partitionHour);
        } else if (priorInsertedCount > 0) {
            logWarn(
                'Skipping partition with prior inserted rows (use --resume to rewrite)',
                { partitionHour, priorInsertedCount }
            );
            return {
                insertedCount: 0,
                sourceCount: 0,
                skippedCount: 0,
                skippedReason: 'priorInsertedCount>0'
            };
        }

        const query = { recorded: { $gte: hourStart, $lt: hourEnd } };

        logInfo('MongoDB query', {
            operation: 'countDocuments',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionHour,
            query
        });
        const sourceCount = await collection.countDocuments(query);

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
                    batch = [];

                    await this.stateManager.updateProgressAsync({
                        partitionHour,
                        insertedCount
                    });
                    logInfo('Batch inserted', {
                        partitionHour,
                        progress: `${insertedCount}/${sourceCount}`,
                        batchInserted: result.inserted,
                        batchSkipped: result.skipped
                    });
                }
            }

            if (batch.length > 0) {
                const result = await this._processBatchAsync(batch);
                insertedCount += result.inserted;
                skippedCount += result.skipped;

                logInfo('Batch inserted', {
                    partitionHour,
                    progress: `${insertedCount}/${sourceCount}`,
                    batchInserted: result.inserted,
                    batchSkipped: result.skipped
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
