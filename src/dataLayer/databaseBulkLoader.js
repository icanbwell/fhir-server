const {groupByLambda, getFirstElementOrNull} = require('../utils/list.util');
const async = require('async');
const {getResource} = require('../operations/common/getResource');
const {DatabaseQueryManager} = require('./databaseQueryManager');
const assert = require('node:assert/strict');

/**
 * This class loads data from Mongo into memory and allows updates to this cache
 */
class DatabaseBulkLoader {
    /**
     * Constructor
     * @param {MongoCollectionManager} collectionManager
     */
    constructor(collectionManager) {
        assert(collectionManager);
        /**
         * @type {Map<string, Resource[]>}
         */
        this.bulkCache = new Map();
        /**
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
    }

    /**
     * Finds all documents with the specified resource type and ids
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {{resourceType: string, id: string}[]} requestedResources
     * @returns {Promise<{resources: Resource[], resourceType: string}[]>}
     */
    async loadResourcesByResourceTypeAndIdAsync(base_version, useAtlas, requestedResources) {
        /**
         * merge results grouped by resourceType
         * @type {Object}
         */
        const groupByResourceType = groupByLambda(requestedResources, requestedResource => {
            return requestedResource.resourceType;
        });

        /**
         * Load all specified resources in parallel
         * @type {{resources: Resource[], resourceType: string}[]}
         */
        const result = await async.map(
            Object.entries(groupByResourceType),
            async x => await this.getResourcesByIdAsync(base_version, useAtlas, x[0], x[1])
        );
        // Now add them to our cache
        for (const {resourceType, resources} of result) {
            this.bulkCache.set(resourceType, resources);
        }
        return result;
    }

    /**
     * Get resources by id for this resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {string} resourceType
     * @param {{resource:string, id: string}[]} resourceAndIdList
     * @returns {Promise<{resources: Resource[], resourceType: string}>}
     */
    async getResourcesByIdAsync(base_version, useAtlas, resourceType, resourceAndIdList) {
        const query = {
            id: {$in: resourceAndIdList.map(r => r.id)}
        };
        /**
         * cursor
         * @type {DatabasePartitionedCursor}
         */
        const cursor = await new DatabaseQueryManager(this.collectionManager, resourceType, base_version, useAtlas).findAsync(
            query
        );

        /**
         * @type {Resource[]}
         */
        const resources = await this.cursorToResourcesAsync(base_version, resourceType, cursor);
        return {resourceType, resources: resources};
    }

    /**
     *
     * @param {string} base_version
     * @param {string} resourceType
     * @param {DatabasePartitionedCursor} cursor
     * @returns {Promise<Resource[]>}
     */
    async cursorToResourcesAsync(base_version, resourceType, cursor) {
        const result = [];
        while (await cursor.hasNext()) {
            /**
             * element
             * @type {Object}
             */
            const document = await cursor.next();
            /**
             * @type {function(?Object): Resource}
             */
            const ResourceCreator = getResource(base_version, resourceType);
            const resource = new ResourceCreator(document);
            result.push(resource.toJSON());
        }
        return result;
    }

    /**
     * gets resources from list
     * @param {string} resourceType
     * @param {string} id
     * @return {null|Resource}
     */
    getResourceFromExistingList(resourceType, id) {
        // see if there is cache for this resourceType
        /**
         * @type {Resource[]}
         */
        const cacheEntryResources = this.bulkCache.get(resourceType);
        if (cacheEntryResources) {
            return getFirstElementOrNull(
                cacheEntryResources.filter(e => e.id === id.toString())
            );
        } else {
            return null;
        }
    }

    /**
     * Adds a new resource to the cache
     * @param {Resource} resource
     */
    addResourceToExistingList(resource) {
        /**
         * @type {Resource[]}
         */
        const cacheEntryResources = this.bulkCache.get(resource.resourceType);
        if (cacheEntryResources) {
            cacheEntryResources.push(resource);
            this.bulkCache.set(resource.resourceType, cacheEntryResources);
        } else {
            this.bulkCache.set(resource.resourceType, [resource]);
        }
    }

    /**
     * Updates an existing resource in the cache
     * @param {Resource} resource
     */
    updateResourceInExistingList(resource) {
        /**
         * @type {Resource[]}
         */
        let cacheEntryResources = this.bulkCache.get(resource.resourceType);
        if (cacheEntryResources) {
            // remove the resource with same id
            cacheEntryResources = cacheEntryResources.filter(c => c.id !== resource.id);
            cacheEntryResources.push(resource);
            this.bulkCache.set(resource.resourceType, cacheEntryResources);
        } else {
            this.bulkCache.set(resource.resourceType, [resource]);
        }
    }
}

module.exports = {
    DatabaseBulkLoader
};
