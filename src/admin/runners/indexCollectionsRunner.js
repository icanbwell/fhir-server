const { assertTypeEquals } = require('../../utils/assertType');
const { IndexManager } = require('../../indexes/indexManager');
const { BaseScriptRunner } = require('./baseScriptRunner');

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
     * @param {boolean|undefined} [useAccessLogsDatabase]
     * @param {boolean} includeHistoryCollections
     * @param {boolean} addMissingIndexesOnly
     * @param {boolean} removeExtraIndexesOnly
     * @param {AdminLogger} adminLogger
     * @param {boolean} synchronizeIndexes
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor (
        {
            indexManager,
            collections,
            dropIndexes,
            useAuditDatabase,
            useAccessLogsDatabase,
            includeHistoryCollections,
            addMissingIndexesOnly,
            removeExtraIndexesOnly,
            adminLogger,
            synchronizeIndexes,
            mongoDatabaseManager
        }
    ) {
        super({
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
         * @type {boolean|undefined}
         */
        this.useAccessLogsDatabase = useAccessLogsDatabase;

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
    async processAsync () {
        try {
            await this.init();
            this.adminLogger.logInfo('INFO', { message: 'IndexCollectionsRunner started' });
            /**
             * @type {import('mongodb').Db}
             */
            const db = this.useAuditDatabase ? await this.mongoDatabaseManager.getAuditDbAsync()
                : this.useAccessLogsDatabase ? await this.mongoDatabaseManager.getAccessLogsDbAsync()
                    : await this.mongoDatabaseManager.getClientDbAsync();

            const collections = this.collections.length > 0 ? this.collections : ['all'];
            if (this.addMissingIndexesOnly) {
                await this.indexManager.addMissingIndexesAsync(
                    {
                        audit: this.useAuditDatabase,
                        accessLogs: this.useAccessLogsDatabase,
                        collections
                    }
                );
            } else if (this.removeExtraIndexesOnly) {
                await this.indexManager.dropExtraIndexesAsync(
                    {
                        audit: this.useAuditDatabase,
                        accessLogs: this.useAccessLogsDatabase,
                        collections
                    }
                );
            } else if (this.synchronizeIndexes) {
                await this.indexManager.synchronizeIndexesWithConfigAsync(
                    {
                        audit: this.useAuditDatabase,
                        accessLogs: this.useAccessLogsDatabase,
                        collections
                    }
                );
            } else {
                const resourceHistoryDb = await this.mongoDatabaseManager.getResourceHistoryDbAsync();
                if (this.collections.length > 0 && this.collections[0] === 'all') {
                    this.collections = await this.getAllCollectionNamesAsync(
                        {
                            useAuditDatabase: this.useAuditDatabase,
                            useAccessLogsDatabase: this.useAccessLogsDatabase,
                            includeHistoryCollections: this.includeHistoryCollections
                        });
                    this.collections = this.collections.sort();
                }
                for (const collectionName of this.collections) {
                    if (this.dropIndexes) {
                        await this.indexManager.deleteIndexesInAllCollectionsInDatabaseAsync({
                            db: collectionName.includes('_History') ? resourceHistoryDb : db,
                            collectionRegex: collectionName
                        });
                    }
                    await this.indexManager.indexAllCollectionsInDatabaseAsync({
                        db: collectionName.includes('_History') ? resourceHistoryDb : db,
                        collectionRegex: collectionName
                    });
                }
            }
            this.adminLogger.logInfo('INFO', { message: 'IndexCollectionsRunner finished' });
        } catch (e) {
            this.adminLogger.logError('ERROR', { error: e });
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    IndexCollectionsRunner
};
