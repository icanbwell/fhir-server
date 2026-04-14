/**
 * Per-day count verification between Atlas Data Federation and ClickHouse.
 * Compares source document counts with ClickHouse row counts per partition day.
 */

const { logInfo, logWarn } = require('../../operations/common/logging');

class MigrationVerifier {
    /**
     * @param {Object} params
     * @param {import('mongodb').Db} params.sourceDb - Atlas Data Federation database
     * @param {string} params.collectionName
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./migrationStateManager').MigrationStateManager} params.stateManager
     */
    constructor({ sourceDb, collectionName, clickHouseClientManager, stateManager }) {
        this.sourceDb = sourceDb;
        this.collectionName = collectionName;
        this.clickHouseClientManager = clickHouseClientManager;
        this.stateManager = stateManager;
    }

    /**
     * Verify counts for all completed partitions
     * @param {Object} [options]
     * @param {number} [options.concurrency] - How many days to verify in parallel
     * @param {string} [options.startDate] - Inclusive start date 'YYYY-MM-DD'
     * @param {string} [options.endDate] - Exclusive end date 'YYYY-MM-DD'
     * @returns {Promise<{matched: number, mismatched: number, mismatches: Array<{day: string, sourceCount: number, chCount: number}>}>}
     */
    async verifyAllAsync({ concurrency = 10, startDate, endDate } = {}) {
        const states = await this.stateManager.getAllStatesAsync();
        let completedStates = states.filter((s) => s.status === 'completed');

        if (startDate) {
            completedStates = completedStates.filter((s) => s.partition_day >= startDate);
        }
        if (endDate) {
            completedStates = completedStates.filter((s) => s.partition_day < endDate);
        }

        logInfo('Starting verification', { partitions: completedStates.length });

        let matched = 0;
        let mismatched = 0;
        const mismatches = [];

        // Process in batches for parallel verification
        for (let i = 0; i < completedStates.length; i += concurrency) {
            const batch = completedStates.slice(i, i + concurrency);
            const results = await Promise.all(
                batch.map((state) => this._verifyDayAsync(state.partition_day))
            );

            for (const result of results) {
                logInfo('Partition verified', {
                    day: result.day,
                    sourceCount: result.sourceCount,
                    clickHouseCount: result.chCount,
                    match: result.match
                });

                if (result.match) {
                    matched++;
                } else {
                    mismatched++;
                    mismatches.push({
                        day: result.day,
                        sourceCount: result.sourceCount,
                        chCount: result.chCount
                    });
                }
            }

            // Progress update every batch
            const processed = Math.min(i + concurrency, completedStates.length);
            logInfo('Verification progress', {
                processed,
                total: completedStates.length,
                matched,
                mismatched
            });
        }

        return { matched, mismatched, mismatches };
    }

    /**
     * Verify a single day
     * @param {string} partitionDay - 'YYYY-MM-DD'
     * @returns {Promise<{day: string, sourceCount: number, chCount: number, match: boolean}>}
     */
    async _verifyDayAsync(partitionDay) {
        const [sourceCount, chCount] = await Promise.all([
            this._getSourceCountAsync(partitionDay),
            this._getClickHouseCountAsync(partitionDay)
        ]);

        // Update source_count in state table for the record
        await this.stateManager.updateSourceCountAsync(partitionDay, sourceCount);

        return {
            day: partitionDay,
            sourceCount,
            chCount,
            match: sourceCount === chCount
        };
    }

    /**
     * Count documents in Atlas Data Federation for a given day
     * @private
     * @param {string} partitionDay
     * @returns {Promise<number>}
     */
    async _getSourceCountAsync(partitionDay) {
        const dayStart = new Date(partitionDay + 'T00:00:00.000Z');
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

        const collection = this.sourceDb.collection(this.collectionName);
        return collection.countDocuments({
            recorded: { $gte: dayStart, $lt: dayEnd }
        });
    }

    /**
     * Count rows in ClickHouse for a given day
     * @private
     * @param {string} partitionDay
     * @returns {Promise<number>}
     */
    async _getClickHouseCountAsync(partitionDay) {
        const result = await this.clickHouseClientManager.queryAsync({
            query: `SELECT count() as count
                    FROM fhir.AuditEvent_4_0_0
                    WHERE toDate(recorded) = {day:String}`,
            query_params: { day: partitionDay }
        });

        return Number(result[0]?.count || 0);
    }
}

module.exports = { MigrationVerifier };
