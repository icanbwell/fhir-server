const {DatabasePartitionedCursor} = require('./databasePartitionedCursor');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {ResourceLocator} = require('../operations/common/resourceLocator');
const {assertTypeEquals} = require('../utils/assertType');
const {RethrownError} = require('../utils/rethrownError');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const moment = require('moment-timezone');
const {getCircularReplacer} = require('../utils/getCircularReplacer');
const {MongoFilterGenerator} = require('../utils/mongoFilterGenerator');
const {SecurityTagStructure} = require('../fhir/securityTagStructure');
const {FhirResourceCreator} = require('../fhir/fhirResourceCreator');
const {DatabaseAttachmentManager} = require('./databaseAttachmentManager');
const {DELETE} = require('../constants').GRIDFS;

/**
 * @typedef FindOneAndUpdateResult
 * @type {object}
 * @property {boolean|null} created
 * @property {Error|null} error
 */

/**
 * @typedef DeleteManyResult
 * @type {object}
 * @property {number|null} deletedCount
 * @property {Error|null} error
 */

/**
 * This class manages access to the database by finding the appropriate partitioned collection to use for the
 * provided resourceType
 */
class DatabaseQueryManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string} resourceType
     * @param {string} base_version
     * @param {MongoFilterGenerator} mongoFilterGenerator
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     */
    constructor({
                    resourceLocatorFactory,
                    resourceType,
                    base_version,
                    mongoFilterGenerator,
                    databaseAttachmentManager
                }) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {string}
         * @private
         */
        this._resourceType = resourceType;
        /**
         * @type {string}
         * @private
         */
        this._base_version = base_version;
        /**
         * @type {ResourceLocator}
         */
        this.resourceLocator = resourceLocatorFactory.createResourceLocator({
            resourceType: this._resourceType,
            base_version: this._base_version
        });
        assertTypeEquals(this.resourceLocator, ResourceLocator);

        /**
         * @type {MongoFilterGenerator}
         */
        this.mongoFilterGenerator = mongoFilterGenerator;
        assertTypeEquals(mongoFilterGenerator, MongoFilterGenerator);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {Promise<Resource|null>}
     */
    async findOneAsync({query, options = null}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
                query
            });
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type { Promise<Resource|null>}
                 */
                const resource = await collection.findOne(query, options);
                if (resource !== null) {
                    return FhirResourceCreator.createByResourceType(resource, this._resourceType);
                }
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findOneAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }
    }

    /**
     * Deletes resources
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {string} requestId
     * @param {import('mongodb').DeleteOptions} options
     * @return {Promise<DeleteManyResult>}
     */
    async deleteManyAsync({query, requestId, options = {}}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
                query
            });
            let deletedCount = 0;
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type {DatabasePartitionedCursor}
                 */
                const resourcesCursor = await this.findAsync({
                    query, options
                });
                // find the history collection for each
                while (await resourcesCursor.hasNext()) {
                    /**
                     * @type {Resource|null}
                     */
                    let resource = await resourcesCursor.next();
                    if (resource) {
                        await this.databaseAttachmentManager.transformAttachments(resource, DELETE);
                        /**
                         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
                         */
                        const historyCollection = await this.resourceLocator.getOrCreateHistoryCollectionAsync(resource);
                        /**
                         * @type {Resource}
                         */
                        const historyResource = resource.clone();
                        historyResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
                        await historyCollection.insertOne(new BundleEntry({
                            id: historyResource.id,
                            resource: historyResource,
                            request: new BundleRequest(
                                {
                                    id: requestId,
                                    method: 'DELETE',
                                    url: `${this._base_version}/${resource.resourceType}/${resource._uuid}`
                                }
                            )
                        }));
                    }
                }
                /**
                 * @type {import('mongodb').DeleteWriteOpResultObject}
                 */
                const result = await collection.deleteMany(query, options);
                deletedCount += result.deletedCount;

            }
            return {deletedCount: deletedCount, error: null};
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deleteManyAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, requestId, options}
            });
        }
    }

    /**
     * Returns a DatabasePartitionedCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @param {Object} extraInfo
     * @return {Promise<DatabasePartitionedCursor>}
     */
    async findAsync({query, options = null, extraInfo = {}}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync(
                {
                    query, extraInfo
                }
            );
            /**
             * @type {CursorInfo[]}
             */
            const cursors = [];
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>}
                 */
                const cursor = collection.find(query, options);
                cursors.push({cursor, db: collection.dbName, collection: collection.collectionName});
            }
            return new DatabasePartitionedCursor({
                base_version: this._base_version, resourceType: this._resourceType, cursors,
                query
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }
    }

    /**
     * Returns a DatabasePartitionedCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param projection
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @param {Object} extraInfo
     * @return {DatabasePartitionedCursor}
     */
    async findUsingAggregationAsync({query, projection, options = null, extraInfo = {}}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({query, extraInfo});
            /**
             * @type {CursorInfo[]}
             */
            const cursors = [];
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                let cursor;
                if (extraInfo.matchQueryProvided) {
                    cursor = collection.aggregate(query);
                } else {
                    /**
                     * @type {import('mongodb').AggregationCursor<Document>}
                     */
                    cursor = collection.aggregate(
                        [
                            {
                                $match: query,
                            },
                            {
                                $project: projection,

                            }
                        ],
                        options,
                    );
                }
                cursors.push({cursor, db: collection.dbName, collection: collection.collectionName});
            }
            return new DatabasePartitionedCursor({
                base_version: this._base_version, resourceType: this._resourceType, cursors,
                query
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findUsingAggregationAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }
    }

    /**
     * Gets estimated count of ALL documents in a collection.  This does not accept a query
     * @param {import('mongodb').EstimatedDocumentCountOptions} options
     * @return {Promise<*>}
     */
    async estimatedDocumentCountAsync({options}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
                query: undefined
            });
            let count = 0;
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * https://mongodb.github.io/node-mongodb-native/4.9/classes/Collection.html#estimatedDocumentCount
                 * @type {number}
                 */
                const countInCollection = await collection.estimatedDocumentCount(options);
                count += countInCollection;
            }
            return count;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in estimatedDocumentCountAsync(): ' + `options: ${JSON.stringify(options)}`, error: e,
                args: {options}
            });
        }
    }

    /**
     * Gets exact count
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} query
     * @param { import('mongodb').MongoCountPreferences|null} options
     * @return {Promise<*>}
     */
    async exactDocumentCountAsync({query, options}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
                query: undefined
            });
            let count = 0;
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type {number}
                 */
                const countInCollection = await collection.countDocuments(query, options);
                count += countInCollection;
            }
            return count;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in exactDocumentCountAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }
    }

    /**
     * Finds and returns subset of passed in resources that exist in the database
     * @param {Resource[]} resources
     * @return {Promise<DatabasePartitionedCursor>}
     */
    async findResourcesInDatabaseAsync({resources}) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateCollectionsAsync({resources});
            const query = {
                _uuid: {$in: resources.map(r => r._uuid)}
            };
            const options = {};
            /**
             * @type {CursorInfo[]}
             */
            const cursors = [];
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>}
                 */
                const cursor = collection.find(query, options);
                cursors.push({cursor, db: collection.dbName, collection: collection.collectionName});
            }
            return new DatabasePartitionedCursor({
                base_version: this._base_version, resourceType: this._resourceType, cursors,
                query
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findResourcesInDatabaseAsync(): ' + `resources: ${JSON.stringify(resources, getCircularReplacer())}`,
                error: e,
                args: {resources}
            });
        }
    }

    /**
     * Gets UUID from database
     * @param {string} id
     * @param {SecurityTagStructure} securityTagStructure
     * @return {Promise<string>}
     */
    async getUuidForReferenceAsync({id, securityTagStructure}) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        const query = this.mongoFilterGenerator.generateFilterForIdAndSecurityTags(
            {
                id,
                securityTagStructure
            }
        );
        /**
         *
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
         */
        const options = {
            projection: {
                '_uuid': 1,
            }
        };
        try {
            const cursor = this.findAsync(
                {
                    query,
                    options
                }
            );
            while (await cursor.hasNext()) {
                /**
                 * @type {Object|null}
                 */
                const doc = await cursor.nextRaw();
                if (!doc) {
                    return null;
                }
                return doc._uuid;
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in getUuidForReferenceAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }

    }

    /**
     * Gets UUID from database
     * @param {string} uuid
     * @return {Promise<{id: string, securityTagStructure: SecurityTagStructure}|null>}
     */
    async getIdAndSourceAssigningAuthorityForUuidAsync({uuid}) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        const query = this.mongoFilterGenerator.generateFilterForUuid(
            {
                uuid
            }
        );
        /**
         *
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
         */
        const options = {
            projection: {
                'id': 1,
                '_uuid': 1,
                '_sourceId': 1,
                'meta': 1
            }
        };
        try {
            /**
             * @type {DatabasePartitionedCursor}
             */
            const cursor = await this.findAsync(
                {
                    query,
                    options
                }
            );
            while (await cursor.hasNext()) {
                /**
                 * @type {Object|null}
                 */
                const doc = await cursor.nextRaw();
                if (!doc) {
                    return null;
                }
                return {id: doc.id, securityTagStructure: SecurityTagStructure.fromDocument({doc})};
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in getUuidForReferenceAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }

    }

    /**
     * Gets UUID from database
     * @param {string} resource
     * @param {string} sourceId
     * @param {string} sourceAssigningAuthority
     * @return {Promise<{uuid: string}>}
     */
    async getUuidForSourceIdAndSourceAssigningAuthorityAsync({sourceId, sourceAssigningAuthority }) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        const query = this.mongoFilterGenerator.generateFilterForSourceIdAndSourceAssigningAuthority(
            {
                sourceId,
                sourceAssigningAuthority
            }
        );
        /**
         *
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>}
         */
        const options = {
            projection: {
                '_uuid': 1,
            }
        };
        try {
            /**
             * @type {DatabasePartitionedCursor}
             */
            const cursor = await this.findAsync(
                {
                    query,
                    options
                }
            );
            while (await cursor.hasNext()) {
                /**
                 * @type {Object|null}
                 */
                const doc = await cursor.nextRaw();
                if (!doc) {
                    return null;
                }
                return {uuid: doc._uuid};
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in getUuidForSourceIdAndSourceAssigningAuthorityAsync(): ' + `query: ${JSON.stringify(query)}`, error: e,
                args: {query, options}
            });
        }

    }
}

module.exports = {
    DatabaseQueryManager
};
