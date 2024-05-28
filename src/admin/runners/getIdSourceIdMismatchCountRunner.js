const fs = require('fs');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');

class GetIdSourceIdMismatchCountRunner extends BaseBulkOperationRunner {
    /**
     * main process function
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            this.initializeWriteStream();
            await this.getIdSourceIdMismatchCountAsync();
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
    initializeWriteStream() {
        this.writeStream = fs.createWriteStream('collectionwise_id_sourceid_mismatch_count.csv');
        this.writeStream.write(
            'Resource| Count | Uuid with min lastUpdated | Min LastUpdated | Uuid with max lastUpdated | Max LastUpdated |\n'
        );
    }

    /**
     * Closes Write streams
     * @returns {Promise<void>}
     */
    async handleWriteStreamClose() {
        this.writeStream.close();
        return new Promise((resolve) => this.writeStream.on('close', resolve));
    }

    /**
     * Gets the count of documents with a mismatch in id and sourceid field
     * @return {Promise<void>}
     */
    async getIdSourceIdMismatchCountAsync() {
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        const { db, client, session } = await this.createSingeConnectionAsync({ mongoConfig });

        try {
            for (const collection of await db.collections()) {
                const collectionName = collection.namespace
                    .split('.')
                    .find((n) => n.includes('_4_0_0') && !n.includes('_History'));
                if (collectionName) {
                    this.adminLogger.logInfo(`Processing ${collectionName} collection`);
                    const result = collection.aggregate([
                        {
                            $match: {
                                $expr: { $ne: ['$id', '$_sourceId'] }
                            }
                        },
                        {
                            $facet: {
                                totalCount: [{ $count: 'count' }],
                                minLastUpdated: [
                                    { $sort: { 'meta.lastUpdated': 1 } },
                                    { $limit: 1 },
                                    { $project: { _uuid: 1, 'meta.lastUpdated': 1 } }
                                ],
                                maxLastUpdated: [
                                    { $sort: { 'meta.lastUpdated': -1 } },
                                    { $limit: 1 },
                                    { $project: { _uuid: 1, 'meta.lastUpdated': 1 } }
                                ]
                            }
                        },
                        {
                            $project: {
                                totalCount: { $arrayElemAt: ['$totalCount.count', 0] },
                                minLastUpdated: { $arrayElemAt: ['$minLastUpdated', 0] },
                                maxLastUpdated: { $arrayElemAt: ['$maxLastUpdated', 0] }
                            }
                        }
                    ]);
                    while (await result.hasNext()) {
                        const data = await result.next();
                        if (data.totalCount > 0) {
                            this.writeStream.write(`${collectionName}| ${data.totalCount}| ${data.minLastUpdated._uuid}| ${data.minLastUpdated.meta.lastUpdated.toISOString()}| ${data.maxLastUpdated._uuid}| ${data.maxLastUpdated.meta.lastUpdated.toISOString()}| \n`);
                        }
                    }
                    this.adminLogger.logInfo(`Finished Processing ${collectionName}`);
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error in getIdSourceIdMismatchCountAsync: ${err.message}`, {
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

module.exports = { GetIdSourceIdMismatchCountRunner };
