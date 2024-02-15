const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

/**
 * @classdesc runs preSave() on every record
 */
class RunPreSaveRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {date|undefined} afterLastUpdatedDate
     * @param {date|undefined} beforeLastUpdatedDate
     * @param {boolean} useAuditDatabase
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {PreSaveManager} preSaveManager
     * @param {boolean|undefined} [includeHistoryCollections]
     * @param {string|undefined} [startFromCollection]
     * @param {number|undefined} [limit]
     */
    constructor (
        {
            mongoCollectionManager,
            collections,
            batchSize,
            afterLastUpdatedDate,
            beforeLastUpdatedDate,
            useAuditDatabase,
            adminLogger,
            mongoDatabaseManager,
            preSaveManager,
            includeHistoryCollections,
            startFromCollection,
            limit
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
         * @type {date|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {date|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**
         * @type {boolean}
         */
        this.useAuditDatabase = useAuditDatabase;

        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {boolean}
         */
        this.includeHistoryCollections = includeHistoryCollections;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;
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
        assertIsValid(doc.resourceType);
        /**
         * @type {Resource}
         */
        const currentResource = FhirResourceCreator.create(doc);
        /**
         * @type {Resource}
         */
        const updatedResource = await this.preSaveManager.preSaveAsync(currentResource.clone());
        // for speed, first check if the incoming resource is exactly the same
        const updatedResourceJsonInternal = updatedResource.toJSONInternal();
        const currentResourceJsonInternal = currentResource.toJSONInternal();
        if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
            // console.log('No change detected for ');
            return operations;
        }

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        // batch up the calls to update
        updatedResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
        const result = { replaceOne: { filter: { _id: doc._id }, replacement: updatedResource.toJSONInternal() } };
        operations.push(result);
        // console.log(`Operation: ${JSON.stringify(result)}`);
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
                /**
                 * @type {string[]}
                 */
                this.collections = (await this.getAllCollectionNamesAsync(
                        {
                            useAuditDatabase: this.useAuditDatabase,
                            includeHistoryCollections: this.includeHistoryCollections
                        }
                    )
                );
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(c => c >= this.startFromCollection);
                }
            }

            await this.init();

            console.log(`Starting loop for ${this.collections.join(',')}`);

            // if there is an exception, continue processing from the last id
            for (const collectionName of this.collections) {
                this.startFromIdContainer.startFromId = '';
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                let query = { _sourceAssigningAuthority: { $not: { $type: 'string' } } };
                if (this.beforeLastUpdatedDate && this.afterLastUpdatedDate) {
                    query = {
                        'meta.lastUpdated': {
                            $lt: this.beforeLastUpdatedDate,
                            $gt: this.afterLastUpdatedDate
                        }
                    };
                } else if (this.beforeLastUpdatedDate) {
                    query = {
                        'meta.lastUpdated': {
                            $lt: this.beforeLastUpdatedDate
                        }
                    };
                } else if (this.afterLastUpdatedDate) {
                    query = {
                        'meta.lastUpdated': {
                            $gt: this.afterLastUpdatedDate
                        }
                    };
                }
                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: this.useAuditDatabase ?
                                await this.mongoDatabaseManager.getAuditConfigAsync() :
                                await this.mongoDatabaseManager.getClientConfigAsync(),
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit
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
    RunPreSaveRunner
};
