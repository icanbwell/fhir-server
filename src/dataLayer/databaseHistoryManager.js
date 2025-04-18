const { DatabasePartitionedCursor } = require('./databasePartitionedCursor');
const { assertTypeEquals } = require('../utils/assertType');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { RethrownError } = require('../utils/rethrownError');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');

/**
 * This class provides access to _History collections
 */
class DatabaseHistoryManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string} resourceType
     * @param {string} base_version
     */
    constructor (
        {
            resourceLocatorFactory,
            resourceType,
            base_version
        }
    ) {
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
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
        this.resourceLocator = this.resourceLocatorFactory.createResourceLocator(
            {
                resourceType: this._resourceType,
                base_version: this._base_version
            }
        );
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {Promise<{resource: object, collectionName: string}|null>}
     */
    async findOneRawAsync ({ query, options = null }) {
        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await this.resourceLocator.getOrCreateHistoryCollectionsForQueryAsync(
                { query }
            );
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type {object|null}
                 */
                let resource = await collection.findOne(query, options);

                if (resource !== null) {
                    return { resource, collectionName: collection.collectionName };
                }
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Returns a DatabasePartitionedCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {DatabasePartitionedCursor}
     */
    async findAsync ({ query, options = null }) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateHistoryCollectionsForQueryAsync(
            { query }
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
            cursors.push({ cursor, db: collection.dbName, collection: collection.collectionName });
        }
        return new DatabasePartitionedCursor({
            base_version: this._base_version,
resourceType: this._resourceType,
cursors,
            query
        });
    }
}

module.exports = {
    DatabaseHistoryManager
};
