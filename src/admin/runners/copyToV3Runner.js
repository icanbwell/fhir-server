const { assertTypeEquals } = require('../../utils/assertType');
const moment = require('moment-timezone');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { AdminLogger } = require('../adminLogger');
const { ObjectId } = require('mongodb');
const {mongoConfig} = require('../../config');

/**
 * @classdesc Copies documents from one collection into the other collection in different clusters
 */
class CopyToV3Runner {
    /**
     * Constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {moment.Moment} updatedAfter
     * @param {number} readBatchSize
     * @param {Object|string|undefined} collections
     * @param {AdminLogger} adminLogger
     */
    constructor({
        mongoDatabaseManager,
        mongoCollectionManager,
        updatedAfter,
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
        this.updatedAfter = updatedAfter;
        assertTypeEquals(updatedAfter, moment);

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
     * @description Creates config for the v3 cluster using connection string
     * @returns {Object}
     */
    getV3ClusterConfig() {
        let v3MongoUrl = process.env.V3_MONGO_URL;
        v3MongoUrl = v3MongoUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${process.env.V3_MONGO_USERNAME}:${process.env.V3_MONGO_PASSWORD}@`
        );
        // url-encode the url
        v3MongoUrl = encodeURI(v3MongoUrl);

        const db_name = process.env.V3_DB_NAME || 'fhir';

        this.adminLogger.logInfo(
            `Connecting to v3 cluster with db_name: ${db_name}`
        );
        return { connection: v3MongoUrl, db_name: db_name, options: mongoConfig.options };
    }

    /**
     * @description Creates config for the Live cluster using connection string
     * @returns {Object}
     */
    getLiveClusterConfig() {
        this.adminLogger.logInfo(
            `Connecting to live cluster with db_name: ${mongoConfig.db_name}`
        );
        return mongoConfig;
    }

    /**
     * @description given an array of collection filters out only the required ones.
     * @param {Array} collectionList
     * @return {Array}
     */
    getListOfCollections(collectionList) {
        let collectionNames = [];
        for (const collection of collectionList) {
            // If the collection of type view, system. or any other type, we can skip it
            if (collection.type !== 'collection' || collection.name.indexOf('system.') !== -1) {
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
        const v3ClusterConfig = this.getV3ClusterConfig();
        const liveClusterConfig = this.getLiveClusterConfig();
        let v3Client, liveClient;

        try {
            // Creating a connection between the v3 cluster and the application
            v3Client = await this.mongoDatabaseManager.createClientAsync(v3ClusterConfig);
            // Creating a connection between the live cluster and the application
            liveClient = await this.mongoDatabaseManager.createClientAsync(liveClusterConfig);
            this.adminLogger.logInfo('Client connected successfully to both the clusters.');

            // Creating a new db instance for both the clusters
            const v3Database = v3Client.db(v3ClusterConfig.db_name);
            const liveDatabase = liveClient.db(liveClusterConfig.db_name);

            // Fetch all the collection names for the live database.
            let liveCollectionAndViews = await liveDatabase.listCollections().toArray();
            let liveCollections = this.getListOfCollections(liveCollectionAndViews);
            liveCollections.sort();
            if (this.startWithCollection) {
                const indexToSplice = liveCollections.indexOf(this.startWithCollection) !== -1 ? liveCollections.indexOf(this.startWithCollection) : 0;
                liveCollections = liveCollections.splice(indexToSplice);
            }
            this.adminLogger.logInfo(`The list of collections are:  ${liveCollections}`);

            // Creating batches of collections depending on the concurrency parameter passed.
            let collectionNameBatches = [];
            // Dpending on concurrentRunners provided we eill batch collections in equivalent groups.
            let minimumCollectionsToRunTogether = Math.max(
                1,
                Math.floor(liveCollections.length / this.concurrentRunners)
            );
            for (let i = 0; i < liveCollections.length; i = i + minimumCollectionsToRunTogether) {
                collectionNameBatches.push(
                    liveCollections.slice(i, i + minimumCollectionsToRunTogether)
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
                    let totalDocumentUpdatedCount = 0; // Keeps track of the total updated documents
                    let lastProcessedId = null; // For each collect help in keeping track of the last id processed.
                    let totalDocumentCreatedCount = 0; // Keeps track of the total documents that had to be created.
                    let totalDocumentHavingSameDataCount = 0; // Keep tracks of the documents that match an existing _id but are neither updated nor created.
                    const isHistoryCollection = collection.endsWith('_History'); // Denotes that the current collection is a history collection

                    // Fetching the collection from the database for both live and v3
                    const liveDatabaseCollection = liveDatabase.collection(collection);
                    const v3DatabaseCollection = v3Database.collection(collection);

                    // Query to fetch documents for both history collection and normal collection that have lastUpdated greater than updatedAfter
                    const queryToFetchDocuments = isHistoryCollection ?
                        { 'resource.meta.lastUpdated': { $gt: new Date(this.updatedAfter) } } :
                        { 'meta.lastUpdated': { $gt: new Date(this.updatedAfter) } };
                    // // If _idAbove is provided fetch all documents having _id greater than this._idAbove and document having lastUpdate greater than updatedAfter
                    const query = this._idAbove ? {$and: [{ _id: { $gt: new ObjectId(this._idAbove) } }, queryToFetchDocuments]}: queryToFetchDocuments;

                    // Counts the total number of documents
                    const totalLiveDocuments = await liveDatabaseCollection.countDocuments();
                    // Get total count of document for which last update is greater than updatedAfter
                    const liveDocumentLastUpdatedGreaterThanUpdatedAfter = await liveDatabaseCollection.countDocuments(query);
                    this.adminLogger.logInfo(
                        `For ${collection} the total documents in live db: ${totalLiveDocuments} and documents having last updated greater than ${this.updatedAfter}: ${liveDocumentLastUpdatedGreaterThanUpdatedAfter}`
                    );

                    // Cursor options. As we are also provide _idAbove we need to get results in sorted manner
                    const cursorOptions = {
                        batchSize: this.readBatchSize,
                        sort: { _id: 1 },
                    };

                    // Projection is used so that we don't fetch _id. Thus preventing it from being updated while updating document.
                    // Returns a list of documents from liveDatabaseCollection collection with specified batch size
                    const cursor = liveDatabaseCollection.find(query, cursorOptions);

                    while (await cursor.hasNext()) {
                        let result;
                        const liveDocument = await cursor.next();

                        try {
                            // Updating the document in v3DatabaseCollection. and creating one if it does not exist
                            result = await v3DatabaseCollection.updateOne(
                                { _id: liveDocument._id },
                                { $set: liveDocument },
                                { upsert: true }
                            );
                            // Keeping track of the last updated id
                            lastProcessedId = liveDocument._id;
                            totalDocumentUpdatedCount += result.modifiedCount;
                            totalDocumentCreatedCount += result.upsertedCount;
                            // If the data has been modified which means data are not same.
                            totalDocumentHavingSameDataCount += result.modifiedCount ? 0 : result.matchedCount;
                        } catch (error) {
                            this.adminLogger.logError(
                                `Error while updating document with id ${liveDocument._id}. Error Message: ${error}`
                            );
                        }
                    }
                    this.adminLogger.logInfo(
                        `===== For ${collection} total found and created or updated documents: ${totalDocumentHavingSameDataCount + totalDocumentCreatedCount + totalDocumentUpdatedCount} The live documents that have last updated greater than ${this.updatedAfter}: ${liveDocumentLastUpdatedGreaterThanUpdatedAfter} `
                    );
                    // eslint-disable-next-line security/detect-object-injection
                    results[collection] = {
                        totalLiveDocuments: totalLiveDocuments,
                        [`liveDocumentLastUpdatedGreaterThan_${moment(this.updatedAfter).format('YYYY-MM-DD')}`]: liveDocumentLastUpdatedGreaterThanUpdatedAfter,
                        totalDocumentUpdated: totalDocumentUpdatedCount,
                        totalDocumentCreated: totalDocumentCreatedCount,
                        totalDocumentHavingSameData: totalDocumentHavingSameDataCount,
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
            await this.mongoDatabaseManager.disconnectClientAsync(v3Client);
            await this.mongoDatabaseManager.disconnectClientAsync(liveClient);
            this.adminLogger.logInfo('Closed connectinon for both the cluster');
            this.adminLogger.logInfo('Finished Script');
        }
    }
}

module.exports = {
    CopyToV3Runner,
};
