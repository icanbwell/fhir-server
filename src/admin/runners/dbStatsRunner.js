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
        const validCollections = [];
        for (const collection of collectionNames) {
            // Skip collections which are of type views or collection whose name contains 'system.
            if (collection.type !== 'collection' || !this.mongoCollectionManager.isNotSystemCollection(collection.name)) {
                this.adminLogger.logInfo(`${collection.name} is an invalid collection`);
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
        const filteredCollections = [];
        const listOfCollections = this.collections ? this.collections : collectionNames;
        for ( const collection of collectionNames) {
            const groupedCollection = [];
            // If the collection is to included and also has a history table add it to the list of collections.
            if (listOfCollections.includes(collection) && !collection.endsWith('_History')) {
                groupedCollection.push(collection);
                // The history collection is present or not.
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
        this.adminLogger.logInfo(`The list of collections are: ${filteredCollections}`);
        let totalMainDocuments = 0;
        let totalHistoryDocuments = 0;
        try {
            const result = {};
            for (const collection of filteredCollections) {
                // Processing both the main and history collections together
                const [mainCollection, historyCollection] = collection.length === 2 ? [collection[0], collection[1]] : [collection[0], null];
                this.adminLogger.logInfo(
                    `===== Processing ${mainCollection} ${historyCollection ? `and its history collection ${historyCollection}.` : '.'} =====`
                );
                const databaseCollectionMain = db.collection(mainCollection);
                const databaseCollectionHistory = historyCollection ? db.collection(historyCollection) : null;

                // count the total documents of the main and target db.
                const [documntsInMainDb, documentsInHistoryDb] = await Promise.all([
                  databaseCollectionMain.countDocuments(),
                  databaseCollectionHistory ? databaseCollectionHistory.countDocuments() : 0
                ]);

                this.adminLogger.logInfo(
                    `For ${mainCollection} we have ${documntsInMainDb} documents${historyCollection ? `. The history collection contains ${documentsInHistoryDb}.` : ''}`
                );

                // Keep track of the total documents processed in main db
                totalMainDocuments += documntsInMainDb;
                // Keep tracks of the total socuments processed in history db.
                totalHistoryDocuments += documentsInHistoryDb;
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
