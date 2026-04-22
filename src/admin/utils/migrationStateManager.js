/**
 * Manages migration state in ClickHouse table fhir.audit_event_migration_state.
 * Tracks per-day partition progress for resume-safe bulk migration.
 *
 * Table uses ReplacingMergeTree(updated_at) — all state updates are INSERTs
 * (not ALTER TABLE UPDATE mutations). Query with FINAL to get latest state.
 * DDL: clickhouse-init/03-audit-event-migration-state.sql
 */

class MigrationStateManager {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     */
    constructor({ clickHouseClientManager }) {
        this.clickHouseClientManager = clickHouseClientManager;
        this.table = 'fhir.audit_event_migration_state';
    }

    /**
     * Seeds all partition days as 'pending', skipping any that already exist
     * @param {string[]} days - Array of 'YYYY-MM-DD' strings
     * @returns {Promise<number>} Number of new partitions seeded
     */
    async seedPartitionsAsync(days) {
        const existing = await this.getAllStatesAsync();
        const existingDays = new Set(existing.map((s) => s.partition_day));

        const newDays = days.filter((d) => !existingDays.has(d));
        if (newDays.length === 0) {
            return 0;
        }

        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const rows = newDays.map((day) => ({
            partition_day: day,
            status: 'pending',
            source_count: 0,
            inserted_count: 0,
            last_mongo_id: '',
            last_recorded: '',
            started_at: null,
            completed_at: null,
            error_message: '',
            updated_at: now
        }));

        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: rows,
            format: 'JSONEachRow'
        });

        return newDays.length;
    }

    /**
     * Gets all partition states
     * @returns {Promise<Array>}
     */
    async getAllStatesAsync() {
        return this.clickHouseClientManager.queryAsync({
            query: `SELECT * FROM ${this.table} FINAL ORDER BY partition_day`
        });
    }

    /**
     * Gets state for a single partition day
     * @param {string} partitionDay
     * @returns {Promise<Object|undefined>}
     */
    async getStateForDayAsync(partitionDay) {
        const results = await this.clickHouseClientManager.queryAsync({
            query: `SELECT * FROM ${this.table} FINAL
                    WHERE partition_day = {day:String}`,
            query_params: { day: partitionDay }
        });
        return results[0];
    }

    /**
     * Gets partitions that need processing (pending, in_progress, or failed)
     * @param {Object} [options]
     * @param {string} [options.startDate] - Inclusive start date 'YYYY-MM-DD'
     * @param {string} [options.endDate] - Exclusive end date 'YYYY-MM-DD'
     * @returns {Promise<Array<{partition_day: string, status: string, last_mongo_id: string, last_recorded: string}>>}
     */
    async getPendingPartitionsAsync({ startDate, endDate } = {}) {
        let query = `SELECT partition_day, status, last_mongo_id, last_recorded
                    FROM ${this.table} FINAL
                    WHERE status IN ('pending', 'in_progress', 'failed')`;
        const query_params = {};

        if (startDate) {
            query += ` AND partition_day >= {startDate:String}`;
            query_params.startDate = startDate;
        }
        if (endDate) {
            query += ` AND partition_day < {endDate:String}`;
            query_params.endDate = endDate;
        }

        query += ` ORDER BY partition_day`;

        return this.clickHouseClientManager.queryAsync({ query, query_params });
    }

    /**
     * Marks a partition as in_progress
     * @param {string} partitionDay
     * @returns {Promise<void>}
     */
    async markInProgressAsync(partitionDay) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForDayAsync(partitionDay);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_day: partitionDay,
                    status: 'in_progress',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: Number(current?.inserted_count) || 0,
                    last_mongo_id: current?.last_mongo_id || '',
                    last_recorded: current?.last_recorded || '',
                    started_at: now,
                    completed_at: null,
                    error_message: '',
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Updates checkpoint within an in_progress partition
     * @param {Object} params
     * @param {string} params.partitionDay
     * @param {string} params.lastMongoId
     * @param {string} params.lastRecorded - ISO-8601 string of the last processed doc's `recorded` field
     * @param {number} params.insertedCount
     * @returns {Promise<void>}
     */
    async updateCheckpointAsync({ partitionDay, lastMongoId, lastRecorded, insertedCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForDayAsync(partitionDay);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_day: partitionDay,
                    status: 'in_progress',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: insertedCount,
                    last_mongo_id: lastMongoId,
                    last_recorded: lastRecorded || '',
                    started_at: current?.started_at || null,
                    completed_at: null,
                    error_message: '',
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Marks a partition as completed
     * @param {Object} params
     * @param {string} params.partitionDay
     * @param {number} params.insertedCount
     * @param {number} params.sourceCount
     * @param {string} [params.lastMongoId] - Final mongo _id processed
     * @param {string} [params.lastRecorded] - Final mongo `recorded` ISO-8601 string processed
     * @returns {Promise<void>}
     */
    async markCompletedAsync({
        partitionDay,
        insertedCount,
        sourceCount,
        lastMongoId,
        lastRecorded
    }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForDayAsync(partitionDay);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_day: partitionDay,
                    status: 'completed',
                    source_count: sourceCount,
                    inserted_count: insertedCount,
                    last_mongo_id: lastMongoId || current?.last_mongo_id || '',
                    last_recorded: lastRecorded || current?.last_recorded || '',
                    started_at: current?.started_at || null,
                    completed_at: now,
                    error_message: '',
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Marks a partition as failed
     * @param {Object} params
     * @param {string} params.partitionDay
     * @param {string} params.errorMessage
     * @param {number} params.insertedCount
     * @returns {Promise<void>}
     */
    async markFailedAsync({ partitionDay, errorMessage, insertedCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForDayAsync(partitionDay);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_day: partitionDay,
                    status: 'failed',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: insertedCount,
                    last_mongo_id: current?.last_mongo_id || '',
                    last_recorded: current?.last_recorded || '',
                    started_at: current?.started_at || null,
                    completed_at: null,
                    error_message: errorMessage.substring(0, 1000),
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Updates source_count for verification
     * @param {string} partitionDay
     * @param {number} sourceCount
     * @returns {Promise<void>}
     */
    async updateSourceCountAsync(partitionDay, sourceCount) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForDayAsync(partitionDay);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_day: partitionDay,
                    status: current?.status || 'completed',
                    source_count: sourceCount,
                    inserted_count: Number(current?.inserted_count) || 0,
                    last_mongo_id: current?.last_mongo_id || '',
                    last_recorded: current?.last_recorded || '',
                    started_at: current?.started_at || null,
                    completed_at: current?.completed_at || null,
                    error_message: current?.error_message || '',
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Resets a partition back to 'pending' with cleared checkpoints. Used by the
     * --delete-partitions flow after the AuditEvent rows for this day are deleted.
     *
     * We write a fresh row rather than DELETE-ing the existing one: the state table is
     * ReplacingMergeTree(updated_at) ORDER BY (partition_day), so a later-updated_at
     * row naturally supersedes earlier ones on merge, and --resume picks up 'pending'
     * partitions via getPendingPartitionsAsync.
     *
     * @param {string} partitionDay
     * @returns {Promise<void>}
     */
    async resetPartitionAsync(partitionDay) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_day: partitionDay,
                    status: 'pending',
                    source_count: 0,
                    inserted_count: 0,
                    last_mongo_id: '',
                    last_recorded: '',
                    started_at: null,
                    completed_at: null,
                    error_message: '',
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Gets summary statistics
     * @returns {Promise<{total: number, pending: number, in_progress: number, completed: number, failed: number, totalInserted: number}>}
     */
    async getSummaryAsync() {
        const states = await this.getAllStatesAsync();
        const summary = {
            total: states.length,
            pending: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
            totalInserted: 0
        };

        for (const state of states) {
            summary[state.status] = (summary[state.status] || 0) + 1;
            summary.totalInserted += Number(state.inserted_count) || 0;
        }

        return summary;
    }
}

/**
 * Generates array of 'YYYY-MM-DD' strings between start and end (inclusive of start, exclusive of end)
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 * @returns {string[]}
 */
function generateDailyPartitions(startDate, endDate) {
    const days = [];
    const current = new Date(startDate + 'T00:00:00.000Z');
    const end = new Date(endDate + 'T00:00:00.000Z');

    while (current < end) {
        days.push(current.toISOString().split('T')[0]);
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return days;
}

module.exports = { MigrationStateManager, generateDailyPartitions };
