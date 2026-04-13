const { logError } = require('../operations/common/logging');
const { AuditEventClickHouseRepository } = require('../dataLayer/repositories/auditEventClickHouseRepository');
const { AuditEventTransformer } = require('../admin/utils/auditEventTransformer');
const { assertTypeEquals } = require('./assertType');

/**
 * Transforms FHIR AuditEvent JSON documents and writes them to ClickHouse.
 *
 * ClickHouse is the source of truth for AuditEvent — errors are logged
 * with full context and re-thrown so callers are aware of failures.
 * Retry logic is handled by the repository layer.
 */
class AuditEventClickHouseWriter {
    /**
     * @param {Object} params
     * @param {AuditEventClickHouseRepository} params.auditEventClickHouseRepository
     * @param {AuditEventTransformer} params.auditEventTransformer
     */
    constructor({ auditEventClickHouseRepository, auditEventTransformer }) {
        this.repository = auditEventClickHouseRepository;
        assertTypeEquals(auditEventClickHouseRepository, AuditEventClickHouseRepository);

        this.transformer = auditEventTransformer;
        assertTypeEquals(auditEventTransformer, AuditEventTransformer);
    }

    /**
     * Transforms and writes a batch of FHIR AuditEvent JSON documents to ClickHouse.
     *
     * @param {Object[]} fhirJsonDocs - Array of toJSONInternal() output from AuditEvent resources
     * @returns {Promise<{inserted: number, skipped: number}>}
     * @throws {Error} If ClickHouse write fails after retries
     */
    async writeBatchAsync(fhirJsonDocs) {
        if (!fhirJsonDocs || fhirJsonDocs.length === 0) {
            return { inserted: 0, skipped: 0 };
        }

        const { rows, skipped } = this.transformer.transformBatch(fhirJsonDocs);

        if (rows.length === 0) {
            return { inserted: 0, skipped };
        }

        try {
            await this.repository.insertBatchAsync(rows);
            return { inserted: rows.length, skipped };
        } catch (error) {
            logError('AuditEventClickHouseWriter: batch write failed', {
                error: error.message,
                source: 'AuditEventClickHouseWriter.writeBatchAsync',
                args: {
                    batchSize: fhirJsonDocs.length,
                    transformedRows: rows.length,
                    skipped,
                    firstDocId: fhirJsonDocs[0]?._uuid || fhirJsonDocs[0]?.id || 'unknown'
                }
            });
            throw error;
        }
    }
}

module.exports = { AuditEventClickHouseWriter };
