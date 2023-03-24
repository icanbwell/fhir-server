const { BaseScriptRunner } = require('./baseScriptRunner');


class CollectionStats extends BaseScriptRunner {
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

    filterCollections(collectionNames) {
        let filteredCollections = [];
        for ( let collection of collectionNames) {
            let groupedCollection = [];
            if (this.collections.includes(collection)) {
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
        const collectionNames = await this.getAllCollectionNamesAsync({
            useAuditDatabase: false,
            includeHistoryCollections: true,
        });
        const filteredCollections = this.collections ? this.filterCollections(collectionNames) : collectionNames;
        this.adminLogger.logInfo(`The list of collections are: ${filteredCollections}`);
        try {
            let result = {};
            const db = await this.mongoDatabaseManager.getClientDbAsync()
            for (const collection of filteredCollections) {
                const [mainCollection, historyCollection] = collection.length === 2 ? collection : [collection[0], null];
                const databaseCollectionMain = db.collection(mainCollection);
                const databaseCollectionHistory = historyCollection ? db.collection(historyCollection) : null;

                const [documntsInMainDb, documentsInHistoryDb] = await Promise.all([
                  databaseCollectionMain.countDocuments(),
                  databaseCollectionHistory ? databaseCollectionHistory.countDocuments() : 'Not Present'
                ]);
                this.adminLogger.logInfo(`For ${mainCollection} we have ${documntsInMainDb} documents${historyCollection ? `. The history collection contains ${documentsInHistoryDb}.` : ''}`);

                // eslint-disable-next-line security/detect-object-injection
                result[mainCollection] = {
                  documntsInMainDb,
                  documentsInHistoryDb
                };
              }
              this.adminLogger.logInfo(result);
        } catch (error) {
            this.adminLogger.logError(`Error: ${error}`);
        } finally {
            this.adminLogger.logInfo('Connection Closed.');
        }
    }
}


module.exports = {
    CollectionStats,
};
