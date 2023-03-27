const { BaseScriptRunner } = require('./baseScriptRunner');


class DatabaseStats extends BaseScriptRunner {
    /**
     *
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string|Array|undefined} collections
     * @param {AdminLogger} adminLogger
     */
    constructor ({
        mongoDatabaseManager,
        mongoCollectionManager,
        collections,
        adminLogger,
    }) {
        super({
            mongoCollectionManager,
            adminLogger,
            mongoDatabaseManager
        });

        /**
         * @type {string|undefined}
         */
        this.collections = collections;
    }

    /**
     * @description validates if the collection are type of collection and it's name does not contain system.
     * @param {Object} collectionNames
     * @returns {Object}
    */
    validateCollections(collectionNames) {
        let validCollections = [];
        for (let collection of collectionNames) {
            if (collection.type !== 'collection' || collection.name.indexOf('system.') !== -1) {
                continue;
            }
            validCollections.push(collection.name);
        }
        return validCollections;
    }

    /**
     * @description filters the required collection names only
     * @param {Object} collectionNames
     * @returns {Object}
    */
    filterCollections(collectionNames) {
        let filteredCollections = [];
        const listOfCollections = this.collections ? this.collections : collectionNames;
        for ( let collection of collectionNames) {
            let groupedCollection = [];
            if (listOfCollections.includes(collection) && !collection.endsWith('_History')) {
                groupedCollection.push(collection);
                if (collectionNames.includes(`${collection}_History`)) {
                    groupedCollection.push(`${collection}_History`);
                }
                filteredCollections.push(groupedCollection);
            }
        }
        return filteredCollections;
    }

    async processAsync() {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        // Fetch all the collection names for the source database.
        const collectionNames = await db.listCollections().toArray();
        const validCollections = this.validateCollections(collectionNames);
        const filteredCollections = this.filterCollections(validCollections);
        let totalMainDocuments = 0;
        let totalHistoryDocuments = 0;
        try {
            let result = {};
            for (const collection of filteredCollections) {
                const [mainCollection, historyCollection] = collection.length === 2 ? [collection[0], collection[1]] : [collection[0], null];
                const databaseCollectionMain = db.collection(mainCollection);
                const databaseCollectionHistory = historyCollection ? db.collection(historyCollection) : null;

                const [documntsInMainDb, documentsInHistoryDb] = await Promise.all([
                  databaseCollectionMain.countDocuments(),
                  databaseCollectionHistory ? databaseCollectionHistory.countDocuments() : 0
                ]);

                totalMainDocuments += documntsInMainDb;
                totalHistoryDocuments += documentsInHistoryDb;
                // eslint-disable-next-line security/detect-object-injection
                result[mainCollection] = {
                  documntsInMainDb,
                  documentsInHistoryDb
                };
            }
            this.adminLogger.logInfo(result);
            this.adminLogger.logInfo(
            `Total documents in main db = ${totalMainDocuments}, total documents in target db = ${totalHistoryDocuments}`
            );
        } catch (error) {
            this.adminLogger.logError(`Error: ${error}`);
        } finally {
            this.adminLogger.logInfo('Connection Closed.');
        }
    }
}


module.exports = {
    DatabaseStats,
};
