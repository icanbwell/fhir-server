/**
 * Creates a sync profile for access logs migration.
 * Reads from the 'access-logs' collection in the dedicated access logs MongoDB cluster
 * and writes to fhir.fhir_access_logs in ClickHouse.
 *
 * @param {Object} params
 * @param {import('../transformers/accessLogsTransformer').AccessLogsTransformer} params.transformer
 * @returns {Object} sync profile
 */
function createAccessLogsSyncProfile({ transformer }) {
    return {
        syncType: 'accessLogs',
        clickHouseTable: 'fhir.fhir_access_logs',
        transformer,

        /**
         * @param {import('../../../utils/mongoDatabaseManager').MongoDatabaseManager} mongoDatabaseManager
         * @returns {Promise<Object>}
         */
        getDbConfigAsync: (mongoDatabaseManager) =>
            mongoDatabaseManager.getAccessLogsConfigAsync(),

        /**
         * @param {Object} _command
         * @returns {string}
         */
        getCollectionName: (_command) => 'access-logs',

        /**
         * @param {Object} command
         * @returns {{ valid: boolean, reason?: string }}
         */
        validateCommand: (command) => {
            if (!command.jobId) {
                return { valid: false, reason: 'missing jobId' };
            }
            return { valid: true };
        },

        /**
         * @param {import('../../../utils/configManager').ConfigManager} configManager
         * @returns {number}
         */
        getBatchSize: (configManager) => configManager.accessLogsSyncBatchSize,

        /**
         * @param {import('../../../utils/configManager').ConfigManager} configManager
         * @returns {boolean}
         */
        getDeleteFromMongo: (configManager) => configManager.accessLogsSyncDeleteFromMongo,

        /**
         * @param {Object} doc - MongoDB access log document
         * @returns {string|null}
         */
        getTimestamp: (doc) => {
            const t = doc.timestamp;
            return t instanceof Date ? t.toISOString() : t;
        },

        /**
         * @param {Object} _command
         * @returns {string}
         */
        getCheckpointKey: (_command) => 'accessLogs:access-logs',

        /**
         * @param {Object} _command
         * @param {string} firstMongoId
         * @param {string} lastMongoId
         * @returns {{ query: string, query_params: Object }}
         */
        getVerificationQuery: (_command, firstMongoId, lastMongoId) => ({
            query: `SELECT count() as cnt FROM fhir.fhir_access_logs
                    WHERE mongo_id >= {firstId:String}
                    AND mongo_id <= {lastId:String}`,
            query_params: {
                firstId: firstMongoId,
                lastId: lastMongoId
            }
        })
    };
}

module.exports = { createAccessLogsSyncProfile };
