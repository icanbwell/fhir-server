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
const { AdminLogger } = require('../adminLogger');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { isNotSystemCollection } = require('../../utils/mongoDBUtils');

/**
 * @classdesc base class that implements connecting to the database
 */
class BaseScriptRunner {
    /**
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor (
        {
            adminLogger,
            mongoDatabaseManager
        }) {
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
        let collectionNames = await this.getAllCollectionNamesForDb({ db });
        // exclude history tables since we always search by id on those
        if (!includeHistoryCollections) {
            collectionNames = collectionNames.filter(c => !c.includes('_History'));
        } else if (!useAuditDatabase && !useAccessLogsDatabase) {
            const resourceHistoryDb = await this.mongoDatabaseManager.getResourceHistoryDbAsync();
            // for backward compatability in case clientDB and resourceHistoryDB are same
            collectionNames = new Set(
                collectionNames.concat(
                    await this.getAllCollectionNamesForDb({
                        db: resourceHistoryDb
                    })
                )
            );
        }
        await this.mongoDatabaseManager.disconnectClientAsync(client);
        return Array.from(collectionNames);
    }

    /**
     * Returns the list of all collection names specific to a db
     * @param {import('mongodb').Db} db
     * @return {Promise<string[]>}
     */
    async getAllCollectionNamesForDb ({ db }) {
        /**
         * @type {string[]}
         */
        const collectionNames = [];
        for await (const /** @type {{name: string, type: string}} */ collection of db.listCollections(
            { type: { $ne: 'view' } }, { nameOnly: true })) {
            if (isNotSystemCollection(collection.name)) {
                collectionNames.push(collection.name);
            }
        }
        return collectionNames;
    }
}

module.exports = {
    BaseScriptRunner
};
