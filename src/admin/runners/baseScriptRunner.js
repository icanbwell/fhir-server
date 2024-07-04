/**
 * @typedef StartFromIdContainer
 * @property {string | null} startFromId
 * @property {number} skippedIdsForHavingAccessField
 * @property {number} skippedIdsForMissingSecurityTags
 * @property {number} convertedIds
 * @property {number} nModified
 * @property {number} nUpserted
 * @property {number} numScanned
 * @property {number} numOperations
 * @property {number} numberWritten
 * @property {number} numberOfDocumentsToCopy
 */

const { assertTypeEquals } = require('../../utils/assertType');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { AdminLogger } = require('../adminLogger');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');

/**
 * @classdesc base class that implements connecting to the database
 */
class BaseScriptRunner {
    /**
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor (
        {
            mongoCollectionManager,
            adminLogger,
            mongoDatabaseManager
        }) {
        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    async init () {
        /**
         * For reporting progress
         * @type {StartFromIdContainer}
         */
        this.startFromIdContainer = this.createStartFromIdContainer();
    }

    createStartFromIdContainer () {
        return {
            startFromId: '',
            skippedIdsForHavingAccessField: 0,
            skippedIdsForMissingSecurityTags: 0,
            skippedIdsForMissingAccessTags: 0,
            convertedIds: 0,
            nModified: 0,
            nUpserted: 0,
            numScanned: 0,
            numOperations: 0,
            numberWritten: 0,
            numberOfDocumentsToCopy: 0
        };
    }

    async shutdown () {
        // ok to not specify
    }

    /**
     * gets all collection names
     * @param {boolean} useAuditDatabase
     * @param {boolean} useAccessLogsDatabase
     * @param {boolean|undefined} [includeHistoryCollections]
     * @returns {Promise<string[]>}
     */
    async getAllCollectionNamesAsync ({ useAuditDatabase, useAccessLogsDatabase, includeHistoryCollections }) {
        const config = useAuditDatabase
            ? await this.mongoDatabaseManager.getAuditConfigAsync()
            : useAccessLogsDatabase ? await this.mongoDatabaseManager.getAccessLogsConfigAsync()
            : await this.mongoDatabaseManager.getClientConfigAsync();

        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(config);
        /**
         * @type {import('mongodb').Db}
         */
        const db = client.db(config.db_name);
        /**
         * @type {string[]}
         */
        let collectionNames = await this.mongoCollectionManager.getAllCollectionNames({ db });
        // exclude history tables since we always search by id on those
        if (!includeHistoryCollections) {
            collectionNames = collectionNames.filter(c => !c.includes('_History'));
        } else if (!useAuditDatabase && !useAccessLogsDatabase) {
            const resourceHistoryDb = await this.mongoDatabaseManager.getResourceHistoryDbAsync();
            collectionNames = collectionNames.concat(
                await this.mongoCollectionManager.getAllCollectionNames({ db: resourceHistoryDb })
            );
        }
        await this.mongoDatabaseManager.disconnectClientAsync(client);
        return collectionNames;
    }
}

module.exports = {
    BaseScriptRunner
};
