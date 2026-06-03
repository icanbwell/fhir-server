const { TABLES, QUERY_FORMAT } = require('../../constants/clickHouseConstants');
const { RethrownError } = require('../../utils/rethrownError');
const { logWarn } = require('../../operations/common/logging');

/**
 * Repository for AuditEvent ClickHouse data access.
 *
 * Encapsulates insert logic with retry for the AuditEvent_4_0_0 table.
 * ClickHouse is the source of truth for AuditEvent — writes must succeed.
 */
class AuditEventClickHouseRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {number} [params.maxRetries=3] - Maximum number of retry attempts
     * @param {number} [params.initialRetryDelayMs=2000] - Initial delay before first retry in ms
     */
    constructor({ clickHouseClientManager, maxRetries = 3, initialRetryDelayMs = 2000 }) {
        this.clickHouseClientManager = clickHouseClientManager;
        this.maxRetries = maxRetries;
        this.initialRetryDelayMs = initialRetryDelayMs;
    }

    /**
     * Inserts a batch of pre-transformed AuditEvent rows into ClickHouse.
     * Retries up to 3 times with exponential backoff (2s → 4s → 8s) on failure.
     *
     * @param {Object[]} rows - Transformed rows matching the AuditEvent_4_0_0 schema
     * @returns {Promise<void>}
     * @throws {RethrownError} After retries exhausted
     */
    async insertBatchAsync(rows) {
        if (!rows || rows.length === 0) {
            return;
        }

        const insertParams = {
            table: TABLES.AUDIT_EVENT,
            values: rows,
            format: QUERY_FORMAT.JSON_EACH_ROW,
            clickhouse_settings: {
                async_insert: 1,
                wait_for_async_insert: 1
            }
        };

        let delay = this.initialRetryDelayMs;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    logWarn('ClickHouse AuditEvent insert failed, retrying', {
                        attempt,
                        maxRetries: this.maxRetries,
                        batchSize: rows.length,
                        delay
                    });
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    delay *= 2;
                }
                await this.clickHouseClientManager.insertAsync(insertParams);
                return;
            } catch (error) {
                if (attempt === this.maxRetries) {
                    throw new RethrownError({
                        message: `ClickHouse AuditEvent insert failed after ${this.maxRetries} retries (batch size ${rows.length})`,
                        error,
                        args: { batchSize: rows.length }
                    });
                }
            }
        }
    }
}

module.exports = { AuditEventClickHouseRepository };
