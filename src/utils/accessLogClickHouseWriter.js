const { logError } = require('../operations/common/logging');
const { AccessLogClickHouseRepository } = require('../dataLayer/repositories/accessLogClickHouseRepository');
const { AccessLogTransformer } = require('../dataLayer/clickHouse/accessLogTransformer');
const { assertTypeEquals } = require('./assertType');

/**
 * Transforms access-log documents and writes them to ClickHouse.
 *
 * Unlike AuditEventClickHouseWriter, errors are logged and swallowed —
 * a dropped access-log must never break the request cycle. This matches
 * the failure semantics of the existing Mongo branch in AccessLogger.flushAsync().
 */
class AccessLogClickHouseWriter {
    /**
     * @param {Object} params
     * @param {AccessLogClickHouseRepository} params.accessLogClickHouseRepository
     * @param {AccessLogTransformer} params.accessLogTransformer
     */
    constructor({ accessLogClickHouseRepository, accessLogTransformer }) {
        this.repository = accessLogClickHouseRepository;
        assertTypeEquals(accessLogClickHouseRepository, AccessLogClickHouseRepository);

        this.transformer = accessLogTransformer;
        assertTypeEquals(accessLogTransformer, AccessLogTransformer);
    }

    /**
     * Transforms and writes a batch of access-log documents to ClickHouse.
     * Errors are logged with context and swallowed; this method never throws.
     *
     * @param {Object[]} docs - AccessLogger logEntry documents
     * @returns {Promise<{inserted: number, skipped: number}>}
     */
    async writeBatchAsync(docs) {
        if (!docs || docs.length === 0) {
            return { inserted: 0, skipped: 0 };
        }

        const { rows, skipped } = this.transformer.transformBatch(docs);

        if (rows.length === 0) {
            return { inserted: 0, skipped };
        }

        try {
            await this.repository.insertBatchAsync(rows);
            return { inserted: rows.length, skipped };
        } catch (error) {
            logError('AccessLogClickHouseWriter: batch write failed', {
                error: error.message,
                source: 'AccessLogClickHouseWriter.writeBatchAsync',
                args: {
                    batchSize: docs.length,
                    transformedRows: rows.length,
                    skipped,
                    firstRequestId: docs[0]?.request?.id || 'unknown'
                }
            });
            return { inserted: 0, skipped: docs.length };
        }
    }
}

module.exports = { AccessLogClickHouseWriter };
