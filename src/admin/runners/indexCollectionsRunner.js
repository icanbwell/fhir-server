const {assertTypeEquals} = require('../../utils/assertType');
const {IndexManager} = require('../../indexes/indexManager');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, CLIENT_DB} = require('../../constants');
const {BaseScriptRunner} = require('./baseScriptRunner');
const {AdminLogger} = require('../adminLogger');


/**
 * @classdesc Copies documents from source collection into the appropriate partitioned collection
 */
class IndexCollectionsRunner extends BaseScriptRunner {
    /**
     * constructor
     * @param {IndexManager} indexManager
     * @param {string[]|undefined} [collections]
     * @param {boolean|undefined} [dropIndexes]
     * @param {boolean|undefined} [useAuditDatabase]
     * @param {boolean} includeHistoryCollections
     * @param {AdminLogger} adminLogger
     */
    constructor(
        {
            indexManager,
            collections,
            dropIndexes,
            useAuditDatabase,
            includeHistoryCollections,
            adminLogger
        }
    ) {
        super();
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

        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            await this.init();
            /**
             * @type {string}
             */
            const dbName = this.useAuditDatabase ? AUDIT_EVENT_CLIENT_DB : CLIENT_DB;
            /**
             * @type {import('mongodb').Db}
             */
            const db = globals.get(dbName);
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                this.collections = await this.getAllCollectionNamesAsync(
                    {
                        useAuditDatabase: this.useAuditDatabase,
                        includeHistoryCollections: this.includeHistoryCollections
                    });
            }
            for (const collectionName of this.collections) {
                if (this.dropIndexes) {
                    await this.indexManager.deleteIndexesInAllCollectionsInDatabase({
                        db,
                        collectionRegex: collectionName
                    });
                }
                await this.indexManager.indexAllCollectionsInDatabaseAsync({
                    db,
                    collectionRegex: collectionName
                });
            }
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    IndexCollectionsRunner
};
