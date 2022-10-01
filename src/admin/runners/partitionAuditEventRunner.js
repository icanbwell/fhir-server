const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {YearMonthPartitioner} = require('../../partitioners/yearMonthPartitioner');
const moment = require('moment-timezone');
const {auditEventMongoConfig, mongoConfig} = require('../../config');

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
     */
    constructor({
                    mongoCollectionManager,
                    recordedAfter,
                    recordedBefore,
                    batchSize,
                    skipExistingIds,
                    useAuditDatabase,
                    dropDestinationIfCountIsDifferent,
                    adminLogger
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

        this.batchSize = batchSize;
        this.skipExistingIds = skipExistingIds;

        this.useAuditDatabase = useAuditDatabase;

        this.dropDestinationIfCountIsDifferent = dropDestinationIfCountIsDifferent;
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
                            skipExistingIds: this.skipExistingIds,
                            skipWhenCountIsSame: true,
                            dropDestinationIfCountIsDifferent: this.dropDestinationIfCountIsDifferent
                        }
                    );
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
