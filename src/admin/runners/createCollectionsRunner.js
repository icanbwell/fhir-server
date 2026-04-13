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
                this.adminLogger.logInfo('MongoDB Group Members feature is enabled', { enableMongoGroupMembers: true });
                const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');

                if (!existingMainDbCollections.includes(COLLECTIONS.GROUP_MEMBER_EVENTS)) {
                    this.adminLogger.logInfo('Creating MongoDB Group Member collection', { collection: COLLECTIONS.GROUP_MEMBER_EVENTS });
                    await mainDb.createCollection(COLLECTIONS.GROUP_MEMBER_EVENTS);
                } else {
                    this.adminLogger.logInfo('MongoDB Group Member collection already exists', { collection: COLLECTIONS.GROUP_MEMBER_EVENTS });
                }

                if (!existingMainDbCollections.includes(COLLECTIONS.GROUP_MEMBER_CURRENT)) {
                    this.adminLogger.logInfo('Creating MongoDB Group Member view', { view: COLLECTIONS.GROUP_MEMBER_CURRENT });
                    try {
                        // Create view using createCollection with viewOn option
                        await mainDb.createCollection(COLLECTIONS.GROUP_MEMBER_CURRENT, {
                            viewOn: COLLECTIONS.GROUP_MEMBER_EVENTS,
                            pipeline: [
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
                            ]
                        });
                        this.adminLogger.logInfo('MongoDB Group Member view created successfully', { view: COLLECTIONS.GROUP_MEMBER_CURRENT });
                    } catch (viewError) {
                        this.adminLogger.logError('Failed to create MongoDB Group Member view', {
                            view: COLLECTIONS.GROUP_MEMBER_CURRENT,
                            error: viewError.message,
                            code: viewError.code,
                            codeName: viewError.codeName,
                            stack: viewError.stack
                        });
                        // If view already exists (error 48), that's okay
                        if (viewError.code !== 48) {
                            throw viewError;
                        }
                        this.adminLogger.logInfo('View already exists (continuing)', { view: COLLECTIONS.GROUP_MEMBER_CURRENT });
                    }
                } else {
                    this.adminLogger.logInfo('MongoDB Group Member view already exists', { view: COLLECTIONS.GROUP_MEMBER_CURRENT });
                }
            } else {
                this.adminLogger.logInfo('MongoDB Group Members feature is disabled', { enableMongoGroupMembers: false });
            }

            // Create MongoDB Direct Group Member collection (V2 - no event sourcing)
            if (this.configManager?.enableMongoDirectGroupMembers) {
                this.adminLogger.logInfo('MongoDB Direct Group Members feature is enabled');
                const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');

                if (!existingMainDbCollections.includes(COLLECTIONS.GROUP_MEMBER_DIRECT)) {
                    this.adminLogger.logInfo('Creating MongoDB Direct Group Member collection',
                        { collection: COLLECTIONS.GROUP_MEMBER_DIRECT });
                    await mainDb.createCollection(COLLECTIONS.GROUP_MEMBER_DIRECT);
                } else {
                    this.adminLogger.logInfo('MongoDB Direct Group Member collection already exists',
                        { collection: COLLECTIONS.GROUP_MEMBER_DIRECT });
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
            this.adminLogger.logError('Error in CreateCollectionsRunner', {
                error: e.message,
                stack: e.stack,
                code: e.code,
                name: e.name,
                errorDetails: JSON.stringify(e, Object.getOwnPropertyNames(e))
            });
            throw e;
        } finally {
            await this.shutdown();
        }
    }
}

module.exports = {
    CreateCollectionsRunner
};
