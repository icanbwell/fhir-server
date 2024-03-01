const deepEqual = require('fast-deep-equal');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

class FixDuplicateOwnerTagsRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @typedef {Object} ConstructorProps
     * @property {MongoCollectionManager} mongoCollectionManager
     * @property {MongoDatabaseManager} mongoDatabaseManager
     * @property {string[]} collections
     * @property {number} batchSize
     * @property {AdminLogger} adminLogger
     * @property {string|undefined} startFromCollection
     * @property {number|undefined} limit
     * @property {boolean|undefined} useTransaction
     * @property {number|undefined} skip
     * @property {string|undefined} startFromId
     *
     * @param {ConstructorProps}
     */
    constructor ({
        mongoCollectionManager,
        mongoDatabaseManager,
        collections,
        batchSize,
        adminLogger,
        startFromCollection,
        limit,
        useTransaction,
        skip,
        startFromId
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {string[]|undefined}
         */
        this.collections = collections;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;
    }

    /**
     * gets all collection names
     * @returns {Promise<string[]>}
     */
    async getAllCollectionNamesAsync () {
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        const { db, client, session } = await this.createSingeConnectionAsync({ mongoConfig });

        try {
            const collectionNames = await this.mongoCollectionManager.getAllCollectionNames({ db });
            return collectionNames.filter((c) => !c.includes('_History'));
        } catch (err) {
            this.adminLogger.logError(`Error in getAllCollectionNamesAsync: ${err.message}`, {
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

    /**
     * Removes duplicate owner tags from the resource
     */
    removeDuplicateOwnerTags (resource) {
        const ownerCodes = [];
        if (resource?.meta?.security) {
            resource.meta.security = resource.meta.security.filter(s => {
                if (s.system !== SecurityTagSystem.owner) {
                    return true;
                }
                if (ownerCodes.includes(s?.code)) {
                    return false;
                }
                ownerCodes.push(s?.code);
                return true;
            });
        }
        return resource;
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            const operations = [];
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.create(doc);

            /**
             * @type {Resource}
             */
            const currentResource = resource.clone();

            resource = this.removeDuplicateOwnerTags(resource);

            // for speed, first check if the incoming resource is exactly the same
            const updatedResourceJsonInternal = resource.toJSONInternal();
            const currentResourceJsonInternal = currentResource.toJSONInternal();

            if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
                return operations;
            }
            operations.push({
                replaceOne: {
                    filter: {
                        _id: doc._id
                    },
                    replacement: updatedResourceJsonInternal
                }
            });

            return operations;
        } catch (e) {
            throw new RethrownError(
                {
                    message: `Error processing record ${e.message}`,
                    error: e,
                    args: {
                        resource: doc
                    },
                    source: 'FixDuplicateOwnerTagsRunner.processRecordAsync'
                }
            );
        }
    }

    /**
     * main process function
     * @returns {Promise<void>}
     */
    async processAsync () {
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = await this.getAllCollectionNamesAsync();
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(
                        (c) => c >= this.startFromCollection
                    );
                }
            }
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            for (const collectionName of this.collections) {
                const startFromIdContainer = this.createStartFromIdContainer();

                const uuids = await this.getResourceUuidsWithMultipleOwnerTagsAsync({
                    collectionName
                });

                const query = { _uuid: { $in: uuids } };

                try {
                    await this.runForQueryBatchesAsync({
                        config: mongoConfig,
                        sourceCollectionName: collectionName,
                        destinationCollectionName: collectionName,
                        query,
                        startFromIdContainer,
                        fnCreateBulkOperationAsync: async (doc) =>
                            await this.processRecordAsync(doc),
                        ordered: false,
                        batchSize: this.batchSize,
                        skipExistingIds: false,
                        limit: this.limit,
                        useTransaction: this.useTransaction,
                        skip: this.skip
                    });
                } catch (e) {
                    console.log(e.message);
                    this.adminLogger.logError(
                        `Got error ${e}.  At ${startFromIdContainer.startFromId}`
                    );
                    throw new RethrownError({
                        message: `Error processing documents of collection ${collectionName} ${e.message}`,
                        error: e,
                        args: {
                            query
                        },
                        source: 'FixDuplicateOwnerTagsRunner.processAsync'
                    });
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error in main process: ${err.message}`, {
                stack: err.stack
            });
        }
    }

    async getResourceUuidsWithMultipleOwnerTagsAsync ({ collectionName }) {
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        this.adminLogger.logInfo(`Processing ${collectionName} collection`);
        const { collection, client, session } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });
        try {
            const cursorDuplicate = collection.aggregate([
                { $unwind: '$meta.security' },
                {
                    $group: {
                        _id: {
                            _uuid: '$_uuid',
                            system: '$meta.security.system',
                            code: '$meta.security.code'
                        },
                        count: { $sum: 1 }
                    }
                },
                { $match: { count: { $gt: 1 }, '_id.system': SecurityTagSystem.owner } },
                { $group: { _id: { _uuid: '$_id._uuid' } } }
            ]);

            const uuids = [];
            while (await cursorDuplicate.hasNext()) {
                const data = await cursorDuplicate.next();
                uuids.push(data._id._uuid);
            }
            return uuids;
        } catch (err) {
            this.adminLogger.logError(
                `Error in getResourceUuidsWithMultipleOwnerTags: ${err.message}`,
                {
                    stack: err.stack
                }
            );

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

module.exports = { FixDuplicateOwnerTagsRunner };
