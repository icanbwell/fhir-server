const { DatabaseCursor } = require('./databaseCursor');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { ResourceLocator } = require('../operations/common/resourceLocator');
const { assertTypeEquals } = require('../utils/assertType');
const { RethrownError } = require('../utils/rethrownError');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const moment = require('moment-timezone');
const { getCircularReplacer } = require('../utils/getCircularReplacer');
const { MongoFilterGenerator } = require('../utils/mongoFilterGenerator');
const { SecurityTagStructure } = require('../fhir/securityTagStructure');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');
const { DatabaseAttachmentManager } = require('./databaseAttachmentManager');
const { DELETE } = require('../constants').GRIDFS;

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
 * This class manages access to the database by finding the appropriate collection to use for the
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
     * Finds one resource of a resource type
     * @typedef FindOneOption
     * @property {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @property {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     *
     * @param {FindOneOption} params
     * @return {Promise<Resource|null>}
     */
    async findOneAsync({ query, options = null }) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForQueryAsync({});
            /**
             * @type { Promise<Resource|null>}
             */
            const resource = await collection.findOne(query, options);
            if (resource !== null) {
                return FhirResourceCreator.createByResourceType(resource, this._resourceType);
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findOneAsync(): ' + `query: ${JSON.stringify(query)}`,
                error: e,
                args: { query, options }
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
    async deleteManyAsync({ query, requestId, options = {} }) {
        try {
            let deletedCount = 0;

            const resourcesCursor = await this.findAsync({
                query,
                options
            });
            // find the history collection for each
            while (await resourcesCursor.hasNext()) {
                /**
                 * @type {Resource|null}
                 */
                const resource = await resourcesCursor.nextObject();
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
                    historyResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
                    await historyCollection.insertOne(
                        new BundleEntry({
                            id: historyResource.id,
                            resource: historyResource,
                            request: new BundleRequest({
                                id: requestId,
                                method: 'DELETE',
                                url: `${this._base_version}/${resource.resourceType}/${resource._uuid}`
                            })
                        }).toJSONInternal()
                    );
                }
            }
            const collection = await this.resourceLocator.getOrCreateCollectionForQueryAsync({});
            /**
             * @type {import('mongodb').DeleteWriteOpResultObject}
             */
            const result = await collection.deleteMany(query, options);
            deletedCount += result.deletedCount;

            return { deletedCount, error: null };
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deleteManyAsync(): ' + `query: ${JSON.stringify(query)}`,
                error: e,
                args: { query, requestId, options }
            });
        }
    }

    /**
     * Returns a DatabaseCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @param {Object} extraInfo
     * @return {Promise<DatabaseCursor>}
     */
    async findAsync({ query, options = null, extraInfo = {} }) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForQueryAsync({
                extraInfo
            });
            const cursor = collection.find(query, options);
            return new DatabaseCursor({
                base_version: this._base_version,
                resourceType: this._resourceType,
                cursor,
                query
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findAsync(): ' + `query: ${JSON.stringify(query)}`,
                error: e,
                args: { query, options }
            });
        }
    }

    /**
     * Returns a DatabaseCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param projection
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @param {Object} extraInfo
     * @return {Promise<DatabaseCursor>}
     */
    async findUsingAggregationAsync({ query, projection, options = null, extraInfo = {} }) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForQueryAsync({ extraInfo });
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
                            $match: query
                        },
                        {
                            $project: projection
                        }
                    ],
                    options
                );
            }
            return new DatabaseCursor({
                base_version: this._base_version,
                resourceType: this._resourceType,
                cursor,
                query
            });
        } catch (e) {
            throw new RethrownError({
                message: 'Error in findUsingAggregationAsync(): ' + `query: ${JSON.stringify(query)}`,
                error: e,
                args: { query, options }
            });
        }
    }

    /**
     * Gets exact count
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} query
     * @param { import('mongodb').MongoCountPreferences|null} options
     * @return {Promise<number>}
     */
    async exactDocumentCountAsync({ query, options }) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForQueryAsync({});
            return await collection.countDocuments(query, options);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in exactDocumentCountAsync(): ' + `query: ${JSON.stringify(query)}`,
                error: e,
                args: { query, options }
            });
        }
    }

    /**
     * Finds and returns subset of passed in resources that exist in the database
     * @param {Resource[]} resources
     * @return {Promise<DatabaseCursor>}
     */
    async findResourcesInDatabaseAsync({ resources }) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(resources[0]);
            const query = {
                _uuid: { $in: resources.map((r) => r._uuid) }
            };
            const options = {};
            const cursor = collection.find(query, options);
            return new DatabaseCursor({
                base_version: this._base_version,
                resourceType: this._resourceType,
                cursor,
                query
            });
        } catch (e) {
            throw new RethrownError({
                message:
                    'Error in findResourcesInDatabaseAsync(): ' +
                    `resources: ${JSON.stringify(resources, getCircularReplacer())}`,
                error: e,
                args: { resources }
            });
        }
    }
}

module.exports = {
    DatabaseQueryManager
};
