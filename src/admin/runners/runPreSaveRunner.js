const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const deepEqual = require('fast-deep-equal');
const {getResource} = require('../../operations/common/getResource');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');

/**
 * @classdesc Copies documents from source collection into the appropriate partitioned collection
 */
class RunPreSaveRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {boolean} useAuditDatabase
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {PreSaveManager} preSaveManager
     */
    constructor(
        {
            mongoCollectionManager,
            collections,
            batchSize,
            useAuditDatabase,
            adminLogger,
            mongoDatabaseManager,
            preSaveManager
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
        if (!doc.meta || !doc.meta.security) {
            return operations;
        }
        assertIsValid(doc.resourceType);
        const ResourceCreator = getResource(VERSIONS['4_0_0'], doc.resourceType);
        /**
         * @type {Resource}
         */
        const currentResource = new ResourceCreator(doc);
        /**
         * @type {Resource}
         */
        const updatedResource = await this.preSaveManager.preSaveAsync(currentResource.clone());
        // for speed, first check if the incoming resource is exactly the same
        if (deepEqual(updatedResource.toJSONInternal(), currentResource.toJSONInternal()) === true) {
            return operations;
        }

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
            // batch up the calls to update
        const result = {replaceOne: {filter: {_id: doc._id}, replacement: updatedResource.toJSONInternal()}};
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
                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: this.useAuditDatabase ? this.mongoDatabaseManager.getAuditConfig() : this.mongoDatabaseManager.getClientConfig(),
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
    RunPreSaveRunner
};
