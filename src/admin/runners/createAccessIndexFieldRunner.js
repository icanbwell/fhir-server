const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {mongoConfig, auditEventMongoConfig} = require('../../config');
const {generateUUID} = require('../../utils/uid.util');

/**
 * @classdesc Copies documents from source collection into the appropriate partitioned collection
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
     */
    constructor(
        {
            mongoCollectionManager,
            collections,
            batchSize,
            useAuditDatabase,
            adminLogger,
            mongoDatabaseManager
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
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        const operations = [];
        if (!doc.meta || !doc.meta.security) {
            return operations;
        }
        // Step 1: Add any missing _access tags
        const accessCodes = doc.meta.security.filter(s => s.system === 'https://www.icanbwell.com/access').map(s => s.code);
        // update only the necessary field in the document
        const setCommand = {};
        /**
         * @type {boolean}
         */
        let hasUpdate = false;
        if (accessCodes.length > 0 && !doc['_access']) {
            const _access = {};
            for (const accessCode of accessCodes) {
                _access[`${accessCode}`] = 1;
            }
            setCommand['_access'] = _access;
            hasUpdate = true;
        }
        // Step 2: add any missing _sourceAssigningAuthority tags
        /**
         * @type {string[]}
         */
        let sourceAssigningAuthorityCodes = doc.meta.security.filter(
            s => s.system === 'https://www.icanbwell.com/sourceAssigningAuthority').map(s => s.code);
        // if no sourceAssigningAuthorityCodes so fall back to owner tags
        if (sourceAssigningAuthorityCodes.length === 0) {
            sourceAssigningAuthorityCodes = doc.meta.security.filter(
                s => s.system === 'https://www.icanbwell.com/owner').map(s => s.code);
        }
        if (sourceAssigningAuthorityCodes.length > 0 && !doc['_sourceAssigningAuthority']) {
            const _sourceAssigningAuthority = {};
            for (const sourceAssigningAuthorityCode of sourceAssigningAuthorityCodes) {
                _sourceAssigningAuthority[`${sourceAssigningAuthorityCode}`] = 1;
            }
            setCommand['_sourceAssigningAuthority'] = _sourceAssigningAuthority;
            hasUpdate = true;
        }
        // Step 3: add _sourceId
        if (!doc['_sourceId']) {
            setCommand['_sourceId'] = doc.id;
            hasUpdate = true;
        }
        // Step 4: add _uuid
        if (!doc['_uuid']) {
            setCommand['_uuid'] = `${generateUUID()}`;
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
    async processAsync() {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                this.collections = await this.getAllCollectionNamesAsync(
                    {useAuditDatabase: this.useAuditDatabase});
            }

            await this.init();

            console.log(`Starting loop for ${this.collections.join(',')}`);

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
                    console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                }
                console.log(`Finished loop ${collectionName}`);
            }
            console.log('Finished script');
            console.log('Shutting down');
            await this.shutdown();
            console.log('Shutdown finished');
        } catch (e) {
            console.log(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    CreateAccessIndexRunner
};
