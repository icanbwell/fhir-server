const fs = require('fs');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');

/**
 * @classdesc Finds _uuid of resources where count is greater than 1
 */
class GetMultipleUuidCountRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string|undefined} [startFromCollection]
     */
    constructor({
        mongoCollectionManager,
        collections,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        startFromCollection,
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager,
        });
        /**
         * @type {string[]}
         */
        this.collections = collections;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;
    }

    /**
     * Runs a loop on all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = await this.getAllCollectionNamesAsync({
                    useAuditDatabase: false,
                    includeHistoryCollections: false,
                });
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(
                        (c) => c >= this.startFromCollection
                    );
                }
            }

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            const { db, client, session } = await this.createSingeConnectionAsync({ mongoConfig });
            const ws = fs.createWriteStream('./duplicateUuid.json');

            try {
                ws.write('{\n');
                for (let collectionName of this.collections) {
                    const collection = db.collection(collectionName);
                    ws.write(`\t"${collectionName}": [\n`);

                    const cursor = await collection.aggregate([
                        {
                            $group: {
                                _id: '$_uuid',
                                count: { $count: {} },
                            },
                        },
                        {
                            $match: {
                                count: {
                                    $gte: 2,
                                },
                            },
                        },
                    ]);

                    let duplicateUuidCount = 0;

                    while (await cursor.hasNext()) {
                        const data = await cursor.next();
                        duplicateUuidCount += data.count;
                        ws.write(`\t\t${JSON.stringify(data)},\n`);
                    }
                    ws.write('\t],\n');
                    this.adminLogger.logInfo(`Duplicate _uuid in ${collectionName}: ${duplicateUuidCount}`);
                }
                ws.write('}\n');
            } finally {
                ws.close();
                client.close();
                session.endSession();
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
            // to wait for ws stream to finish writing
            return new Promise((resolve) => ws.once('close', resolve));
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    GetMultipleUuidCountRunner,
};
