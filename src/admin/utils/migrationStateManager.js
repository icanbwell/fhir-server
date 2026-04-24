/**
 * Manages migration state in ClickHouse table fhir.audit_event_migration_state.
 * Tracks per-hour partition progress for resume-safe bulk migration.
 *
 * Table uses ReplacingMergeTree(updated_at) — all state updates are INSERTs
 * (not ALTER TABLE UPDATE mutations). Query with FINAL to get latest state.
 * DDL: clickhouse-init/03-audit-event-migration-state.sql
 *
 * State grain is per-hour (pending | in_progress | completed | failed). There are
 * no mid-hour checkpoints: on retry, PartitionWorker DELETEs any rows written by
 * a prior attempt and re-migrates the whole hour.
 *
 * Partition keys are 'YYYY-MM-DDTHH' (UTC), e.g. '2024-05-10T15'.
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
     * Seeds all partition hours as 'pending', skipping any that already exist.
     * Each row is written with its source_count populated — callers pass the
     * count they obtained from the source collection so the state table is
     * verifiable from the start.
     *
     * @param {Array<{hour: string, sourceCount: number}>} entries
     * @returns {Promise<number>} Number of new partitions seeded
     */
    async seedPartitionsAsync(entries) {
        const existing = await this.getAllStatesAsync();
        const existingHours = new Set(existing.map((s) => s.partition_hour));

        const newEntries = entries.filter((e) => !existingHours.has(e.hour));
        if (newEntries.length === 0) {
            return 0;
        }

        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const rows = newEntries.map(({ hour, sourceCount }) => ({
            partition_hour: hour,
            status: 'pending',
            source_count: Number(sourceCount) || 0,
            inserted_count: 0,
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

        return newEntries.length;
    }

    /**
     * Gets all partition states
     * @returns {Promise<Array>}
     */
    async getAllStatesAsync() {
        return this.clickHouseClientManager.queryAsync({
            query: `SELECT * FROM ${this.table} FINAL ORDER BY partition_hour`
        });
    }

    /**
     * Gets state for a single partition hour
     * @param {string} partitionHour - 'YYYY-MM-DDTHH'
     * @returns {Promise<Object|undefined>}
     */
    async getStateForHourAsync(partitionHour) {
        const results = await this.clickHouseClientManager.queryAsync({
            query: `SELECT * FROM ${this.table} FINAL
                    WHERE partition_hour = {hour:String}`,
            query_params: { hour: partitionHour }
        });
        return results[0];
    }

    /**
     * Gets partitions that need processing (pending, in_progress, or failed).
     * Returns `inserted_count` so the worker can detect a prior partial write
     * and DELETE it before retrying.
     *
     * @param {Object} [options]
     * @param {string} [options.startHour] - Inclusive start 'YYYY-MM-DDTHH'
     * @param {string} [options.endHour] - Exclusive end 'YYYY-MM-DDTHH'
     * @returns {Promise<Array<{partition_hour: string, status: string, inserted_count: number}>>}
     */
    async getPendingPartitionsAsync({ startHour, endHour } = {}) {
        let query = `SELECT partition_hour, status, inserted_count
                    FROM ${this.table} FINAL
                    WHERE status IN ('pending', 'in_progress', 'failed')`;
        const query_params = {};

        if (startHour) {
            query += ` AND partition_hour >= {startHour:String}`;
            query_params.startHour = startHour;
        }
        if (endHour) {
            query += ` AND partition_hour < {endHour:String}`;
            query_params.endHour = endHour;
        }

        query += ` ORDER BY partition_hour`;

        return this.clickHouseClientManager.queryAsync({ query, query_params });
    }

    /**
     * Resets counts and clears error on a partition before a retry attempt.
     * Called by PartitionWorker after it has DELETEd the hour's prior rows from
     * fhir.AuditEvent_4_0_0 — this brings the state row back to a clean slate
     * so downstream `markInProgressAsync` / `markCompletedAsync` start from zero.
     *
     * Leaves `status` alone; the caller's subsequent `markInProgressAsync` is
     * what flips it to 'in_progress'.
     *
     * @param {string} partitionHour
     * @returns {Promise<void>}
     */
    async clearInsertedCountAsync(partitionHour) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForHourAsync(partitionHour);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: current?.status || 'pending',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: 0,
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
     * Updates in-flight progress for a partition: bumps inserted_count and
     * updated_at while keeping status='in_progress'. Called between batches
     * so operators can watch progress via --show-state without waiting for
     * the whole hour to complete.
     *
     * @param {Object} params
     * @param {string} params.partitionHour
     * @param {number} params.insertedCount - cumulative for this hour so far
     * @returns {Promise<void>}
     */
    async updateProgressAsync({ partitionHour, insertedCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForHourAsync(partitionHour);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: 'in_progress',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: insertedCount,
                    started_at: current?.started_at || now,
                    completed_at: null,
                    error_message: '',
                    updated_at: now
                }
            ],
            format: 'JSONEachRow'
        });
    }

    /**
     * Marks a partition as in_progress
     * @param {string} partitionHour
     * @returns {Promise<void>}
     */
    async markInProgressAsync(partitionHour) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForHourAsync(partitionHour);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: 'in_progress',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: Number(current?.inserted_count) || 0,
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
     * Marks a partition as completed
     * @param {Object} params
     * @param {string} params.partitionHour
     * @param {number} params.insertedCount
     * @param {number} params.sourceCount
     * @returns {Promise<void>}
     */
    async markCompletedAsync({ partitionHour, insertedCount, sourceCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForHourAsync(partitionHour);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: 'completed',
                    source_count: sourceCount,
                    inserted_count: insertedCount,
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
     * @param {string} params.partitionHour
     * @param {string} params.errorMessage
     * @param {number} params.insertedCount
     * @returns {Promise<void>}
     */
    async markFailedAsync({ partitionHour, errorMessage, insertedCount }) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForHourAsync(partitionHour);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: 'failed',
                    source_count: Number(current?.source_count) || 0,
                    inserted_count: insertedCount,
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
     * @param {string} partitionHour
     * @param {number} sourceCount
     * @returns {Promise<void>}
     */
    async updateSourceCountAsync(partitionHour, sourceCount) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const current = await this.getStateForHourAsync(partitionHour);
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: current?.status || 'completed',
                    source_count: sourceCount,
                    inserted_count: Number(current?.inserted_count) || 0,
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
     * Resets a partition back to 'pending'. Used by the --delete-partitions flow
     * after the AuditEvent rows for this hour are deleted.
     *
     * We write a fresh row rather than DELETE-ing the existing one: the state table is
     * ReplacingMergeTree(updated_at) ORDER BY (partition_hour), so a later-updated_at
     * row naturally supersedes earlier ones on merge, and --resume picks up 'pending'
     * partitions via getPendingPartitionsAsync.
     *
     * @param {string} partitionHour
     * @returns {Promise<void>}
     */
    async resetPartitionAsync(partitionHour) {
        const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
        await this.clickHouseClientManager.insertAsync({
            table: this.table,
            values: [
                {
                    partition_hour: partitionHour,
                    status: 'pending',
                    source_count: 0,
                    inserted_count: 0,
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
 * Generates array of 'YYYY-MM-DDTHH' strings between start and end
 * (inclusive of start, exclusive of end). Both endpoints must be UTC
 * 'YYYY-MM-DDTHH' keys — callers normalize bare dates to the full-day range
 * via `hourBoundsFromCli` in the orchestrator.
 *
 * @param {string} startHour - 'YYYY-MM-DDTHH'
 * @param {string} endHour - 'YYYY-MM-DDTHH'
 * @returns {string[]}
 */
function generateHourlyPartitions(startHour, endHour) {
    const hours = [];
    const current = new Date(startHour + ':00:00.000Z');
    const end = new Date(endHour + ':00:00.000Z');

    while (current < end) {
        hours.push(hourKeyFromDate(current));
        current.setUTCHours(current.getUTCHours() + 1);
    }

    return hours;
}

/**
 * Format a Date (UTC) as a partition-hour key 'YYYY-MM-DDTHH'.
 * @param {Date} d
 * @returns {string}
 */
function hourKeyFromDate(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}`;
}

/**
 * Convert a partition-hour key 'YYYY-MM-DDTHH' to its UTC Date.
 * @param {string} hourKey
 * @returns {Date}
 */
function hourKeyToDate(hourKey) {
    return new Date(hourKey + ':00:00.000Z');
}

module.exports = {
    MigrationStateManager,
    generateHourlyPartitions,
    hourKeyFromDate,
    hourKeyToDate
};
