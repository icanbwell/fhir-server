// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const {BaseBulkOperationRunner} = require('./baseBulkOperationRunner');
const {createContainer} = require('../../createContainer');
const {assertTypeEquals} = require('../../utils/assertType');
const {CommandLineParser} = require('./commandLineParser');
const {YearMonthPartitioner} = require('../../partitioners/yearMonthPartitioner');
const moment = require('moment-timezone');
const {auditEventMongoConfig} = require('../../config');

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
     */
    constructor({
                    mongoCollectionManager,
                    recordedAfter,
                    recordedBefore,
                    batchSize,
                    skipExistingIds
                }) {
        super({mongoCollectionManager, batchSize});
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
                            config: auditEventMongoConfig,
                            sourceCollectionName,
                            destinationCollectionName,
                            query,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: this.skipExistingIds,
                            skipWhenCountIsSame: true
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

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    let currentDateTime = new Date();
    const recordedAfter = parameters.from ? new Date(`${parameters.from}T00:00:00Z`) : new Date(2021, 6 - 1, 1);
    const recordedBefore = parameters.to ? new Date(`${parameters.to}T00:00:00Z`) : new Date(2022, 10 - 1, 1);
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    console.log(`[${currentDateTime}] ` +
        `Running script from ${recordedAfter.toUTCString()} to ${recordedBefore.toUTCString()}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('processAuditEventRunner', (c) => new PartitionAuditEventRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                recordedAfter: moment.utc(recordedAfter),
                recordedBefore: moment.utc(recordedBefore),
                batchSize,
                skipExistingIds: parameters.skipExistingIds ? true : false
            }
        )
    );

    /**
     * @type {PartitionAuditEventRunner}
     */
    const processAuditEventRunner = container.processAuditEventRunner;
    await processAuditEventRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 16.17.0
 * node src/admin/scripts/partitionAuditEvent.js --from=2022-08-01 --to=2022-09-01 --batchSize=10000 --skipExistingIds
 */
main().catch(reason => {
    console.error(reason);
});
