const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { generateUUID } = require('../../utils/uid.util');
const { filterJsonByKeys } = require('../../utils/object');
/**
 * @classdesc migrate Binary History data to S3, adding link in original document
 */
class MigrateBinaryHistoryToS3RunnerRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string} collectionName,
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {number|undefined} limit
     * @param {boolean|undefined} useTransaction
     * @param {number|undefined} skip
     * @param {string|undefined} startFromId
     * @param {CloudStorageClient | null} historyResourceCloudStorageClient
     */
    constructor (
        {
            mongoCollectionManager,
            mongoDatabaseManager,
            collectionName,
            batchSize,
            adminLogger,
            limit,
            useTransaction,
            skip,
            startFromId,
            historyResourceCloudStorageClient
        }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });

        /**
         * @type {string}
         */
        this.collectionName = collectionName;

        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;

        /**
         * @type {CloudStorageClient | null}
         */
        this.historyResourceCloudStorageClient = historyResourceCloudStorageClient;
        if (historyResourceCloudStorageClient) {
            assertTypeEquals(historyResourceCloudStorageClient, CloudStorageClient);
        }
      }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        const operations = [];
        const history_doc = FhirResourceCreator.create(doc);
        let history_doc_json = history_doc.toJSONInternal()
        const file_path = `${this.collectionName}/${generateUUID()}.json`;

        // filter only required fields to be saved in MongoDB
        history_doc_json = filterJsonByKeys(
            history_doc_json,
            this.configManager.historyResourceMongodbFields
        );
        history_doc_json['_fullObjPath'] = this.historyResourceCloudStorageClient.getPublicFilePath(file_path);
        operations.push({
            replaceOne: {
                filter: {
                    _id: doc._id
                },
                replacement: history_doc_json
            }
        });
        // TODO: updload doc to S3
        return operations;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
            const mongoConfig = await this.mongoDatabaseManager.getResourceHistoryConfigAsync();
            const { db, client, session } = await this.createSingeConnectionAsync({
                mongoConfig
            });
            try {
                const collection = db.collection(this.collectionName);

                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */

                const query = {_fullObjPath: {$exists: false}};
                try {
                    await this.runForQueryBatchesAsync(
                        {
                            config: await this.mongoDatabaseManager.getClientConfigAsync(),
                            query,
                            projection: undefined,
                            startFromIdContainer: this.startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                            batchSize: this.batchSize,
                            skipExistingIds: false
                        }
                    );
                } catch (e) {
                    console.error(e);
                    console.log(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
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
    MigrateBinaryHistoryToS3Runner
};
