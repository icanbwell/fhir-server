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
     * configManager: ConfigManager,
     * }} params
     */
    constructor({ indexManager, adminLogger, mongoDatabaseManager, configManager }) {
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
         * @type {ConfigManager}
         */
        this.configManager = configManager;
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

            // Create MongoDB collection + view for Group member storage (if enabled)
            if (this.configManager?.enableMongoGroupMembers) {
                const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');

                if (!existingMainDbCollections.includes(COLLECTIONS.GROUP_MEMBER_EVENTS)) {
                    await mainDb.createCollection(COLLECTIONS.GROUP_MEMBER_EVENTS);
                }

                if (!existingMainDbCollections.includes(COLLECTIONS.GROUP_MEMBER_CURRENT)) {
                    await mainDb.createView(COLLECTIONS.GROUP_MEMBER_CURRENT, COLLECTIONS.GROUP_MEMBER_EVENTS, [
                        { $sort: { group_id: 1, member_type: 1, member_object_id: 1, _id: -1 } },
                        { $group: {
                            _id: { group_id: '$group_id', member_type: '$member_type', member_object_id: '$member_object_id' },
                            group_id: { $first: '$group_id' },
                            group_uuid: { $first: '$group_uuid' },
                            member_type: { $first: '$member_type' },
                            member_object_id: { $first: '$member_object_id' },
                            entity: { $first: '$entity' },
                            period: { $first: '$period' },
                            inactive: { $first: '$inactive' },
                            event_type: { $first: '$event_type' },
                            event_time: { $first: '$event_time' }
                        }}
                    ]);
                }
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
