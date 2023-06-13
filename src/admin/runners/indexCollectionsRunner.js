const {assertTypeEquals} = require('../../utils/assertType');
const {IndexManager} = require('../../indexes/indexManager');
const {BaseScriptRunner} = require('./baseScriptRunner');


/**
 * @classdesc Adds and removes indexes
 */
class IndexCollectionsRunner extends BaseScriptRunner {
    /**
     * constructor
     * @param {IndexManager} indexManager
     * @param {string[]|undefined} [collections]
     * @param {boolean|undefined} [dropIndexes]
     * @param {boolean|undefined} [useAuditDatabase]
     * @param {boolean} includeHistoryCollections
     * @param {boolean} addMissingIndexesOnly
     * @param {boolean} removeExtraIndexesOnly
     * @param {AdminLogger} adminLogger
     * @param {boolean} synchronizeIndexes
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     */
    constructor(
        {
            indexManager,
            collections,
            dropIndexes,
            useAuditDatabase,
            includeHistoryCollections,
            addMissingIndexesOnly,
            removeExtraIndexesOnly,
            adminLogger,
            synchronizeIndexes,
            mongoDatabaseManager,
            mongoCollectionManager
        }
    ) {
        super({
            mongoCollectionManager,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {IndexManager}
         */
        this.indexManager = indexManager;
        assertTypeEquals(indexManager, IndexManager);

        /**
         * @type {string[]|undefined}
         */
        this.collections = collections;

        /**
         * @type {boolean|undefined}
         */
        this.dropIndexes = dropIndexes;

        /**
         * @type {boolean|undefined}
         */
        this.useAuditDatabase = useAuditDatabase;

        /**
         * @type {boolean}
         */
        this.includeHistoryCollections = includeHistoryCollections;
        /**
         * @type {boolean}
         */
        this.synchronizeIndexes = synchronizeIndexes;
        /**
         * @type {boolean}
         */
        this.addMissingIndexesOnly = addMissingIndexesOnly;
        /**
         * @type {boolean}
         */
        this.removeExtraIndexesOnly = removeExtraIndexesOnly;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            await this.init();
            /**
             * @type {import('mongodb').Db}
             */
            const db = this.useAuditDatabase ? await this.mongoDatabaseManager.getAuditDbAsync() :
                await this.mongoDatabaseManager.getClientDbAsync();
            if (this.addMissingIndexesOnly) {
                await this.indexManager.addMissingIndexesAsync(
                    {
                        audit: this.useAuditDatabase
                    }
                );
            } else if (this.removeExtraIndexesOnly) {
                await this.indexManager.removeExtraIndexesAsync(
                    {
                        audit: this.useAuditDatabase
                    }
                );
            } else if (this.synchronizeIndexes) {
                await this.indexManager.synchronizeIndexesWithConfigAsync(
                    {
                        audit: this.useAuditDatabase
                    }
                );
            } else {
                if (this.collections.length > 0 && this.collections[0] === 'all') {
                    this.collections = await this.getAllCollectionNamesAsync(
                        {
                            useAuditDatabase: this.useAuditDatabase,
                            includeHistoryCollections: this.includeHistoryCollections
                        });
                    this.collections = this.collections.sort();
                }
                for (const collectionName of this.collections) {
                    if (this.dropIndexes) {
                        await this.indexManager.deleteIndexesInAllCollectionsInDatabaseAsync({
                            db,
                            collectionRegex: collectionName
                        });
                    }
                    await this.indexManager.indexAllCollectionsInDatabaseAsync({
                        db,
                        collectionRegex: collectionName
                    });
                }
            }
        } catch (e) {
            this.adminLogger.logError('ERROR', {error: 'e'});
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    IndexCollectionsRunner
};
