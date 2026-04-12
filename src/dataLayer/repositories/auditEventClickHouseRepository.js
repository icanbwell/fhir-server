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

        try {
            await this.clickHouseClientManager.insertAsync({
                table: TABLES.AUDIT_EVENT,
                values: rows,
                format: QUERY_FORMAT.JSON_EACH_ROW,
                clickhouse_settings: {
                    async_insert: 1,
                    wait_for_async_insert: 1
                }
            });
        } catch (error) {
            // Retry with exponential backoff
            const maxRetries = this.maxRetries;
            let delay = this.initialRetryDelayMs;
            let currentError = error;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    logWarn('ClickHouse AuditEvent insert failed, retrying', {
                        attempt,
                        maxRetries,
                        batchSize: rows.length,
                        delay,
                        error: currentError.message
                    });
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    await this.clickHouseClientManager.insertAsync({
                        table: TABLES.AUDIT_EVENT,
                        values: rows,
                        format: QUERY_FORMAT.JSON_EACH_ROW
                    });
                    return;
                } catch (retryError) {
                    currentError = retryError;
                    if (attempt === maxRetries) {
                        throw new RethrownError({
                            message: `ClickHouse AuditEvent insert failed after ${maxRetries} retries (batch size ${rows.length})`,
                            error: retryError,
                            args: { batchSize: rows.length }
                        });
                    }
                    delay *= 2;
                }
            }
        }
    }
}

module.exports = { AuditEventClickHouseRepository };
