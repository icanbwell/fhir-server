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
     * @param {boolean} dropDestinationIfCountIsDifferent
     * @param {AdminLogger} adminLogger
     * @param {boolean} useAggregationMethod
     * @param {IndexManager} indexManager
     */
    constructor({
                    mongoCollectionManager,
                    recordedAfter,
                    recordedBefore,
                    batchSize,
                    skipExistingIds,
                    useAuditDatabase,
                    dropDestinationIfCountIsDifferent,
                    adminLogger,
                    useAggregationMethod,
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
        this.dropDestinationIfCountIsDifferent = dropDestinationIfCountIsDifferent;

        /**
         * @type {boolean}
         */
        this.useAggregationMethod = useAggregationMethod;

        this.indexManager = indexManager;
        assertTypeEquals(indexManager, IndexManager);
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        const accessCodes = doc.meta.security.filter(s => s.system === 'https://www.icanbwell.com/access').map(s => s.code);
        if (accessCodes.length > 0 && !doc['_access']) {
            const _access = {};
            for (const accessCode of accessCodes) {
                _access[`${accessCode}`] = 1;
            }
            doc['_access'] = _access;
        }
        // delete _id so it does not cause a conflict in replace
        // e.g., 'Got error MongoBulkWriteError: After applying the update, the (immutable) field '_id' was found to have been altered to _id'
        delete doc._id;
        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        const result = {
            replaceOne: {
                filter: {id: doc.id},
                replacement: doc,
                upsert: true
            }
        };
        return [
            result
        ];
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
            while (recordedBeforeForLoop.isSameOrAfter(this.recordedAfter)) {

                this.startFromIdContainer.startFromId = '';
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
                    if (this.useAggregationMethod) {
                        /**
                         * @type {import('mongodb').MongoClient}
                         */
                        const client = await createClientAsync(config);
                        /**
                         * @type {import('mongodb').Db}
                         */
                        const db = client.db(config.db_name);
                        const pipeline = [
                            {
                                $match: query
                            },
                            {
                                $out: destinationCollectionName
                            }
                        ];
                        const destinationCollectionExists = await db.listCollections(
                            {name: destinationCollectionName},
                            {nameOnly: true}
                        ).hasNext();
                        if (destinationCollectionExists) {
                            this.adminLogger.log(`Destination ${destinationCollectionName} already exists so dropping it`);
                            await db.dropCollection(destinationCollectionName);
                        }
                        this.adminLogger.log(`Running aggregation pipeline with: ${JSON.stringify(pipeline)}`);
                        const sourceCollection = db.collection(sourceCollectionName);
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
                        this.adminLogger.logTrace(`[${moment().toISOString()}] ` +
                            `Sending count query to Mongo: ${mongoQueryStringify(query)}. ` +
                            `for ${sourceCollectionName} and ${destinationCollectionName}`);
                        const numberOfSourceDocuments = await sourceCollection.countDocuments(query, {});
                        const destinationCollection = db.collection(destinationCollectionName);
                        const numberOfDestinationDocuments = await destinationCollection.countDocuments({}, {});
                        this.adminLogger.log(`[${moment().toISOString()}] ` +
                            `Count in source matching query ${sourceCollectionName}: ${numberOfSourceDocuments.toLocaleString('en-US')}, ` +
                            `Count in destination ${destinationCollectionName}: ${numberOfDestinationDocuments.toLocaleString('en-US')}`);

                        // create indexes
                        this.adminLogger.log(`Creating indexes for ${destinationCollectionName}`);
                        await this.indexManager.indexCollectionAsync({
                            db,
                            collectionName: destinationCollectionName
                        });
                        this.adminLogger.log(`Finished creating indexes for ${destinationCollectionName}`);
                        await disconnectClientAsync(client);
                    } else {
                        await this.runForQueryBatchesAsync(
                            {
                                config: this.useAuditDatabase ? auditEventMongoConfig : mongoConfig,
                                sourceCollectionName,
                                destinationCollectionName,
                                query,
                                startFromIdContainer: this.startFromIdContainer,
                                fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                                ordered: false,
                                batchSize: this.batchSize,
                                skipExistingIds: this.skipExistingIds ? true : false,
                                skipWhenCountIsSame: true,
                                dropDestinationIfCountIsDifferent: this.dropDestinationIfCountIsDifferent
                            }
                        );
                    }
                } catch (e) {
                    console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
                }
                console.log(`Finished loop from ${recordedAfterForLoop.utc().toISOString()} till ${recordedBeforeForLoop.utc().toISOString()}`);

                recordedBeforeForLoop = recordedAfterForLoop.clone();
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
    PartitionAuditEventRunner
};
