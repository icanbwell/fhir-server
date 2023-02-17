const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');

/**
 * @classdesc runs preSave() on every record
 */
class FixHistoryRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {PreSaveManager} preSaveManager
     */
    constructor(
        {
            mongoCollectionManager,
            collections,
            batchSize,
            adminLogger,
            mongoDatabaseManager,
            preSaveManager,
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

        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        const operations = [];
        if (!doc.resource) {
            doc = {
                _id: doc._id,
                id: doc.id,
                resource: doc
            };
            delete doc.resource._id;
        }
        const result = {replaceOne: {filter: {_id: doc._id}, replacement: doc}};

        operations.push(result);
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
                /**
                 * @type {string[]}
                 */
                this.collections = (await this.getAllCollectionNamesAsync(
                        {
                            useAuditDatabase: false,
                            includeHistoryCollections: true
                        }
                    )
                );
                // filter to only history collections
                this.collections = this.collections.filter(c => c.includes('_History'));
                this.collections = this.collections.sort();
            }

            await this.init();

            console.log(`Starting loop for ${this.collections.join(',')}`);

            // if there is an exception, continue processing from the last id
            for (const collectionName of this.collections) {

                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */


                const query = {resource: null};
                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: await this.mongoDatabaseManager.getClientConfigAsync(),
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false
                        }
                    );
                } catch (e) {
                    console.error(e);
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
    FixHistoryRunner
};
