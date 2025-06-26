const deepEqual = require('fast-deep-equal');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { resourcesWithDateTimeFields } = require('../utils/resourcesWithDateTimeFields')
const { DateColumnHandler } = require("../../preSaveHandlers/handlers/dateColumnHandler");

class FixInstantDataTypeRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @typedef {Object} ConstructorProps
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

            const dateColumnHandler = new DateColumnHandler();
            dateColumnHandler.setFlag(false);
            resource = await dateColumnHandler.preSaveAsync({ resource: resource });

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
                    source: 'FixInstantDataTypeRunner.processRecordAsync'
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
                this.collections = await this.getAllCollectionNamesAsync ({ useAuditDatabase: false,
                    useAccessLogsDatabase: false, includeHistoryCollections: false })
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

                const resource = collectionName.substring(0, collectionName.indexOf('_'));
                if (!(resourcesWithDateTimeFields(resource))) {
                    this.adminLogger.logInfo(`${collectionName} has no dateTime fields. Skipping`);
                    continue;
                }
                const uuids = await this.getResourceUuidsAsync({
                    collectionName
                });
                while (uuids.length > 0) {
                    const query = { _uuid: { $in: uuids.splice(0, this.batchSize) } };

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
                            source: 'FixInstantDataType.processAsync'
                        });
                    }
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error in main process: ${err.message}`, {
                stack: err.stack
            });
        }
    }

    async getResourceUuidsAsync ({ collectionName }) {
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        this.adminLogger.logInfo(`Processing ${collectionName} collection`);
        const { collection, client, session } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });
        try {
            const cursorFind = collection.find({ });
            const uuids = [];
            while (await cursorFind.hasNext()) {
                const data = await cursorFind.next();
                uuids.push(data._uuid);
            }
            return uuids;
        } catch (err) {
            this.adminLogger.logError(
                `Error in getResourceUuids: ${err.message}`,
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

module.exports = { FixInstantDataTypeRunner };
