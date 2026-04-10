/**
 * Manages migration state in ClickHouse table fhir.audit_event_migration_state.
 * Tracks per-day partition progress for resume-safe bulk migration.
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
     * Ensures the state table exists
     * @returns {Promise<void>}
     */
    async initAsync() {
        await this.clickHouseClientManager.queryAsync({
            query: `CREATE TABLE IF NOT EXISTS ${this.table} (
                partition_day     String,
                status            LowCardinality(String),
                source_count      UInt64 DEFAULT 0,
                inserted_count    UInt64 DEFAULT 0,
                last_mongo_id     String DEFAULT '',
                started_at        Nullable(DateTime64(3, 'UTC')),
                completed_at      Nullable(DateTime64(3, 'UTC')),
                error_message     String DEFAULT '',
                updated_at        DateTime64(3, 'UTC')
            ) ENGINE = MergeTree()
            ORDER BY (partition_day)`
        });
    }

    /**
     * Seeds all partition days as 'pending', skipping any that already exist
     * @param {string[]} days - Array of 'YYYY-MM-DD' strings
     * @returns {Promise<number>} Number of new partitions seeded
     */
    async seedPartitionsAsync(days) {
        const existing = await this.getAllStatesAsync();
        const existingDays = new Set(existing.map(s => s.partition_day));

        const newDays = days.filter(d => !existingDays.has(d));
        if (newDays.length === 0) {
            return 0;
        }

        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const rows = newDays.map(day => ({
            partition_day: day,
            status: 'pending',
            source_count: 0,
            inserted_count: 0,
            last_mongo_id: '',
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
     * @returns {Promise<Array<{partition_day: string, status: string, source_count: number, inserted_count: number, last_mongo_id: string, error_message: string}>>}
     */
    async getAllStatesAsync() {
        return this.clickHouseClientManager.queryAsync({
            query: `SELECT * FROM ${this.table} FINAL ORDER BY partition_day`
        });
    }

    /**
     * Gets partitions that need processing (pending or in_progress for resume)
     * @returns {Promise<Array<{partition_day: string, status: string, last_mongo_id: string}>>}
     */
    async getPendingPartitionsAsync() {
        return this.clickHouseClientManager.queryAsync({
            query: `SELECT partition_day, status, last_mongo_id
                    FROM ${this.table} FINAL
                    WHERE status IN ('pending', 'in_progress', 'failed')
                    ORDER BY partition_day`
        });
    }

    /**
     * Marks a partition as in_progress
     * @param {string} partitionDay
     * @returns {Promise<void>}
     */
    async markInProgressAsync(partitionDay) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        await this.clickHouseClientManager.queryAsync({
            query: `ALTER TABLE ${this.table}
                    UPDATE status = 'in_progress',
                           started_at = {now:DateTime64(3, 'UTC')},
                           error_message = '',
                           updated_at = {now2:DateTime64(3, 'UTC')}
                    WHERE partition_day = {day:String}`,
            query_params: { day: partitionDay, now: now, now2: now }
        });
    }

    /**
     * Updates checkpoint within an in_progress partition
     * @param {Object} params
     * @param {string} params.partitionDay
     * @param {string} params.lastMongoId
     * @param {number} params.insertedCount
     * @returns {Promise<void>}
     */
    async updateCheckpointAsync({ partitionDay, lastMongoId, insertedCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        await this.clickHouseClientManager.queryAsync({
            query: `ALTER TABLE ${this.table}
                    UPDATE last_mongo_id = {lastId:String},
                           inserted_count = {count:UInt64},
                           updated_at = {now:DateTime64(3, 'UTC')}
                    WHERE partition_day = {day:String}`,
            query_params: {
                day: partitionDay,
                lastId: lastMongoId,
                count: insertedCount,
                now: now
            }
        });
    }

    /**
     * Marks a partition as completed
     * @param {Object} params
     * @param {string} params.partitionDay
     * @param {number} params.insertedCount
     * @param {number} params.sourceCount
     * @returns {Promise<void>}
     */
    async markCompletedAsync({ partitionDay, insertedCount, sourceCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        await this.clickHouseClientManager.queryAsync({
            query: `ALTER TABLE ${this.table}
                    UPDATE status = 'completed',
                           inserted_count = {count:UInt64},
                           source_count = {srcCount:UInt64},
                           completed_at = {now:DateTime64(3, 'UTC')},
                           updated_at = {now2:DateTime64(3, 'UTC')}
                    WHERE partition_day = {day:String}`,
            query_params: {
                day: partitionDay,
                count: insertedCount,
                srcCount: sourceCount,
                now: now,
                now2: now
            }
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
        await this.clickHouseClientManager.queryAsync({
            query: `ALTER TABLE ${this.table}
                    UPDATE status = 'failed',
                           error_message = {err:String},
                           inserted_count = {count:UInt64},
                           updated_at = {now:DateTime64(3, 'UTC')}
                    WHERE partition_day = {day:String}`,
            query_params: {
                day: partitionDay,
                err: errorMessage.substring(0, 1000),
                count: insertedCount,
                now: now
            }
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
        await this.clickHouseClientManager.queryAsync({
            query: `ALTER TABLE ${this.table}
                    UPDATE source_count = {srcCount:UInt64},
                           updated_at = {now:DateTime64(3, 'UTC')}
                    WHERE partition_day = {day:String}`,
            query_params: { day: partitionDay, srcCount: sourceCount, now: now }
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
