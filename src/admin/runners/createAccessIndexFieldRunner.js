const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {mongoConfig, auditEventMongoConfig} = require('../../config');

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
     */
    constructor(
        {
            mongoCollectionManager,
            collections,
            batchSize,
            useAuditDatabase,
            adminLogger
        }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger
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
        const accessCodes = doc.meta.security.filter(s => s.system === 'https://www.icanbwell.com/access').map(s => s.code);
        if (accessCodes.length > 0 && !doc['_access']) {
            const _access = {};
            for (const accessCode of accessCodes) {
                _access[`${accessCode}`] = 1;
            }
            // update only the necessary field in the document
            const setCommand = {};
            setCommand['_access'] = _access;
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
                const query = {};
                const projection = {
                    'id': 1,
                    'meta.security.system': 1,
                    'meta.security.code': 1,
                    '_access': 1
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
