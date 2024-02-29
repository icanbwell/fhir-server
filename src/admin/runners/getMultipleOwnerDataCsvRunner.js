const fs = require('fs');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');

class GetMultipleOwnerDataCsvRunner extends BaseBulkOperationRunner {
    /**
     * main process function
     * @returns {Promise<void>}
     */
    async processAsync () {
        try {
            this.initializeWriteStream();

            await this.getOwnerCountForCollectionsAsync();

            await this.handleWriteStreamClose();
        } catch (err) {
            this.adminLogger.logError(`Error in main process: ${err.message}`, {
                stack: err.stack
            });
        }
    }

    /**
     * Initialize write stream
     * @returns {void}
     */
    initializeWriteStream () {
        this.writeStream = fs.createWriteStream('collectionwise_multiple_owner_count.csv');

        this.writeStream.write(
            'Collection Name| Documents with Multiple Owner Tags| Total Documents |\n'
        );
    }

    /**
     * Closes Write streams
     * @returns {Promise<void>}
     */
    async handleWriteStreamClose () {
        this.writeStream.close();

        return new Promise((resolve) => this.writeStream.on('close', resolve));
    }

    /**
     * Gets the count of documents with multiple owner tags for all collections
     * @return {Promise<void>}
     */
    async getOwnerCountForCollectionsAsync () {
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        const { db, client, session } = await this.createSingeConnectionAsync({ mongoConfig });
        try {
            for (const collection of await db.collections()) {
                const collectionName = collection.namespace
                    .split('.')
                    .find((n) => n.includes('_4_0_0') && !n.includes('_History'));
                if (collectionName) {
                    this.adminLogger.logInfo(`Processing ${collectionName} collection`);
                    const cursor = collection.aggregate([
                        { $unwind: '$meta.security' },
                        {
                            $group: {
                                _id: { _id: '$_uuid', system: '$meta.security.system' },
                                count: { $sum: 1 }
                            }
                        },
                        { $match: { count: { $gt: 1 } } },
                        { $count: 'total' }
                    ]);
                    const totalDoc = await collection.countDocuments();
                    while (await cursor.hasNext()) {
                        const data = await cursor.next();
                        this.writeStream.write(`${collectionName}| ${data.total}| ${totalDoc}| \n`);
                    }
                    this.adminLogger.logInfo(`Finished Processing ${collectionName}`);
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error in getOwnerCountForCollectionsAsync: ${err.message}`, {
                stack: err.stack
            });

            throw new RethrownError({
                message: err.message,
                error: err
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }
}

module.exports = { GetMultipleOwnerDataCsvRunner };
