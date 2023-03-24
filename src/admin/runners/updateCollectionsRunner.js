const { assertTypeEquals } = require('../../utils/assertType');
const moment = require('moment-timezone');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../adminLogger');
const { ObjectId } = require('mongodb');

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
        startWithCollection,
        skipHistoryCollections,
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
         * @type {string|undefined}
         */
        this.collections = collections;

        /**
         * @type {object|string|undefined}
         */
        this.startWithCollection = startWithCollection;

        /**
         * @type {boolean}
         */
        this.skipHistoryCollections = skipHistoryCollections;

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
        const mongoUrl = encodeURI(`mongodb+srv://${process.env.TARGET_CLUSTER_USERNAME}:${process.env.TARGET_CLUSTER_PASSWORD}@${process.env.TARGET_CLUSTER_MONGO_URL}`);
        const db_name = process.env.TARGET_DB_NAME;
        this.adminLogger.logInfo(
            `Connecting to target cluster with mongo url: ${process.env.TARGET_CLUSTER_MONGO_URL} and db_name: ${db_name}`
        );
        const options = {
            readPreference: 'secondaryPreferred',
            // https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/connection-options/
            retryWrites: true,
            w: 'majority',
            connectTimeoutMS: 0,
            maxIdleTimeMS: 0,
            serverSelectionTimeoutMS: 600000 // Wait for 60 seconds before server selection is complete.
        };
        return { connection: mongoUrl, db_name: db_name, options: options };
    }

    /**
     * @description Creates config for the source cluster using connection string
     * @returns {Object}
     */
    getSourceClusterConfig() {
        const mongoUrl = encodeURI(`mongodb+srv://${process.env.SOURCE_CLUSTER_USERNAME}:${process.env.SOURCE_CLUSTER_PASSWORD}@${process.env.SOURCE_CLUSTER_MONGO_URL}`);
        const db_name = process.env.SOURCE_DB_NAME;
        this.adminLogger.logInfo(
            `Connecting to target cluster with mongo url: ${process.env.SOURCE_CLUSTER_MONGO_URL} and db_name: ${db_name}`
        );
        const options = {
            readPreference: 'secondaryPreferred',
            // https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/connection-options/
            connectTimeoutMS: 0,
            maxIdleTimeMS: 0,
            serverSelectionTimeoutMS: 600000 // Wait for 60 seconds before server selection is complete.
        };
        return { connection: mongoUrl, db_name: db_name, options: options };
    }

    /**
     * @description given an array of collection filters out only the required ones.
     * @param {Array} collectionList
     * @return {Array}
     */
    getListOfCollections(collectionList) {
        let collectionNames = [];
        for (const collection of collectionList) {
            // If the collection of type view, we can skip it
            if (collection.type !== 'collection') {
                continue;
            }
            // If the list of collection is mentioned verify the collection name is in the list of collections passed
            if (this.collections && !this.collections.includes(collection.name)) {
                continue;
            }
            // If history collections are to be skipped
            if (this.skipHistoryCollections && collection.name.endsWith('_History')) {
                continue;
            }
            collectionNames.push(collection.name);
        }
        return collectionNames;
    }

    /**
     * Runs a loop to process all the documents.
     */
    async processAsync() {
        // If idabove is to be used and but collections is not provided or collections contains multiple values return
        if (this._idAbove && (!this.collections || this.collections.length > 1)) {
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
            // Creating a connection between the target cluster and the application
            targetClient = await this.mongoDatabaseManager.createClientAsync(targetClusterConfig);

            // Creating a connection between the target cluster and the application
            sourceClient = await this.mongoDatabaseManager.createClientAsync(sourceClusterConfig);

            this.adminLogger.logInfo('Client connected successfully to both the clusters.');
            // Creating a new db instance for both the clusters
            const targetDatabase = targetClient.db(targetClusterConfig.db_name);
            const sourceDatabase = sourceClient.db(sourceClusterConfig.db_name);

            // Fetch all the collection names for the source database.
            let sourceCollectionAndViews = await sourceDatabase.listCollections().toArray();

            let sourceCollections = this.getListOfCollections(sourceCollectionAndViews);
            sourceCollections.sort();
            if (this.startWithCollection) {
                const indexToSplice = sourceCollections.indexOf(this.startWithCollection) !== -1 ? sourceCollections.indexOf(this.startWithCollection) : 0;
                sourceCollections = sourceCollections.splice(indexToSplice);
            }
            this.adminLogger.logInfo(`The list of collections are:  ${sourceCollections}`);

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
                    let sourceMissingLastUpdated = 0; // Keeps tranch of source document that doesn't have lastUpdated.
                    let targetMissingLastUpdated = 0; // Keeps track of target document that doesn't have last updated.
                    let totalProcessedDoc = 0; // Keep tracks of the total processed id.
                    let targetLastUpdatedGreaterThanUpdatedBefore = 0; // Keeps tracks of the documnet that is skipped and target last update is greater than updated before.
                    let targetLastUpdatedGreaterThanSource = 0; // Keeps tracks of the documents that is skipped and target last update is greater tha source last update

                    // Fetching the collection from the database for both source and target
                    const sourceDatabaseCollection = sourceDatabase.collection(collection);
                    const targetDatabaseCollection = targetDatabase.collection(collection);

                    const totalTargetDocuments = await targetDatabaseCollection.countDocuments();
                    const totalSourceDocuments = await sourceDatabaseCollection.countDocuments();
                    const sourceDocumentsMissingLastUpdated = await sourceDatabaseCollection.find({'meta.lastUpdated': { $exists: false}}).count();

                    this.adminLogger.logInfo(
                        `For ${collection} the total documents in target collection: ${totalTargetDocuments} and source collection: ${totalSourceDocuments}`
                    );

                    // Cursor options. As we are also provide _idAbove we need to get results in sorted manner
                    const cursorOptions = {
                        batchSize: this.readBatchSize,
                        sort: { _id: 1 },
                    };

                    // If _idAbove is provided fetch all documents having _id greater than this._idAbove or fetch all documents that have a value for lastUpdated.
                    const query = this._idAbove ? { _id: { $gt: new ObjectId(this._idAbove) } } : {'meta.lastUpdated': { $exists: true}};

                    // Projection is used so that we don't fetch _id. Thus preventing it from being updated while updating document.
                    // Returns a list of documents from sourceDatabaseCollection collection with specified batch size
                    const cursor = sourceDatabaseCollection.find(query, cursorOptions);
                    while (await cursor.hasNext()) {
                        let result;
                        totalProcessedDoc += 1;
                        const sourceDocument = await cursor.next();

                        // Fetching document from active db having same id.
                        const targetDocument = await targetDatabaseCollection.findOne({
                            _id: sourceDocument._id,
                        });
                        // Skip target documents in which lastUpdated is not present.
                        if (targetDocument?.meta?.lastUpdated === undefined) {
                            targetMissingLastUpdated += 1;
                            continue;
                        }

                        // Storing the mast updated for target and source in a variable. and updating it if required
                        let targetLastUpdated = targetDocument.meta.lastUpdated;
                        let sourceLastUpdated = sourceDocument.meta.lastUpdated;

                        if (!(targetLastUpdated instanceof Date)) {
                            targetLastUpdated =
                                moment(targetLastUpdated).format('YYYY-MM-DDTHH:mm:ssZ');
                        }
                        if (!(sourceLastUpdated instanceof Date)) {
                            sourceLastUpdated =
                                moment(sourceLastUpdated).format('YYYY-MM-DDTHH:mm:ssZ');
                        }

                        if (targetLastUpdated > this.updatedBefore) {
                            targetLastUpdatedGreaterThanUpdatedBefore += 1;
                            continue;
                        } else if ( targetLastUpdated > sourceLastUpdated ) {
                            targetLastUpdatedGreaterThanSource += 1;
                            continue;
                        }

                        try {
                            if (
                                targetDocument &&
                                targetLastUpdated < this.updatedBefore &&
                                targetLastUpdated < sourceLastUpdated
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
                                skippedCount++;
                                continue;
                            }

                            // Keeping track of the last updated id
                            lastProcessedId = sourceDocument._id;
                            updatedCount += result.modifiedCount;
                        } catch (error) {
                            this.adminLogger.logError(
                                `Error while updating document with id ${targetDocument._id}. Error Message: ${error}`
                            );
                        }
                    }
                    this.adminLogger.logInfo(
                        `===== For ${collection} total updated documents: ${updatedCount} and total documents skipped: ${skippedCount}. The source documents that have a missing lastUpdated value: ${sourceMissingLastUpdated} and target documents that have missing lastUpdated value are: ${targetMissingLastUpdated} `
                    );
                    // eslint-disable-next-line security/detect-object-injection
                    results[collection] = {
                        totalSourceDocuments: totalSourceDocuments,
                        totalTargetDocuments: totalTargetDocuments,
                        totalProcessedDocuments: totalProcessedDoc,
                        sourceMissingLastUpdated: sourceDocumentsMissingLastUpdated,
                        targetMissingLastUpdated: targetMissingLastUpdated,
                        targetLastUpdatedGreaterThanSource: targetLastUpdatedGreaterThanSource,
                        [`targetLastUpdatedGreaterThan_${moment(this.updatedBefore).format('YYYY-MM-DD')}`]: targetLastUpdatedGreaterThanUpdatedBefore,
                        updatedCount: updatedCount,
                        skippedCount: skippedCount,
                        lastProcessedId: lastProcessedId
                    };
                }
                return results;
            });

            const results = await Promise.all(processingBatch);
            // Creating an object that logs the collection name, total updated, skipped and lastUpdatedId for the document
            const mergedObject = results.reduce((acc, obj) => Object.assign(acc, obj), {});
            this.adminLogger.logInfo(mergedObject);
        } catch (error) {
            this.adminLogger.logError(`Error: ${error}`);
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
