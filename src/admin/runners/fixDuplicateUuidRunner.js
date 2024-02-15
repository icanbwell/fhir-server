const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');

/**
 * @classdesc Finds _uuid of resources where count is greater than 1 and fix them
 */
class FixDuplicateUuidRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string|undefined} startFromCollection
     * @param {number|undefined} limit
     * @param {string|undefined} skip
     * @param {string|undefined} startFromId
     * @param {boolean|undefined} useTransaction
     * @param {string[]|undefined} properties
     * @param {string|undefined} afterLastUpdatedDate
     * @param {string|undefined} beforeLastUpdatedDate
     */
    constructor ({
        mongoCollectionManager,
        collections,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        startFromCollection,
        limit,
        skip,
        startFromId,
        useTransaction,
        properties,
        afterLastUpdatedDate,
        beforeLastUpdatedDate
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {string[]}
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
         * @type {string|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {string[]|undefined}
         */
        this.properties = properties;

        /**
         * @type {string|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {string|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**
         * stores uuid processed till this point
         * @type {Map<string, Set<string>>}
         */
        this.processedUuids = new Map();

        /**
         * stores meta and _id information for each _uuid
         * @type {Map<string, {meta: Object, _id: string}[]>}
         */
        this.metaIdCache = new Map();
    }

    /**
     * converts list of properties to a projection
     * @return {import('mongodb').Document}
     */
    getProjection () {
        /**
         * @type {import('mongodb').Document}
         */
        const projection = {};
        for (const property of this.properties) {
            projection[`${property}`] = 1;
        }
        // always add projection for needed properties
        const neededProperties = [
            'resourceType',
            'meta',
            'identifier',
            '_uuid',
            '_sourceId',
            '_sourceAssigningAuthority'
        ];
        for (const property of neededProperties) {
            projection[`${property}`] = 1;
        }
        return projection;
    }

    /**
     * Gets query for duplicate uuid resources
     * @param {string[]} duplicateUuidArray
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForDuplicateUuidResources ({ duplicateUuidArray }) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = { _uuid: { $in: duplicateUuidArray } };
        if (duplicateUuidArray.length === 1) {
            query = { _uuid: duplicateUuidArray[0] };
        }

        if (this.afterLastUpdatedDate && this.beforeLastUpdatedDate) {
            query = {
                $and: [
                    query,
                    { 'meta.lastUpdated': { $gt: this.afterLastUpdatedDate } },
                    { 'meta.lastUpdated': { $lt: this.beforeLastUpdatedDate } }
                ]
            };
        } else if (this.afterLastUpdatedDate) {
            query = {
                $and: [query, { 'meta.lastUpdated': { $gt: this.afterLastUpdatedDate } }]
            };
        } else if (this.beforeLastUpdatedDate) {
            query = {
                $and: [query, { 'meta.lastUpdated': { $lt: this.beforeLastUpdatedDate } }]
            };
        }

        return query;
    }

    /**
     * Gets duplicate uuids in and array from collection passed
     * @param {require('mongodb').collection} collection
     * @returns {Promise<string[]>}
     */
    async getDuplicateUuidArrayAsync ({ collection }) {
        const result = (
            await collection
                .aggregate(
                    [
                        {
                            $group: {
                                _id: '$_uuid',
                                count: { $count: {} },
                                meta: { $push: '$meta'},
                                id: { $push: '$_id' }
                            }
                        },
                        {
                            $match: {
                                count: {
                                    $gte: 2
                                }
                            }
                        }
                    ],
                    { allowDiskUse: true }
                )
                .toArray()
        )
            .map(res => {
                this.metaIdCache.set(res._id, res.id.map((id, index) => ({
                    meta: res.meta[Number(index)], _id: id
                })));
                return res._id;
            });

        return result;
    }

    /**
     * Make provided uuid unqiue for the collection
     * @param {string} uuid
     * @param {string} collectionName
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processResourceAsync ({ uuid, collectionName }) {
        try {
            if (
                this.processedUuids.has(collectionName) &&
                this.processedUuids.get(collectionName).has(uuid)
            ) {
                return [];
            }

            if (!this.metaIdCache.has(uuid)) {
                // safety check
                this.adminLogger.logInfo(`uuid: ${uuid} is missing from cache`);
                return [];
            }

            const resources = this.metaIdCache.get(uuid);

            const resourceWithoutMetaVersionId = resources.filter(res => !res.meta?.versionId);
            if (resourceWithoutMetaVersionId.length > 0) {
                this.adminLogger.logInfo(
                    `Resources without versionId for uuid: ${uuid} and _id: ${resourceWithoutMetaVersionId.map(res => res._id).join()}`
                );
                return [];
            }

            /**
             * @type {number}
             */
            const versionIdToKeep = resources.reduce(
                (versionId, res) => Math.max(versionId, Number(res.meta.versionId)),
                0
            );

            /**
             * @type {Object}
             */
            const resourcesWithMaxVersionId = resources.filter(
                (res) => Number(res.meta.versionId) === versionIdToKeep
            );

            if (resourcesWithMaxVersionId.length > 1) {
                resourcesWithMaxVersionId.sort((res1, res2) => (new Date(res2.meta.lastUpdated)).getTime() - (new Date(res1.meta.lastUpdated)).getTime());
            }

            const resourcesToDelete = resources.reduce((toDelete, res) => {
                if (res._id !== resourcesWithMaxVersionId[0]._id) {
                    toDelete.push(res._id);
                }
                return toDelete;
            }, []);

            if (!this.processedUuids.has(collectionName)) {
                this.processedUuids.set(collectionName, new Set());
            }
            this.processedUuids.get(collectionName).add(uuid);

            return [
                {
                    deleteMany: {
                        filter: {
                            _id: { $in: resourcesToDelete }
                        }
                    }
                }
            ];
        } catch (e) {
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e,
                args: {
                    uuid,
                    collectionName
                },
                source: 'FixDuplicateUuidRunner.processRecordAsync'
            });
        }
    }

    /**
     * Runs a loop on all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = await this.getAllCollectionNamesAsync({
                    useAuditDatabase: false,
                    includeHistoryCollections: false
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
            try {
                for (const collectionName of this.collections) {
                    const collection = db.collection(collectionName);
                    /**
                     * @type {string[]}
                     */
                    const duplicateUuidArray = await this.getDuplicateUuidArrayAsync({
                        collection
                    });

                    const startFromIdContainer = this.createStartFromIdContainer();

                    /**
                     * @type {import('mongodb').Filter<import('mongodb').Document>}
                     */
                    const query = this.getQueryForDuplicateUuidResources({
                        duplicateUuidArray
                    });

                    if (duplicateUuidArray.length > 0) {
                        this.adminLogger.logInfo(`Started processing uuids for ${collectionName}`);
                        this.adminLogger.logInfo(
                            `duplicate uuids for the collection: ${duplicateUuidArray.join()}`
                        );
                        try {
                            await this.runForQueryBatchesAsync({
                                config: mongoConfig,
                                sourceCollectionName: collectionName,
                                destinationCollectionName: collectionName,
                                query,
                                projection: this.properties ? this.getProjection() : undefined,
                                startFromIdContainer,
                                fnCreateBulkOperationAsync: async (doc) =>
                                    await this.processResourceAsync({
                                        uuid: doc._uuid,
                                        collectionName
                                    }),
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
                                message: `Error processing references of collection ${collectionName} ${e.message}`,
                                error: e,
                                args: {
                                    query
                                },
                                source: 'FixDuplicateUuidRunner.processAsync'
                            });
                        }

                        this.adminLogger.logInfo(`Finished processing uuids for ${collectionName}`);
                    } else {
                        this.adminLogger.logInfo(
                            `${collectionName} does not contain duplicate _uuid resource`
                        );
                    }
                }
            } finally {
                await session.endSession();
                await client.close();
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    FixDuplicateUuidRunner
};
