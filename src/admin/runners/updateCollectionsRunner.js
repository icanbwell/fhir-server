const { assertTypeEquals } = require('../../utils/assertType');
const moment = require('moment-timezone');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../adminLogger');
const { ObjectId } = require('mongodb');
const env = require('var');

/**
 * @classdesc Copies documents from one collection into the other collection in different clusters
 */
class UpdateCollectionsRunner {
    /**
     * Constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {moment.Moment} updatedBefore
     * @param {number} readBatchSize
     * @param {Object|string|undefined} collections
     * @param {AdminLogger} adminLogger
     */
    constructor({
        mongoDatabaseManager,
        mongoCollectionManager,
        updatedBefore,
        readBatchSize,
        concurrentRunners,
        _idAbove,
        collections,
        adminLogger,
    }) {
        /**
         * @type {moment.Moment}
         */
        this.updatedBefore = updatedBefore;
        assertTypeEquals(updatedBefore, moment);

        /**
         * @type {number}
         */
        this.readBatchSize = readBatchSize;

        /**
         * @type {number}
         */
        this.concurrentRunners = concurrentRunners;

        /**
         * @type {string|undefined}
         */
        this._idAbove = _idAbove;

        /**
         * @type {object|string|undefined}
         */
        this.collections = collections;

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
        const mongoUrl = encodeURI(env.MONGO_URL);
        const db_name = env.TARGET_DB_NAME;
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
        const mongoUrl = encodeURI(env.MONGO_URL);
        const db_name = env.SOURCE_DB_NAME;
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
        // If idabove is to be used and but collections is not provided or collections contains multiple values return
        if (
            this._idAbove &&
            (!this.collections || this.collections.length > 1)
        ) {
            this.adminLogger.logError(
                'To support _idAbove provide a single collection name under collections param'
            );
            return;
        }

        // Creating config specific to each cluster
        const targetClusterConfig = this.getTargetClusterConfig();
        const sourceClusterConfig = this.getSourceClusterConfig();
        let targetClient, sourceClient;

        try {
            // Creating a connection between the cluster and the application
            targetClient = await this.mongoDatabaseManager.createClientAsync(targetClusterConfig);
            sourceClient = await this.mongoDatabaseManager.createClientAsync(sourceClusterConfig);

            this.adminLogger.logInfo('Client connected successfully to both the clusters.');
            // Creating a new db instance for both the clusters
            const targetDatabase = targetClient.db(targetClusterConfig.db_name);
            const sourceDatabase = sourceClient.db(sourceClusterConfig.db_name);

            // Fetch all the collection names for the source database.
            const sourceCollections = await this.mongoCollectionManager.getAllCollectionNames({
                db: sourceDatabase,
            });
            this.adminLogger.logInfo(
                `Total collections present in ${sourceClusterConfig.db_name}: ${sourceCollections.length}`
            );

            // Creating batches of collections depending on the concurrency parameter passed.
            let collectionNameBatches = [];
            // Dpending on concurrentRunners provided we eill batch collections in equivalent groups.
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

            // Process each collection batch in parallel
            const processingBatch = collectionNameBatches.map(async (collectionNameBatch) => {
                let results = {};
                for (const collection of collectionNameBatch) {
                    this.adminLogger.logInfo(`========= Iterating through ${collection} =========`);
                    let updatedCount = 0; // Keeps track of the total updated documents
                    let skippedCount = 0; // Keeps track of documents that are skipped as they don't match the requirements.
                    let lastProcessedId = null; // For each collect help in keeping track of the last id processed.
                    let totalDocumentsFound = 0; // For each collection in source db counts the total document that has been visited.

                    if (
                        this.collections &&
                        !this.collections.includes(collection)
                    ) {
                        // As we need to iterate only a few collection we skip collections that are not present in the list.
                        this.adminLogger.logInfo(
                            `Omitting ${collection} as it is not present in the list of collections to be iterated`
                        );
                        continue;
                    }
                    // Fetching the collection from the database for both source and target
                    const sourceDatabaseCollection = sourceDatabase.collection(collection);
                    const targetDatabaseCollection = targetDatabase.collection(collection);

                    // Cursor options. As we are also provide _idAbove we need to get results in sorted manner
                    const cursorOptions = {
                        batchSize: this.readBatchSize,
                        sort: { _id: 1 },
                    };

                    // If _idAbove is provided fetch all documents having _id greater than this._idAbove
                    const query = this._idAbove ? { _id: { $gt: new ObjectId(this._idAbove) } } : {};

                    // Projection is used so that we don't fetch _id. Thus preventing it from being updated while updating document.
                    // Returns a list of documents from sourceDatabaseCollection collection with specified batch size
                    const cursor = sourceDatabaseCollection.find(query, cursorOptions);
                    while (await cursor.hasNext()) {
                        let result;
                        const sourceDocument = await cursor.next();
                        totalDocumentsFound += 1;
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
                        if( !(targetDocument.meta.lastUpdated instanceof Date)) {
                            targetDocument.meta.lastUpdated = moment(targetDocument.meta.lastUpdated).format("YYYY-MM-DDTHH:mm:ss.SSSZ")
                        }
                        if( !(sourceDocument.meta.lastUpdated instanceof Date)) {
                            sourceDocument.meta.lastUpdated = moment(targetDocument.meta.lastUpdated).format("YYYY-MM-DDTHH:mm:ss.SSSZ")
                        }
                        if (
                            targetDocument &&
                            targetDocument.meta.lastUpdated < this.updatedBefore &&
                            targetDocument.meta.lastUpdated < sourceDocument.meta.lastUpdated
                        ) {
                            // Updating the document in targetDatabase.
                            result = await targetDatabaseCollection.updateOne(
                                { _id: sourceDocument._id },
                                {
                                    $set: sourceDocument,
                                }
                            );
                        } else {
                            // The document already exists in fhir and has been updated more recently than updatedBefore
                            this.adminLogger.logInfo(
                                `Document in ${collection} with id:${sourceDocument.id} found in target db but omitting as lastUpdated > ${this.updatedBefore}`
                            );
                            skippedCount++;
                            continue;
                        }

                        // Keeping track of the last updated id
                        lastProcessedId = sourceDocument._id;
                        updatedCount += result.modifiedCount;
                    }
                    this.adminLogger.logInfo(
                        `===== For ${collection} total updated documents: ${updatedCount} and total documents skipped: ${skippedCount} `
                    );
                    // eslint-disable-next-line security/detect-object-injection
                    results[collection] = {
                        updatedCount: updatedCount,
                        skippedCount: skippedCount,
                        lastProcessedId: lastProcessedId,
                        totalDocumentsFound: totalDocumentsFound
                    };
                }
                return results;
            });

            const results = await Promise.all(processingBatch);
            // Creating an object that logs the collection name, total updated, skipped and lastUpdatedId for the document
            const mergedObject = results.reduce((acc, obj) => Object.assign(acc, obj), {});
            this.adminLogger.logInfo(mergedObject);
        } catch (e) {
            this.adminLogger.logError(`Error: ${e}`);
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
