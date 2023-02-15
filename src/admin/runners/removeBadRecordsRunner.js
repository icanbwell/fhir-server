const {assertTypeEquals} = require('../../utils/assertType');
const {IndexManager} = require('../../indexes/indexManager');
const {BaseScriptRunner} = require('./baseScriptRunner');
const {AdminLogger} = require('../adminLogger');
const {MongoDatabaseManager} = require('../../utils/mongoDatabaseManager');


/**
 * @classdesc Removes bad records from the database
 */
class RemoveBadRecordsRunner extends BaseScriptRunner {
    /**
     * constructor
     * @param {IndexManager} indexManager
     * @param {string[]|undefined} [collections]
     * @param {boolean|undefined} [useAuditDatabase]
     * @param {boolean} includeHistoryCollections
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor(
        {
            indexManager,
            collections,
            useAuditDatabase,
            includeHistoryCollections,
            adminLogger,
            mongoDatabaseManager
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
        this.useAuditDatabase = useAuditDatabase;

        /**
         * @type {boolean}
         */
        this.includeHistoryCollections = includeHistoryCollections;

        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
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
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                this.collections = await this.getAllCollectionNamesAsync(
                    {
                        useAuditDatabase: this.useAuditDatabase,
                        includeHistoryCollections: this.includeHistoryCollections
                    });
                this.collections = this.collections.sort();
            }
            for (const collectionName of this.collections) {
                this.adminLogger.log(`Processing ${collectionName}`);
                let filter = {'id': null};
                this.adminLogger.log(`Deleting in ${collectionName} by filter: ${filter}`);
                let result = await db.collection(collectionName).deleteMany(filter);
                this.adminLogger.log(`Deleted ${result.deletedCount} records by filter: ${filter}`);
                filter = {'_access.undefined': 1};
                this.adminLogger.log(`Deleting in ${collectionName} by filter: ${filter}`);
                result = await db.collection(collectionName).deleteMany(filter);
                this.adminLogger.log(`Deleted ${result.deletedCount} records by filter: ${filter}`);
            }
        } catch (e) {
            console.error(e);
            this.adminLogger.logError(`ERROR: ${e}`);
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    RemoveBadRecordsRunner
};
