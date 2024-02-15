const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const deepEqual = require('fast-deep-equal');
// const moment = require('moment-timezone');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { fixMultipleAuthorities } = require('../utils/fixMultipleSourceAssigningAuthority');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

/**
 * @classdesc runs preSave() on every record
 */
class FixMultipleSourceAssigningAuthorityRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {date|undefined} beforeLastUpdatedDate
     * @param {boolean} useAuditDatabase
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {PreSaveManager} preSaveManager
     * @param {boolean|undefined} [includeHistoryCollections]
     * @param {boolean|undefined} fixMultipleOwners
     * @param {boolean|undefined} filterRecords
     * @param {string|undefined} [startFromCollection]
     * @param {number|undefined} [limit]
     * * @param {number|undefined} [skip]
     */
    constructor (
        {
            mongoCollectionManager,
            collections,
            batchSize,
            beforeLastUpdatedDate,
            useAuditDatabase,
            adminLogger,
            mongoDatabaseManager,
            preSaveManager,
            includeHistoryCollections,
            fixMultipleOwners,
            filterRecords,
            startFromCollection,
            limit,
            skip
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
         * @type {boolean}
         * @type {boolean|undefined}
         */
        this.fixMultipleOwners = fixMultipleOwners;

        /**
         * @type {boolean}
         * @type {boolean|undefined}
         */
        this.filterRecords = filterRecords;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;
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
        let resource = currentResource.clone();
        resource = fixMultipleAuthorities(resource, this.fixMultipleOwners);
        /**
         * @type {Resource}
         */
        const updatedResource = await this.preSaveManager.preSaveAsync(resource);
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
        // updatedResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
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

                const query = this.beforeLastUpdatedDate ? {
                    'meta.lastUpdated': {
                        $lt: this.beforeLastUpdatedDate
                    }
                } : {};

                let idList = [];
                if (this.filterRecords) {
                    // Get ids of documents that have multiple sourceAssigningAuthority.
                    const db = await this.mongoDatabaseManager.getClientDbAsync();
                    const dbCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync({
                        db,
                        collectionName
                    });
                    const result = await dbCollection.aggregate([
                        {
                            '$unwind': {
                                'path': '$meta.security'
                            }
                        },
                        {
                            '$match': {
                                'meta.security.system': `${SecurityTagSystem.sourceAssigningAuthority}`
                            }
                        },
                        {
                            '$group': {
                                _id: '$_id',
                                count: { $count: {} }
                            }
                        },
                        {
                            '$match': {
                                'count': {
                                    $gte: 2
                                }
                            }
                        },
                        {
                            $project: { array: true }
                        }
                    ], { allowDiskUse: true }).toArray();

                    idList = result.map(obj => obj._id);
                }

                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: this.useAuditDatabase
                                ? await this.mongoDatabaseManager.getAuditConfigAsync()
                                : await this.mongoDatabaseManager.getClientConfigAsync(),
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            projection: undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            skip: this.skip,
                            filterToIdProperty: '_id',
                            filterToIds: this.filterRecords ? idList : undefined
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
    FixMultipleSourceAssigningAuthorityRunner
};
