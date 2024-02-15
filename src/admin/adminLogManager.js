const env = require('var');
const { logInfo, logError } = require('../operations/common/logging');
const {assertTypeEquals} = require('../utils/assertType');
const { isTrue } = require('../utils/isTrue');
const { ACCESS_LOGS_COLLECTION_NAME } = require('../constants');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');

class AdminLogManager {
    /**
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor ({
        mongoDatabaseManager
    }) {
        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    /**
     * gets logs
     * @param id
     * @returns {Promise<Object[]>}
     */
    async getLogAsync (id) {
        try {
            if (isTrue(env.ENABLE_MONGODB_ACCESS_LOGS)) {
                const accessLogsDb = await this.mongoDatabaseManager.getAccessLogsDbAsync();

                const accessLogsCollection = accessLogsDb.collection(ACCESS_LOGS_COLLECTION_NAME);

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
