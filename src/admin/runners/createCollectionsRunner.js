const { assertTypeEquals } = require('../../utils/assertType');
const { IndexManager } = require('../../indexes/indexManager');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { COLLECTION, ACCESS_LOGS_COLLECTION_NAME } = require('../../constants');

/**
 * @classdesc Creates all collections and indexes in the database
 */
class CreateCollectionsRunner extends BaseScriptRunner {
    /**
     * constructor
     * @param {{
     * indexManager: IndexManager,
     * adminLogger: AdminLogger,
     * mongoDatabaseManager: MongoDatabaseManager,
     * }} params
     */
    constructor({ indexManager, adminLogger, mongoDatabaseManager }) {
        super({
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {IndexManager}
         */
        this.indexManager = indexManager;
        assertTypeEquals(indexManager, IndexManager);
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            await this.init();

            this.adminLogger.logInfo('CreateCollectionsRunner', 'Starting to create collections and indexes');

            const resourceCollections = Object.values(COLLECTION)
                .map((collection) => {
                    return collection !== 'AuditEvent' ? `${collection}_4_0_0` : null;
                })
                .filter((collection) => collection !== null);

            resourceCollections.push("ExportStatus_4_0_0");

            const mainDb = await this.mongoDatabaseManager.getClientDbAsync();
            const historyDb = await this.mongoDatabaseManager.getResourceHistoryDbAsync();
            const accessLogsDb = await this.mongoDatabaseManager.getAccessLogsDbAsync();
            const auditDb = await this.mongoDatabaseManager.getAuditDbAsync();

            // create collections for main and history db
            const existingMainDbCollections = await this.getAllCollectionNamesForDb({ db: mainDb });
            const existingHistoryDbCollections = await this.getAllCollectionNamesForDb({ db: historyDb });
            for (const collectionName of resourceCollections) {
                if (!existingMainDbCollections.includes(collectionName)) {
                    await mainDb.createCollection(collectionName);
                }
                const historyCollectionName = `${collectionName}_History`;
                if (!existingHistoryDbCollections.includes(historyCollectionName)) {
                    await historyDb.createCollection(historyCollectionName);
                }
            }

            // create collections for access logs and audit db
            const existingAccessLogsCollections = await this.getAllCollectionNamesForDb({ db: accessLogsDb });
            const existingAuditCollections = await this.getAllCollectionNamesForDb({ db: auditDb });

            if (!existingAccessLogsCollections.includes(ACCESS_LOGS_COLLECTION_NAME)) {
                await accessLogsDb.createCollection(ACCESS_LOGS_COLLECTION_NAME);
            }
            if (!existingAuditCollections.includes('AuditEvent_4_0_0')) {
                await auditDb.createCollection('AuditEvent_4_0_0');
            }

            // synchronize indexes
            await this.indexManager.synchronizeIndexesWithConfigAsync({
                audit: true
            });

            await this.indexManager.synchronizeIndexesWithConfigAsync({
                accessLogs: true
            });

            await this.indexManager.synchronizeIndexesWithConfigAsync({});

            this.adminLogger.logInfo('CreateCollectionsRunner', 'Collections created successfully');
        } catch (e) {
            this.adminLogger.logError('ERROR', { error: e });
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    CreateCollectionsRunner
};
