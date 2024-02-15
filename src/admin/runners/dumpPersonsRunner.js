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
     * @param {number} pageSize
     */
    constructor (
        {
            adminLogger,
            mongoDatabaseManager,
            mongoCollectionManager,
            batchSize,
            accessCode,
            beforeDate,
            outputFile,
            pageSize
        }
    ) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
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

        this.pageSize = pageSize;

        this.collectionName = 'Person_4_0_0';

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
        const writeStream = (writer, data) => {
            // return a promise only when we get a drain
            if (!writer.write(data)) {
                return new Promise((resolve) => {
                    writer.once('drain', resolve);
                });
            }
        };

        const config = await this.mongoDatabaseManager.getClientConfigAsync();
        const sourceClient = await this.mongoDatabaseManager.createClientAsync(config);
        const session = sourceClient.startSession();
        const sessionId = session.serverSession.id;
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
        // Fetch only docs that were lastUpdated before beforeDate
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
        let recordCount = 0;
        let pageCount = 0;
        let newPage = true;
        let outputStream;
        for await (let doc of result) {
            if (newPage) {
                console.log(`Opening Page ${pageCount}`);
                outputStream = await fs.createWriteStream(`${this.outputFile}_${pageCount}.json`);
                const firstWrite = writeStream(outputStream, '{ "entry" : [');
                if (firstWrite) {
                    if (firstWrite) {
                        await firstWrite;
                    }
                }
                newPage = false;
            }
            doc = await this.formatDocument(doc);
            const docWrite = writeStream(outputStream, JSON.stringify(doc, null, 4));
            if (docWrite) {
                await docWrite;
            }
            recordCount++;
            const moreRecords = await result.hasNext();
            if (recordCount < this.pageSize && moreRecords) {
                const commaWrite = writeStream(outputStream, ',');
                if (commaWrite) {
                    await commaWrite;
                }
            }
            if (recordCount === this.pageSize || !moreRecords) {
                const closeBracket = writeStream(outputStream, ']}');
                if (closeBracket) {
                    await closeBracket;
                }
                await outputStream.end();
                await finished(outputStream);
                console.log(`Closing page ${pageCount}`);
                recordCount = 0;
                pageCount++;
                newPage = true;
            }
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
        await session.endSession();
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
