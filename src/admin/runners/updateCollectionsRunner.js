const { assertTypeEquals } = require('../../utils/assertType');
const moment = require('moment-timezone');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../adminLogger');

/**
 * @classdesc Copies documents from one collection into the other collection in different clusters
 */
class UpdateCollectionsRunner {
    /**
     * Constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {moment.Moment} updatedAfter
     * @param {number} readBatchSize
     * @param {number} writeBatchSize
     * @param {Object|string|undefined} readOnlyCertainCollections
     * @param {Object|string|undefined} excludeCollection
     * @param {AdminLogger} adminLogger
     */
    constructor({
        mongoDatabaseManager,
        mongoCollectionManager,
        updatedAfter,
        readBatchSize,
        writeBatchSize,
        concurrentRunners,
        readOnlyCertainCollections,
        excludeCollection,
        adminLogger,
    }) {
        /**
         * @type {moment.Moment}
         */
        this.updatedAfter = updatedAfter;
        assertTypeEquals(updatedAfter, moment);

        /**
         * @type {number}
         */
        this.readBatchSize = readBatchSize;

        /**
         * @type {number}
         */
        this.writeBatchSize = writeBatchSize;

        /**
         * @type {number}
         */
        this.concurrentRunners = concurrentRunners;

        /**
         * @type {object|string|undefined}
         */
        this.readOnlyCertainCollections = readOnlyCertainCollections;

        /**
         * @type {object|string|undefined}
         */
        this.excludeCollection = excludeCollection;

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);
    }

    /**
     * @description Creates config for the target cluster using connection string
     * @returns {Object}
     */
    getTargetClusterConfig() {
        // const mongoUrl = encodeURI(`mongodb+srv://${env.MONGO_USERNAME}:${env.MONGO_PASSWORD}@`)
        // const db_name = "cl-dev-fhir-pl-0.vpsmx.mongodb.net"

        const mongoUrl = encodeURI('mongodb://localhost:27017/');
        const db_name = 'fhir';
        const options = {
            retryWrites: true,
            w: 'majority',
        };
        return { connection: mongoUrl, db_name: db_name, options: options };
    }

    /**
     * @description Creates config for the source cluster using connection string
     * @returns {Object}
     */
    getSourceClusterConfig() {
        // const mongoUrl = encodeURI(`mongodb+srv://${env.MONGO_USERNAME}:${env.MONGO_PASSWORD}`)
        // const db_name = "@cl-dev-fhir-v3-pl-0.vpsmx.mongodb.net"

        const mongoUrl = encodeURI('mongodb://localhost:27017/');
        const db_name = 'fhir_v3';
        const options = {
            retryWrites: true,
            w: 'majority',
        };
        return { connection: mongoUrl, db_name: db_name, options: options };
    }
    /**
     * Runs a loop to process all the documents.
     */
    async processAsync() {
        // Creating config specific to each cluster
        const targetClusterConfig = this.getTargetClusterConfig();
        const sourceClusterConfig = this.getSourceClusterConfig();
        let targetClient, sourceClient;

        try {
            // Creating a connection between the cluster and the application
            targetClient = await this.mongoDatabaseManager.createClientAsync(targetClusterConfig);
            sourceClient = await this.mongoDatabaseManager.createClientAsync(sourceClusterConfig);

            this.adminLogger.logInfo('Client connected successfully to both the clusters.');
            // Createing a new db instance for both the clusters
            const targetDatabase = targetClient.db(targetClusterConfig.db_name);
            const sourceDatabase = sourceClient.db(sourceClusterConfig.db_name);

            const sourceCollections = await this.mongoCollectionManager.getAllCollectionNames({
                db: sourceDatabase,
            });
            this.adminLogger.logInfo(
                `Total collections present in ${sourceClusterConfig.db_name}: ${sourceCollections.length}`
            );

            // Creating batches of collections depending on the concurrency parameter passed.
            let collectionNameBatches = [];
            let minimumCollectionsToRunTogether = Math.max(
                1,
                Math.floor(sourceCollections.length / this.concurrentRunners)
            );
            for (let i = 0; i < sourceCollections.length; i = i + minimumCollectionsToRunTogether) {
                collectionNameBatches.push(
                    sourceCollections.slice(i, i + minimumCollectionsToRunTogether)
                );
            }

            this.adminLogger.logInfo(
                `===== Total collection batches created: ${collectionNameBatches.length}`
            );
            const processingBatch = collectionNameBatches.map(async (collectionNameBatch) => {
                let results = {};
                for (const collection of collectionNameBatch) {
                    this.adminLogger.logInfo(`========= Iterating through ${collection} =========`);
                    let updatedCount = 0;
                    let skippedCount = 0;

                    if (
                        !this.readOnlyCertainCollections &&
                        this.excludeCollection &&
                        this.excludeCollection.includes(collection)
                    ) {
                        // As the collection is to be excluded we move to the next collection
                        this.adminLogger.logInfo(
                            `${collection} is being excluded from further data transfer`
                        );
                        continue;
                    }
                    if (
                        this.readOnlyCertainCollections &&
                        !this.readOnlyCertainCollections.includes(collection)
                    ) {
                        // As we need to iterate only a few collection we skip collections that are not present in the list.
                        this.adminLogger.logInfo(
                            `Omitting ${collection} as it is not present in the list of collections to be iterated`
                        );
                        continue;
                    }
                    const sourceDatabaseCollection = sourceDatabase.collection(collection);
                    const targetDatabaseCollection = targetDatabase.collection(collection);

                    // Projection is used so that we don't fetch _id. Thus preventing it from being updated while updating document.
                    // Returns a list of documents from sourceDatabaseCollection collection with specified batch size
                    const cursor = sourceDatabaseCollection
                        .find({}, { $sort: { _id: 1 } })
                        .batchSize(this.readBatchSize);
                    while (await cursor.hasNext()) {
                        const sourceDocument = await cursor.next();
                        // Fetching document from active db having same id.
                        const targetDocument = await targetDatabaseCollection.findOne({
                            _id: sourceDocument._id,
                        });
                        // Skip target/source documents in which lastUpdated is not present.
                        if (
                            targetDocument?.meta?.lastUpdated === undefined ||
                            sourceDocument?.meta?.lastUpdated === undefined
                        ) {
                            this.adminLogger.logInfo(
                                `Document in ${collection} with id:${sourceDocument.id} skipped as the targetDocument or sourceDocument is missing lastUpdated`
                            );
                            continue;
                        }
                        //  Active (Source)db lastUpdated <  this.updatedAfter and targetDatabase lastUpdate > fhirDb lastUpdate
                        if (
                            targetDocument &&
                            targetDocument.meta.lastUpdated <= this.updatedAfter &&
                            targetDocument.meta.lastUpdated > sourceDocument.meta.lastUpdated
                        ) {
                            // The document already exists in fhir and has been updated more recently than updatedAfter
                            this.adminLogger.logInfo(
                                `Document in ${collection} with id:${sourceDocument.id} found in target db but omitting as lastUpdated > ${this.updatedAfter}`
                            );
                            skippedCount++;
                            continue;
                        }
                        const result = await targetDatabaseCollection.updateOne(
                            { _id: sourceDocument._id },
                            {
                                $set: sourceDocument,
                            }
                        );
                        updatedCount += result.modifiedCount;
                    }
                    this.adminLogger.logInfo(
                        `===== For ${collection} total updated documents: ${updatedCount} and total documents skipped: ${skippedCount} `
                    );
                    results[collection] = {
                        updatedCount: updatedCount,
                        skippedCount: skippedCount,
                    };
                }
                return results;
            });
            const results = await Promise.all(processingBatch);
            const mergedObject = results.reduce((acc, obj) => Object.assign(acc, obj), {});
            this.adminLogger.logInfo(mergedObject);
        } catch (e) {
            this.adminLogger.logError(e);
        } finally {
            await this.mongoDatabaseManager.disconnectClientAsync(targetClient);
            await this.mongoDatabaseManager.disconnectClientAsync(sourceClient);
            this.adminLogger.logInfo('Closed connectinon for both the cluster');
            this.adminLogger.logInfo('Finished Script');
        }
    }
}

module.exports = {
    UpdateCollectionsRunner,
};
