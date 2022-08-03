const {
    getOrCreateCollectionsForQueryForResourceTypeAsync
} = require('../operations/common/resourceManager');
const {DatabasePartitionedCursor} = require('./databasePartitionedCursor');

/**
 * Finds one resource by looking in multiple partitions of a resource type
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
 * @param { WithoutProjection<FindOneOptions<import('mongodb').DefaultSchema>> | null} options
 * @return {Promise<Resource|any>}
 */
async function findOneByResourceTypeAsync(resourceType, base_version, useAtlas, filter, options = null) {
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
     */
    const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas);
    for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
        /**
         * @type { Promise<Resource|null>}
         */
        const resource = await collection.findOne(filter, options);
        if (resource !== null) {
            return resource;
        }
    }
    return null;
}

/**
 * Finds one resource by looking in multiple partitions of a resource type
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
 * @param {import('mongodb').UpdateQuery<import('mongodb').DefaultSchema> | any} update
 * @param {import('mongodb').FindOneAndUpdateOption<import('mongodb').DefaultSchema> | null} options
 * @return {Promise<Resource|any>}
 */
async function findOneAndUpdateByResourceTypeAsync(resourceType, base_version,
                                                   useAtlas, filter, update,
                                                   options = null) {
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
     */
    const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas);
    for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
        await collection.findOneAndUpdate(filter, update, options);
    }
    return null;
}

/**
 * Finds one resource by looking in multiple partitions of a resource type
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
 * @param {import('mongodb').CommonOptions | null} options
 * @return {Promise<void>}
 */
async function deleteManyByResourceTypeAsync(resourceType, base_version,
                                             useAtlas, filter,
                                             options = null) {
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
     */
    const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas);
    for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
        await collection.deleteMany(filter, options);
    }
}

/**
 * Returns a DatabasePartitionedCursor by executing the query
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
 * @param {import('mongodb').WithoutProjection<import('mongodb').FindOptions<import('mongodb').DefaultSchema>> | null} options
 * @return {DatabasePartitionedCursor}
 */
async function findByResourceTypeAsync(resourceType, base_version,
                                       useAtlas, filter, options = null) {
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
     */
    const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas);
    /**
     * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>[]}
     */
    const cursors = [];
    for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
        /**
         * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>}
         */
        const cursor = await collection.find(filter, options);
        cursors.push(cursor);
    }
    return new DatabasePartitionedCursor(cursors);
}

/**
 * Gets estimated count
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} filter
 * @param { import('mongodb').MongoCountPreferences|null} options
 * @return {Promise<*>}
 */
async function estimatedDocumentCountByResourceType(resourceType, base_version, useAtlas, filter, options) {
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
     */
    const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas);
    let count = 0;
    for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
        /**
         * @type {number}
         */
        const countInCollection = await collection.estimatedDocumentCount(filter, options);
        count += countInCollection;
    }
    return count;
}

/**
 * Gets estimated count
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} filter
 * @param { import('mongodb').MongoCountPreferences|null} options
 * @return {Promise<*>}
 */
async function exactDocumentCountByResourceType(resourceType, base_version, useAtlas, filter, options) {
    /**
     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
     */
    const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas);
    let count = 0;
    for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
        /**
         * @type {number}
         */
        const countInCollection = await collection.countDocuments(filter, options);
        count += countInCollection;
    }
    return count;
}

module.exports = {
    findOneByResourceTypeAsync,
    findByResourceTypeAsync,
    findOneAndUpdateByResourceTypeAsync,
    deleteManyByResourceTypeAsync,
    estimatedDocumentCountByResourceType,
    exactDocumentCountByResourceType
};
