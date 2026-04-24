/**
 * Per-hour count verification between Atlas Data Federation and ClickHouse.
 * Compares source document counts with ClickHouse row counts per partition hour.
 */

const { hourKeyToDate, toClickHouseDateTime64 } = require('./migrationStateManager');
const { logInfo } = require('../../operations/common/logging');

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
     * @param {number} [options.concurrency] - How many hours to verify in parallel
     * @param {string} [options.startHour] - Inclusive start 'YYYY-MM-DDTHH'
     * @param {string} [options.endHour] - Exclusive end 'YYYY-MM-DDTHH'
     * @returns {Promise<{matched: number, mismatched: number, mismatches: Array<{hour: string, sourceCount: number, chCount: number}>}>}
     */
    async verifyAllAsync({ concurrency = 10, startHour, endHour } = {}) {
        const states = await this.stateManager.getAllStatesAsync();
        let completedStates = states.filter((s) => s.status === 'completed');

        if (startHour) {
            completedStates = completedStates.filter((s) => s.partition_hour >= startHour);
        }
        if (endHour) {
            completedStates = completedStates.filter((s) => s.partition_hour < endHour);
        }

        logInfo('Starting verification', { partitions: completedStates.length });

        let matched = 0;
        let mismatched = 0;
        const mismatches = [];

        for (let i = 0; i < completedStates.length; i += concurrency) {
            const batch = completedStates.slice(i, i + concurrency);
            const results = await Promise.all(
                batch.map((state) => this._verifyHourAsync(state.partition_hour))
            );

            for (const result of results) {
                logInfo('Partition verified', {
                    partitionHour: result.hour,
                    sourceCount: result.sourceCount,
                    clickHouseCount: result.chCount,
                    match: result.match
                });

                if (result.match) {
                    matched++;
                } else {
                    mismatched++;
                    mismatches.push({
                        hour: result.hour,
                        sourceCount: result.sourceCount,
                        chCount: result.chCount
                    });
                }
            }

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
     * Verify a single hour
     * @param {string} partitionHour - 'YYYY-MM-DDTHH'
     * @returns {Promise<{hour: string, sourceCount: number, chCount: number, match: boolean}>}
     */
    async _verifyHourAsync(partitionHour) {
        const [sourceCount, chCount] = await Promise.all([
            this._getSourceCountAsync(partitionHour),
            this._getClickHouseCountAsync(partitionHour)
        ]);

        await this.stateManager.updateSourceCountAsync(partitionHour, sourceCount);

        return {
            hour: partitionHour,
            sourceCount,
            chCount,
            match: sourceCount === chCount
        };
    }

    /**
     * Count documents in Atlas Data Federation for a given hour
     * @private
     * @param {string} partitionHour
     * @returns {Promise<number>}
     */
    async _getSourceCountAsync(partitionHour) {
        const hourStart = hourKeyToDate(partitionHour);
        const hourEnd = new Date(hourStart);
        hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);

        const collection = this.sourceDb.collection(this.collectionName);
        const query = {
            recorded: { $gte: hourStart, $lt: hourEnd }
        };
        logInfo('MongoDB query', {
            operation: 'countDocuments',
            db: this.sourceDb.databaseName,
            collection: this.collectionName,
            partitionHour,
            query,
            context: 'verifier.getSourceCount'
        });
        return collection.countDocuments(query);
    }

    /**
     * Count rows in ClickHouse for a given hour
     * @private
     * @param {string} partitionHour
     * @returns {Promise<number>}
     */
    async _getClickHouseCountAsync(partitionHour) {
        const hourStart = hourKeyToDate(partitionHour);
        const hourEnd = new Date(hourStart);
        hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);

        const result = await this.clickHouseClientManager.queryAsync({
            query: `SELECT count() as count
                    FROM fhir.AuditEvent_4_0_0
                    WHERE recorded >= {hourStart:DateTime64(3, 'UTC')}
                      AND recorded < {hourEnd:DateTime64(3, 'UTC')}`,
            query_params: {
                hourStart: toClickHouseDateTime64(hourStart),
                hourEnd: toClickHouseDateTime64(hourEnd)
            }
        });

        return Number(result[0]?.count || 0);
    }
}

module.exports = { MigrationVerifier };
