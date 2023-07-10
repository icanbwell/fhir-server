const env = require('var');
const { logInfo, logError } = require('../operations/common/logging');
const { isTrue } = require('../utils/isTrue');
const { accessLogsMongoConfig } = require('../config');
const { MongoClient } = require('mongodb');

class AdminLogManager {

    /**
     * gets logs
     * @param id
     * @returns {Promise<Object[]>}
     */
    async getLogAsync(id) {
        try {
            if (isTrue(env.ENABLE_MONGODB_ACCESS_LOGS_SEARCH)) {
                /**
                 * @type {MongoClient}
                 */
                const client = new MongoClient(accessLogsMongoConfig.connection, accessLogsMongoConfig.options);

                const accessLogsCollectionName = env.ACCESS_LOGS_COLLECTION_NAME ? String(env.ACCESS_LOGS_COLLECTION_NAME) : 'access_logs';

                const accessLogsDb = client.db(accessLogsMongoConfig.db_name);

                const accessLogsCollection = accessLogsDb.collection(accessLogsCollectionName);

                const result = await accessLogsCollection.find({ 'meta.id': { $eq: id } }).toArray();
                logInfo('', { result });
                return result;
            }
        } catch (e) {
            logError(e.message, {'error': e});
        }
        return [];
    }
}

module.exports = {
    AdminLogManager
};
