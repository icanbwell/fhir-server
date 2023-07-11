const fs = require('fs');
// const { assertIsValid } = require('../../utils/assertType');
// const moment = require('moment-timezone');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');

class DumpPersonsRunner extends BaseBulkOperationRunner {
    /**
     * Constructor
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {number} limit
     * @param {number} skip
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
            limit,
            skip,
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
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

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
    }

    formatDocument(doc) {
        delete doc['_uuid'];
        delete doc['_id'];
        delete doc['_access'];
        delete doc['_sourceAssigningAuthority'];
        delete doc['_sourceId'];
        delete doc['active'];
        const newDoc = { resource: {...doc} };
        return newDoc;
    }


    // async processBatch(docList) {
    //     const query = {};
    //     try {
    //         this.adminLogger.logInfo(`Total resources being processed: ${docList.length}`);
    //         for (const doc in docList) {
    //             this.outputStream.write(JSON.stringify(doc));
    //             this.outputStream.write(',');
    //         }
    //     } catch (e) {
    //         this.adminLogger.logError(`Got error ${e}.  At ${this.startFromIdContainer.startFromId}`);
    //     }
    // }
    /**
     * Runs a loop to access all the documents and dump into output file
     * @returns {Promise<void>}
     */
    async processAsync() {
        await this.init();
        if (!this.outputStream) {
            this.outputStream = await fs.createWriteStream(this.outputFile);
            this.outputStream.write('{ "entry" : [');
        }
        this.startFromIdContainer.startFromId = '';
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        console.log('getting collection');
        const dbCollection = await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {
                db: db, collectionName: this.collectionName
            }
        );
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
        const result = await dbCollection.find({
            ...accessFilter,
            ...beforeDateQuery
        });
        // let docList = [];
        // Format document and write to output file
        for await (let doc of result) {
            doc = this.formatDocument(doc);
            //console.log(doc);
            this.outputStream.write(JSON.stringify(doc));
            this.outputStream.write(',');
        }
        // while (await result.hasNext()) {
        //     let document = await result.next();
        //     document = this.formatDocument(document);
        //     console.log(document);
        //     this.outputStream.write(JSON.stringify(document));
        //     this.outputStream.write(',');
        //
            // docList.push(document);
            // if (docList.length === this.batchSize) {
            //     await this.processBatch(docList);
            //     docList = [];
        // }
        this.outputStream.write(']');
        // If the cursor goes empty but docs still need to processed.
        // if (docList.length !== 0) {
        //     await this.processBatch(docList);
        // }
        this.outputStream.close();
        this.adminLogger.logInfo(`Finished loop ${this.collectionName}`);
        this.adminLogger.logInfo('Finished script');
        this.adminLogger.logInfo('Shutting down');
        await this.shutdown();
        this.adminLogger.logInfo('Shutdown finished');
    }
}

module.exports = {
    DumpPersonsRunner
};
