const { assertTypeEquals } = require('../../utils/assertType');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');

/**
 * Builds the backfill INSERT...SELECT query for one or more partitions.
 * Uses an IN clause so multiple months can be processed in a single server-side pass.
 * @param {number[]} partitions - Array of YYYYMM partition keys
 * @returns {string}
 */
function buildBackfillQuery(partitions) {
    const partitionList = partitions.join(', ');
    return `
INSERT INTO fhir.AUDIT_ACCESS_AGG
SELECT
    entity_ref,
    agent_requestor_who,
    splitByChar('/', entity_ref)[1] AS entity_resource_type,
    toStartOfMonth(recorded) AS recorded_month,
    countState() AS access_count,
    maxState(recorded) AS last_accessed,
    groupUniqArrayState(
        arrayJoin(
            if(
                empty(purpose_of_event),
                ['http://terminology.hl7.org/CodeSystem/v3-ActReason|PATRQT'],
                arrayMap(t -> concat(t.1, '|', t.2), purpose_of_event)
            )
        )
    ) AS purpose_of_events
FROM fhir.AuditEvent_4_0_0
ARRAY JOIN entity_what AS entity_ref
WHERE agent_requestor_who != ''
  AND toYYYYMM(recorded) IN (${partitionList})
GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month
`;
}

/**
 * Converts YYYY-MM to ClickHouse partition key (YYYYMM integer).
 * @param {string} month
 * @returns {number}
 */
function monthToPartition(month) {
    return parseInt(month.replace('-', ''), 10);
}

/**
 * Format elapsed time as HH:MM:SS
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Discovers which monthly partitions exist in the AuditEvent source table.
 * @param {ClickHouseClientManager} clickHouseClientManager
 * @returns {Promise<number[]>} Sorted array of YYYYMM partition keys
 */
async function discoverPartitionsAsync(clickHouseClientManager) {
    const rows = await clickHouseClientManager.queryAsync({
        query: `
            SELECT DISTINCT partition
            FROM system.parts
            WHERE database = 'fhir'
              AND table = 'AuditEvent_4_0_0'
              AND active = 1
            ORDER BY partition
        `
    });
    return rows.map((r) => parseInt(r.partition, 10));
}

/**
 * @classdesc Backfills the AUDIT_ACCESS_AGG table from existing AuditEvent_4_0_0 data.
 * Materialized Views only capture new inserts — this runner replays the MV logic
 * on historical data. Processes data in monthly partitions to avoid loading the
 * entire dataset into memory at once.
 *
 * Idempotent: AggregatingMergeTree correctly merges duplicate partial aggregate
 * states on background compaction.
 */
class BackfillAuditAccessMVRunner extends BaseScriptRunner {
    /**
     * @param {{
     *   adminLogger: import('../adminLogger').AdminLogger,
     *   mongoDatabaseManager: import('../../utils/mongoDatabaseManager').MongoDatabaseManager,
     *   clickHouseClientManager: ClickHouseClientManager | null,
     *   batchSize?: number,
     *   startMonth?: string|null,
     *   endMonth?: string|null,
     *   dryRun?: boolean
     * }} params
     */
    constructor({ adminLogger, mongoDatabaseManager, clickHouseClientManager, batchSize = 1, startMonth = null, endMonth = null, dryRun = false }) {
        super({ adminLogger, mongoDatabaseManager });

        if (clickHouseClientManager) {
            assertTypeEquals(clickHouseClientManager, ClickHouseClientManager);
        }

        this.clickHouseClientManager = clickHouseClientManager;
        this.batchSize = batchSize;
        this.startMonth = startMonth;
        this.endMonth = endMonth;
        this.dryRun = Boolean(dryRun);
    }

    async processAsync() {
        const PREFIX = 'BackfillAuditAccessMVRunner';

        if (!this.clickHouseClientManager) {
            logError(`${PREFIX}: ClickHouseClientManager unavailable. Set ENABLE_CLICKHOUSE=1.`);
            throw new Error('ClickHouseClientManager unavailable');
        }

        const abortFlag = { aborted: false };
        const onSignal = (signal) => {
            if (abortFlag.aborted) return;
            abortFlag.aborted = true;
            logWarn(`${PREFIX}: received signal; finishing in-flight partition then exiting`, { signal });
        };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);

        const startTime = Date.now();
        let processedPartitions = 0;

        try {
            await this.init();

            logInfo(`${PREFIX}: starting`, {
                batchSize: this.batchSize,
                startMonth: this.startMonth || '(earliest)',
                endMonth: this.endMonth || '(latest)',
                dryRun: this.dryRun
            });

            logInfo(`${PREFIX}: connecting to ClickHouse`);
            await this.clickHouseClientManager.getClientAsync();
            logInfo(`${PREFIX}: connected to ClickHouse`);

            let partitions = await discoverPartitionsAsync(this.clickHouseClientManager);
            logInfo(`${PREFIX}: discovered partitions`, { count: partitions.length, partitions });

            if (partitions.length === 0) {
                logInfo(`${PREFIX}: no partitions found in AuditEvent_4_0_0; nothing to backfill`);
                return 0;
            }

            if (this.startMonth) {
                const startPartition = monthToPartition(this.startMonth);
                partitions = partitions.filter((p) => p >= startPartition);
            }
            if (this.endMonth) {
                const endPartition = monthToPartition(this.endMonth);
                partitions = partitions.filter((p) => p <= endPartition);
            }

            if (partitions.length === 0) {
                logInfo(`${PREFIX}: no partitions match the specified range`);
                return 0;
            }

            logInfo(`${PREFIX}: partitions to process`, { count: partitions.length, range: `${partitions[0]} - ${partitions[partitions.length - 1]}` });

            const totalBatches = Math.ceil(partitions.length / this.batchSize);

            for (let i = 0; i < partitions.length; i += this.batchSize) {
                if (abortFlag.aborted) break;

                const batch = partitions.slice(i, i + this.batchSize);
                const batchNo = Math.floor(i / this.batchSize) + 1;
                const batchStart = Date.now();
                const query = buildBackfillQuery(batch);

                if (this.dryRun) {
                    logInfo(`${PREFIX}: [DRY RUN] would process batch`, { batchNo, partitions: batch, query: query.trim() });
                    processedPartitions += batch.length;
                    continue;
                }

                logInfo(`${PREFIX}: processing batch`, {
                    batchNo,
                    totalBatches,
                    partitions: batch,
                    progress: `${batchNo}/${totalBatches}`
                });

                await this.clickHouseClientManager.queryAsync({ query });

                processedPartitions += batch.length;
                logInfo(`${PREFIX}: batch complete`, {
                    batchNo,
                    partitions: batch,
                    progress: `${batchNo}/${totalBatches}`,
                    batchElapsed: formatElapsed(Date.now() - batchStart),
                    totalElapsed: formatElapsed(Date.now() - startTime)
                });
            }

            logInfo(`${PREFIX}: done`, {
                processedPartitions,
                totalPartitions: partitions.length,
                elapsed: formatElapsed(Date.now() - startTime),
                aborted: abortFlag.aborted
            });

            return abortFlag.aborted ? 1 : 0;
        } catch (error) {
            logError(`${PREFIX}: failed`, {
                error: error.message,
                stack: error.stack,
                processedPartitions,
                elapsed: formatElapsed(Date.now() - startTime)
            });
            throw error;
        } finally {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
        }
    }
}

module.exports = {
    BackfillAuditAccessMVRunner,
    buildBackfillQuery,
    monthToPartition,
    formatElapsed,
    discoverPartitionsAsync
};
