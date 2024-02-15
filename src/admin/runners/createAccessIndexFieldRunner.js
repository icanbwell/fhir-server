const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {mongoConfig, auditEventMongoConfig} = require('../../config');
const {SourceIdColumnHandler} = require('../../preSaveHandlers/handlers/sourceIdColumnHandler');
const {UuidColumnHandler} = require('../../preSaveHandlers/handlers/uuidColumnHandler');
const {SourceAssigningAuthorityColumnHandler} = require('../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const {AccessColumnHandler} = require('../../preSaveHandlers/handlers/accessColumnHandler');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {logError} = require('../../operations/common/logging');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');

/**
 * @classdesc Creats _access field
 */
class CreateAccessIndexRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {boolean} useAuditDatabase
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {ConfigManager} configManager
     */
    constructor (
        {
            mongoCollectionManager,
            collections,
            batchSize,
            useAuditDatabase,
            adminLogger,
            mongoDatabaseManager,
            configManager
        }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {string[]}
         */
        this.collections = collections;
        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {boolean}
         */
        this.useAuditDatabase = useAuditDatabase;
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        const operations = [];
        if (!doc.meta || !doc.meta.security) {
            return operations;
        }
        // Step 1: Add any missing _access tags
        const accessCodes = doc.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code);
        // update only the necessary field in the document
        const setCommand = {};
        /**
         * @type {boolean}
         */
        let hasUpdate = false;
        if (accessCodes.length > 0 && !doc['_access']) {
            const accessColumnHandler = new AccessColumnHandler();
            doc = await accessColumnHandler.preSaveAsync({resource: doc});
            setCommand['_access'] = doc._access;
            hasUpdate = true;
        }
        // Step 2: add any missing _sourceAssigningAuthority tags
        /**
         * @type {string[]}
         */
        let sourceAssigningAuthorityCodes = doc.meta.security.filter(
            s => s.system === SecurityTagSystem.sourceAssigningAuthority).map(s => s.code);
        // if no sourceAssigningAuthorityCodes so fall back to owner tags
        if (sourceAssigningAuthorityCodes.length === 0) {
            sourceAssigningAuthorityCodes = doc.meta.security.filter(
                s => s.system === SecurityTagSystem.owner).map(s => s.code);
        }
        if (sourceAssigningAuthorityCodes.length > 0 && !doc['_sourceAssigningAuthority']) {
            const sourceAssigningAuthorityColumnHandler = new SourceAssigningAuthorityColumnHandler();
            doc = await sourceAssigningAuthorityColumnHandler.preSaveAsync({resource: doc});
            setCommand['_sourceAssigningAuthority'] = doc._sourceAssigningAuthority;
            setCommand['meta'] = doc.meta;
            hasUpdate = true;
        }
        // Step 3: add _sourceId
        if (!doc['_sourceId']) {
            const sourceIdColumnHandler = new SourceIdColumnHandler();
            doc = await sourceIdColumnHandler.preSaveAsync({resource: doc});
            setCommand['_sourceId'] = doc._sourceId;
            setCommand['meta'] = doc.meta;
            hasUpdate = true;
        }
        // Step 4: add _uuid
        if (!doc['_uuid']) {
            const uuidColumnHandler = new UuidColumnHandler({configManager: this.configManager});
            doc = await uuidColumnHandler.preSaveAsync({resource: doc});
            setCommand['_uuid'] = doc._uuid;
            setCommand['meta'] = doc.meta;
            hasUpdate = true;
        }
        // if there are any updates to be done
        if (hasUpdate) {
            /**
             * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
             */
                // batch up the calls to update
            const result = {updateOne: {filter: {_id: doc._id}, update: {$set: setCommand}}};
            operations.push(result);
        }
        return operations;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                this.collections = await this.getAllCollectionNamesAsync(
                    {useAuditDatabase: this.useAuditDatabase});
            }

            await this.init();

            this.adminLogger.logInfo(`Starting loop for ${this.collections.join(',')}`);

            // if there is an exception, continue processing from the last id
            for (const collectionName of this.collections) {

                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                const query = {
                    _access: null
                };
                // noinspection JSValidateTypes
                /**
                 * @type {import('mongodb').Collection<import('mongodb').Document>}
                 */
                const projection = {
                    'id': 1,
                    'meta.security.system': 1,
                    'meta.security.code': 1,
                    '_access': 1,
                    '_sourceAssigningAuthority': 1,
                    '_sourceId': 1,
                    '_uuid': 1
                };
                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: this.useAuditDatabase ? auditEventMongoConfig : mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false
                        }
                    );
                } catch (e) {
                    logError(`Got error at ${this.startFromIdContainer.startFromId}`, {'error': e});
                }
                this.adminLogger.logInfo(`Finished loop ${collectionName}`);
            }
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            logError('ERROR', {'error': e});
        }
    }
}

module.exports = {
    CreateAccessIndexRunner
};
