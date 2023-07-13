const fs = require('fs');
const {finished} = require('stream/promises');
const moment = require('moment-timezone');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');

class DumpPersonsRunner extends BaseBulkOperationRunner {
    /**
     * Constructor
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} batchSize
     * @param {string} accessCode
     * @param {string} beforeDate
     * @param {string} outputFile
     */
    constructor (
        {
            adminLogger,
            mongoDatabaseManager,
            mongoCollectionManager,
            batchSize,
            accessCode,
            beforeDate,
            outputFile
        }
    ) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager,
        });

        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {string}
         */
        this.accessCode = accessCode;

        /**
         * @type {string}
         */
        this.beforeDate = beforeDate;

        /**
         * @type {string}
         */
        this.outputFile = outputFile;

        this.collectionName = 'Person_4_0_0';

        this.outputStream = null;
        this.maxTimeMS = 20 * 60 * 60 * 1000;
        this.numberOfSecondsBetweenSessionRefreshes = 10 * 60;
   }

    async formatDocument(doc) {
        delete doc['_uuid'];
        delete doc['_id'];
        delete doc['_access'];
        delete doc['_sourceAssigningAuthority'];
        delete doc['_sourceId'];
        delete doc['active'];
        const newDoc = { resource: {...doc} };
        return newDoc;
    }

    /**
     * Runs a loop to access all the documents and dump into output file
     * @returns {Promise<void>}
     */
    async processAsync() {
        await this.init();
        if (!this.outputStream) {
            this.outputStream = await fs.createWriteStream(this.outputFile);
        }
        const writeStream = (writer, data) => {
            // return a promise only when we get a drain
            if (!writer.write(data)) {
                return new Promise((resolve) => {
                    writer.once('drain', resolve);
                });
            }
        };
        const firstWrite = writeStream(this.outputStream, '{ "entry" : [');
        if (firstWrite) {
            if (firstWrite) {
                await firstWrite;
            }
        }

        let config = await this.mongoDatabaseManager.getClientConfigAsync();
        let sourceClient = await this.mongoDatabaseManager.createClientAsync(config);
        let session = sourceClient.startSession();
        let sessionId = session.serverSession.id;
        const sourceDb = sourceClient.db(config.db_name);
        const sourceCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: sourceDb, collectionName: this.collectionName
            }
        );
        const options = {session: session, timeout: false, noCursorTimeout: true, maxTimeMS: this.maxTimeMS};
        let refreshTimestamp = moment(); // take note of time at operation start
        // Filter to process only certain documents depending on the owner code passed.
        const accessFilter = this.accessCode ?
            { 'meta.security': { $elemMatch: { 'system': 'https://www.icanbwell.com/access', 'code': this.accessCode }} } :
            {};
        // Fetch onlu docs that were lastUpdated before beforeDate
        const beforeDateQuery = this.beforeDate ?
            { 'meta.lastUpdated': { $lt: new Date(this.beforeDate)}} :
            {};

        console.log(accessFilter);
        console.log(beforeDateQuery);
        const result = await sourceCollection.find({
            ...accessFilter,
            ...beforeDateQuery
        }, options).batchSize(this.batchSize)
            .maxTimeMS(this.maxTimeMS) // 20 hours
            .addCursorFlag('noCursorTimeout', true);
        // Format document and write to output file
        for await (let doc of result) {
            doc = await this.formatDocument(doc);
            const docWrite = writeStream(this.outputStream, JSON.stringify(doc));
            if (docWrite) {
                await docWrite;
            }
            const commaWrite = writeStream(this.outputStream, ',');
            if (commaWrite) {
                await commaWrite;
            }
            console.log(doc.resource.id);
            // Check if more than 5 minutes have passed since the last refresh
            if (moment().diff(refreshTimestamp, 'seconds') > this.numberOfSecondsBetweenSessionRefreshes) {
                this.adminLogger.logInfo(
                                    'refreshing session with sessionId', {'session_id': sessionId});
                const adminResult = await sourceDb.admin().command({'refreshSessions': [sessionId]});
                this.adminLogger.logInfo(
                    'result from refreshing session', {'result': adminResult});
                refreshTimestamp = moment();
            }
        }
        const closeBracket = writeStream(this.outputStream, ']}');
        if (closeBracket) {
            await closeBracket;
        }
        await session.endSession();
        await this.outputStream.end();
        await finished(this.outputStream);
        this.adminLogger.logInfo(`Finished loop ${this.collectionName}`);
        this.adminLogger.logInfo('Finished script');
        this.adminLogger.logInfo('Shutting down');
        await this.shutdown();
        this.adminLogger.logInfo('Shutdown finished');
    }
}
// usage
module.exports = {
    DumpPersonsRunner
};
