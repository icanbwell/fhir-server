const { DatabaseCursor } = require('./databaseCursor');
const { assertTypeEquals } = require('../utils/assertType');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { RethrownError } = require('../utils/rethrownError');
const { ResourceLocator } = require('../operations/common/resourceLocator');

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
     * Finds one resource of a resource type
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {Promise<{resource: object, collectionName: string}|null>}
     */
    async findOneAsync ({ query, options = null }) {
        try {
            const collection = await this.resourceLocator.getHistoryCollectionAsync();
            /**
             * @type {object|null}
             */
            let resource = await collection.findOne(query, options);

            if (resource !== null) {
                return { resource, collectionName: collection.collectionName };
            }
            return null;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Returns a DatabaseCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {Promise<DatabaseCursor>}
     */
    async findAsync ({ query, options = null }) {
        const collection = await this.resourceLocator.getHistoryCollectionAsync();
        const cursor = collection.find(query, options);
        return new DatabaseCursor({
            base_version: this._base_version,
            resourceType: this._resourceType,
            cursor,
            query
        });
    }
}

module.exports = {
    DatabaseHistoryManager
};
