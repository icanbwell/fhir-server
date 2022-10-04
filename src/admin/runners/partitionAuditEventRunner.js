const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {YearMonthPartitioner} = require('../../partitioners/yearMonthPartitioner');
const moment = require('moment-timezone');
const {auditEventMongoConfig, mongoConfig} = require('../../config');
const {createClientAsync, disconnectClientAsync} = require('../../utils/connect');
const {mongoQueryStringify} = require('../../utils/mongoQueryStringify');
const {IndexManager} = require('../../indexes/indexManager');

/**
 * @classdesc Copies documents from source collection into the appropriate partitioned collection
 */
class PartitionAuditEventRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {moment.Moment} recordedAfter
     * @param {moment.Moment} recordedBefore
     * @param {number} batchSize
     * @param {boolean} skipExistingIds
     * @param {boolean} useAuditDatabase
     * @param {boolean} dropDestinationCollection
     * @param {AdminLogger} adminLogger
     * @param {IndexManager} indexManager
     */
    constructor({
                    mongoCollectionManager,
                    recordedAfter,
                    recordedBefore,
                    batchSize,
                    skipExistingIds,
                    useAuditDatabase,
                    dropDestinationCollection,
                    adminLogger,
                    indexManager
                }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger
        });
        /**
         * @type {moment.Moment}
         */
        this.recordedAfter = recordedAfter;
        assertTypeEquals(recordedAfter, moment);
        /**
         * @type {moment.Moment}
         */
        this.recordedBefore = recordedBefore;
        assertTypeEquals(recordedBefore, moment);

        /**
         * @type {number}
         */
        this.batchSize = batchSize;
        /**
         * @type {boolean}
         */
        this.skipExistingIds = skipExistingIds;

        /**
         * @type {boolean}
         */
        this.useAuditDatabase = useAuditDatabase;

        /**
         * @type {boolean}
         */
        this.dropDestinationCollection = dropDestinationCollection;

        this.indexManager = indexManager;
        assertTypeEquals(indexManager, IndexManager);
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async copyRecordAsync(doc) {
        const operations = [];
        const accessCodes = doc.meta.security.filter(s => s.system === 'https://www.icanbwell.com/access').map(s => s.code);

        if (accessCodes.length > 0 && !doc['_access']) {
            const _access = {};
            for (const accessCode of accessCodes) {
                _access[`${accessCode}`] = 1;
            }
            doc['_access'] = _access;
        }
        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        const result = {
            replaceOne: {
                filter: {_id: doc._id},
                replacement: doc,
                upsert: true
            }
        };
        operations.push(result);

        return operations;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async setAccessIndexRecordAsync(doc) {
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
        const sourceCollectionName = 'AuditEvent_4_0_0';
        try {
            await this.init();

            console.log(`Starting loop from ${this.recordedAfter.utc().toISOString()} till ${this.recordedBefore.utc().toISOString()}`);
            /**
             * @type {moment.Moment}
             */
            let recordedBeforeForLoop = this.recordedBefore.clone().utc().startOf('month');

            // if there is an exception, continue processing from the last id
            while (recordedBeforeForLoop.isAfter(this.recordedAfter)) {
                this.startFromIdContainer = this.createStartFromIdContainer();
                /**
                 * @type {moment.Moment}
                 */
                const recordedAfterForLoop = recordedBeforeForLoop.clone().utc().subtract(1, 'month').startOf('month');

                if (recordedAfterForLoop.isSame(recordedBeforeForLoop)) {
                    break;
                }
                console.log(`From=${recordedAfterForLoop.utc().toISOString()} to=${recordedBeforeForLoop.utc().toISOString()}`);
                const destinationCollectionName = YearMonthPartitioner.getPartitionNameFromYearMonth({
                    fieldValue: recordedAfterForLoop.utc().toISOString(),
                    resourceWithBaseVersion: sourceCollectionName
                });
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                const query = {
                    $and: [
                        {'recorded': {$gt: recordedAfterForLoop.utc().toDate()}},
                        {'recorded': {$lt: recordedBeforeForLoop.utc().toDate()}}
                    ]
                };
                try {
                    const config = this.useAuditDatabase ? auditEventMongoConfig : mongoConfig;
                    /**
                     * @type {import('mongodb').MongoClient}
                     */
                    const client = await createClientAsync(config);
                    /**
                     * @type {import('mongodb').Db}
                     */
                    const db = client.db(config.db_name);
                    let destinationCollectionExists = await db.listCollections(
                        {name: destinationCollectionName},
                        {nameOnly: true}
                    ).hasNext();
                    if (this.dropDestinationCollection) {
                        if (destinationCollectionExists) {
                            this.adminLogger.log(`Destination ${destinationCollectionName} already exists so dropping it`);
                            await db.dropCollection(destinationCollectionName);
                        }
                        destinationCollectionExists = false;
                    }
                    const pipeline = destinationCollectionExists ? [
                        {
                            $match: query
                        },
                        {
                            $merge: {
                                'into': destinationCollectionName,
                                'on': '_id',
                                whenMatched: 'keepExisting',
                                whenNotMatched: 'insert'
                            }
                        }
                    ] : [ // copy is more efficient if destination collection does not exist
                        {
                            $match: query
                        },
                        {
                            $out: destinationCollectionName
                        }
                    ];
                    this.adminLogger.log(`Running aggregation pipeline with: ${JSON.stringify(pipeline)}`);
                    const sourceCollection = db.collection(sourceCollectionName);
                    this.adminLogger.logTrace(
                        `Sending count query to Mongo: ${mongoQueryStringify(query)}. ` +
                        `for ${sourceCollectionName} and ${destinationCollectionName}`);
                    const numberOfSourceDocuments = await sourceCollection.countDocuments(query, {});
                    if (numberOfSourceDocuments > 0) {
                        // https://www.mongodb.com/docs/manual/reference/operator/aggregation/out/
                        const aggregationResult = await sourceCollection.aggregate(
                            pipeline,
                            {
                                allowDiskUse: true // sorting can be expensive
                            }
                        );
                        /**
                         * @type {import('mongodb').Document[]}
                         */
                        const documents = await aggregationResult.toArray();
                        this.adminLogger.log(`Aggregation Result=${JSON.stringify(documents)}`);

                        // get the count
                        this.adminLogger.logTrace(
                            `Sending count query to Mongo: ${mongoQueryStringify(query)}. ` +
                            `for ${sourceCollectionName} and ${destinationCollectionName}`);
                        const destinationCollection = db.collection(destinationCollectionName);
                        const numberOfDestinationDocuments = await destinationCollection.countDocuments({}, {});
                        this.adminLogger.log(
                            `Count in source matching query ${sourceCollectionName}: ${numberOfSourceDocuments.toLocaleString('en-US')}, ` +
                            `Count in destination ${destinationCollectionName}: ${numberOfDestinationDocuments.toLocaleString('en-US')}`);
                        if (numberOfSourceDocuments === numberOfDestinationDocuments) {
                            this.adminLogger.log(`======= COUNT MATCHED ${sourceCollectionName} vs ${destinationCollectionName} ======`);
                        } else {
                            this.adminLogger.logError(`======= ERROR: COUNT NOT MATCHED ${sourceCollectionName} vs ${destinationCollectionName} ======`);
                        }
                        // create indexes
                        this.adminLogger.log(`Creating indexes for ${destinationCollectionName}`);
                        await this.indexManager.indexCollectionAsync({
                            db,
                            collectionName: destinationCollectionName
                        });
                        this.adminLogger.log(`Finished creating indexes for ${destinationCollectionName}`);

                        // now update the _accessIndex
                        this.adminLogger.log(`Updating _access fields for ${destinationCollectionName}`);

                        await this.runForQueryBatchesAsync(
                            {
                                config: this.useAuditDatabase ? auditEventMongoConfig : mongoConfig,
                                sourceCollectionName: destinationCollectionName,
                                destinationCollectionName,
                                query: {
                                    _access: null
                                }, // update all records in destination collection that don't have an _access index
                                startFromIdContainer: this.startFromIdContainer,
                                fnCreateBulkOperationAsync: async (doc) => await this.setAccessIndexRecordAsync(doc),
                                ordered: false,
                                batchSize: this.batchSize,
                                skipExistingIds: false,
                                skipWhenCountIsSame: false,
                                dropDestinationIfCountIsDifferent: false
                            }
                        );
                        this.adminLogger.log(`Finished Updating _access fields for ${destinationCollectionName}`);
                    } else {
                        this.adminLogger.log(`No documents matched in  ${sourceCollectionName}`);
                    }
                    await disconnectClientAsync(client);

                } catch (e) {
                    this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                }
                this.adminLogger.log(`Finished loop from ${recordedAfterForLoop.utc().toISOString()} till ${recordedBeforeForLoop.utc().toISOString()}\n\n`);

                recordedBeforeForLoop = recordedAfterForLoop.clone();
            }
            this.adminLogger.log('Finished script');
            this.adminLogger.log('Shutting down');
            await this.shutdown();
            this.adminLogger.log('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    PartitionAuditEventRunner
};
