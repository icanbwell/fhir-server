const { TABLES, QUERY_FORMAT } = require('../../constants/clickHouseConstants');
const { RethrownError } = require('../../utils/rethrownError');
const { logWarn } = require('../../operations/common/logging');

/**
 * Repository for AccessLog ClickHouse data access.
 *
 * Encapsulates insert logic with retry for the fhir.AccessLog table.
 * Access-logs tolerate brief CH unavailability: the caller
 * (AccessLogClickHouseWriter) logs-and-swallows failures rather than
 * propagating, because a lost access-log must not break the request cycle.
 */
class AccessLogClickHouseRepository {
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
     * Inserts a batch of pre-transformed AccessLog rows into ClickHouse.
     * Retries up to 3 times with exponential backoff (2s → 4s → 8s) on failure.
     *
     * @param {Object[]} rows - Transformed rows matching the fhir.AccessLog schema
     * @returns {Promise<void>}
     * @throws {RethrownError} After retries exhausted
     */
    async insertBatchAsync(rows) {
        if (!rows || rows.length === 0) {
            return;
        }

        const insertParams = {
            table: TABLES.ACCESS_LOG,
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
                    logWarn('ClickHouse AccessLog insert failed, retrying', {
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
                        message: `ClickHouse AccessLog insert failed after ${this.maxRetries} retries (batch size ${rows.length})`,
                        error,
                        args: { batchSize: rows.length }
                    });
                }
            }
        }
    }
}

module.exports = { AccessLogClickHouseRepository };
