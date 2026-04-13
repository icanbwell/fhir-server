const { isValidResource } = require('../../../utils/validResourceCheck');

/**
 * Creates a sync profile for FHIR resource history migration.
 * Reads from {resourceType}_4_0_0_History collections in the history MongoDB cluster
 * and writes to fhir.fhir_resource_history in ClickHouse.
 *
 * @param {Object} params
 * @param {import('../transformers/resourceHistoryTransformer').ResourceHistoryTransformer} params.transformer
 * @returns {Object} sync profile
 */
function createResourceHistorySyncProfile({ transformer }) {
    return {
        syncType: 'resourceHistory',
        clickHouseTable: 'fhir.fhir_resource_history',
        transformer,

        /**
         * @param {import('../../../utils/mongoDatabaseManager').MongoDatabaseManager} mongoDatabaseManager
         * @returns {Promise<Object>}
         */
        getDbConfigAsync: (mongoDatabaseManager) =>
            mongoDatabaseManager.getResourceHistoryConfigAsync(),

        /**
         * @param {Object} command
         * @returns {string}
         */
        getCollectionName: (command) =>
            `${command.resourceType}_4_0_0_History`,

        /**
         * @param {Object} command
         * @returns {{ valid: boolean, reason?: string }}
         */
        validateCommand: (command) => {
            if (!command.jobId) {
                return { valid: false, reason: 'missing jobId' };
            }
            if (!command.resourceType) {
                return { valid: false, reason: 'missing resourceType' };
            }
            if (!isValidResource(command.resourceType)) {
                return { valid: false, reason: `invalid resourceType: ${command.resourceType}` };
            }
            if (command.resourceType === 'AuditEvent') {
                return { valid: false, reason: 'AuditEvent does not have a history collection' };
            }
            return { valid: true };
        },

        /**
         * @param {import('../../../utils/configManager').ConfigManager} configManager
         * @returns {number}
         */
        getBatchSize: (configManager) => configManager.historySyncBatchSize,

        /**
         * @param {import('../../../utils/configManager').ConfigManager} configManager
         * @returns {boolean}
         */
        getDeleteFromMongo: (configManager) => configManager.historySyncDeleteFromMongo,

        /**
         * @param {Object} doc - MongoDB history document
         * @returns {string|null}
         */
        getTimestamp: (doc) => {
            const lu = doc.resource?.meta?.lastUpdated;
            return lu instanceof Date ? lu.toISOString() : lu;
        },

        /**
         * @param {Object} command
         * @returns {string}
         */
        getCheckpointKey: (command) => command.resourceType,

        /**
         * @param {Object} command
         * @param {string} firstMongoId
         * @param {string} lastMongoId
         * @returns {{ query: string, query_params: Object }}
         */
        getVerificationQuery: (command, firstMongoId, lastMongoId) => ({
            query: `SELECT count() as cnt FROM fhir.fhir_resource_history
                    WHERE resource_type = {resourceType:String}
                    AND mongo_id >= {firstId:String}
                    AND mongo_id <= {lastId:String}`,
            query_params: {
                resourceType: command.resourceType,
                firstId: firstMongoId,
                lastId: lastMongoId
            }
        })
    };
}

module.exports = { createResourceHistorySyncProfile };
