const { assertTypeEquals } = require('../../utils/assertType');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../adminLogger');

class ProaResourcesStats {
    /**
     *
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string|Array|undefined} collections
     * @param {AdminLogger} adminLogger
     */
    constructor({ mongoDatabaseManager, collections, adminLogger }) {
        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

        /**
         * @type {string|undefined}
         */
        this.collections = collections;
    }

    async processAsync() {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        // Fetch all the collection names for the source database.
        const collectionNames = (await db.listCollections().toArray()).map((value) => value.name);

        // query for proa resources
        const query = {
            'meta.security': {
                $elemMatch: {
                    system: 'https://www.icanbwell.com/connectionType',
                    code: 'proa'
                }
            }
        };

        try {
            for (const collection of this.collections) {
                if (!collectionNames.includes(collection)) {
                    this.adminLogger.logError(`Invalid Collection Name: ${collection}`);
                    continue;
                }
                this.adminLogger.logInfo(`===== Processing ${collection} =====`);
                const databaseCollection = db.collection(collection);

                // count the proa resources
                const documentCount = await databaseCollection.countDocuments(query);

                this.adminLogger.logInfo(`Number of PROA resources in ${collection}: ${documentCount}}`);
            }
        } catch (error) {
            this.adminLogger.logError(`Error: ${error}`);
        } finally {
            this.adminLogger.logInfo('Finished Processing.');
        }
    }
}

module.exports = {
    ProaResourcesStats
};
