/**
 * Creates a sync profile for AuditEvent migration.
 * Reads from AuditEvent_4_0_0* collections in the dedicated audit MongoDB cluster
 * and writes to fhir.fhir_audit_event in ClickHouse.
 *
 * @param {Object} params
 * @param {import('../transformers/auditEventTransformer').AuditEventTransformer} params.transformer
 * @returns {Object} sync profile
 */
function createAuditEventSyncProfile({ transformer }) {
    return {
        syncType: 'auditEvent',
        clickHouseTable: 'fhir.fhir_audit_event',
        transformer,

        /**
         * @param {import('../../../utils/mongoDatabaseManager').MongoDatabaseManager} mongoDatabaseManager
         * @returns {Promise<Object>}
         */
        getDbConfigAsync: (mongoDatabaseManager) =>
            mongoDatabaseManager.getAuditConfigAsync(),

        /**
         * @param {Object} command
         * @returns {string}
         */
        getCollectionName: (command) =>
            command.collection || 'AuditEvent_4_0_0',

        /**
         * @param {Object} command
         * @returns {{ valid: boolean, reason?: string }}
         */
        validateCommand: (command) => {
            if (!command.jobId) {
                return { valid: false, reason: 'missing jobId' };
            }
            if (!command.collection && !command.resourceType) {
                return { valid: false, reason: 'missing collection or resourceType' };
            }
            return { valid: true };
        },

        /**
         * @param {import('../../../utils/configManager').ConfigManager} configManager
         * @returns {number}
         */
        getBatchSize: (configManager) => configManager.auditEventSyncBatchSize,

        /**
         * @param {import('../../../utils/configManager').ConfigManager} configManager
         * @returns {boolean}
         */
        getDeleteFromMongo: (configManager) => configManager.auditEventSyncDeleteFromMongo,

        /**
         * @param {Object} doc - MongoDB AuditEvent document
         * @returns {string|null}
         */
        getTimestamp: (doc) => {
            const r = doc.recorded;
            return r instanceof Date ? r.toISOString() : r;
        },

        /**
         * @param {Object} command
         * @returns {string}
         */
        getCheckpointKey: (command) =>
            `auditEvent:${command.collection || 'AuditEvent_4_0_0'}`,

        /**
         * @param {Object} command
         * @param {string} firstMongoId
         * @param {string} lastMongoId
         * @returns {{ query: string, query_params: Object }}
         */
        getVerificationQuery: (command, firstMongoId, lastMongoId) => ({
            query: `SELECT count() as cnt FROM fhir.fhir_audit_event
                    WHERE mongo_id >= {firstId:String}
                    AND mongo_id <= {lastId:String}`,
            query_params: {
                firstId: firstMongoId,
                lastId: lastMongoId
            }
        })
    };
}

module.exports = { createAuditEventSyncProfile };
