const {groupByLambda, getFirstResourceOrNull} = require('../utils/list.util');
const async = require('async');
const {DatabaseQueryFactory} = require('./databaseQueryFactory');
const {assertTypeEquals} = require('../utils/assertType');

/**
 * This class loads data from Mongo into memory and allows updates to this cache
 */
class DatabaseBulkLoader {
    /**
     * Constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor({databaseQueryFactory}) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {Map<string, Resource[]>}
         */
        this.bulkCache = new Map();
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
    }

    /**
     * Finds all documents with the specified resource type and ids
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {{resourceType: string, id: string}[]} requestedResources
     * @returns {Promise<{resources: Resource[], resourceType: string}[]>}
     */
    async loadResourcesByResourceTypeAndIdAsync({base_version, useAtlas, requestedResources}) {
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
            async x => await this.getResourcesByIdAsync(
                {
                    base_version, useAtlas,
                    resourceType: x[0],
                    resourceAndIdList: x[1]
                }
            )
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
    async getResourcesByIdAsync({base_version, useAtlas, resourceType, resourceAndIdList}) {
        const query = {
            id: {$in: resourceAndIdList.map(r => r.id)}
        };
        /**
         * cursor
         * @type {DatabasePartitionedCursor}
         */
        const cursor = await this.databaseQueryFactory.createQuery(
            {resourceType, base_version, useAtlas}
        ).findAsync({query});

        /**
         * @type {Resource[]}
         */
        const resources = await this.cursorToResourcesAsync({cursor});
        return {resourceType, resources: resources};
    }

    /**
     * Reads resources from cursor
     * @param {DatabasePartitionedCursor} cursor
     * @returns {Promise<Resource[]>}
     */
    async cursorToResourcesAsync({cursor}) {
        /**
         * @type {Resource[]}
         */
        const result = [];
        while (await cursor.hasNext()) {
            /**
             * element
             * @type {Resource|null}
             */
            const resource = await cursor.next();
            result.push(resource);
        }
        return result;
    }

    /**
     * gets resources from list
     * @param {string} resourceType
     * @param {string} id
     * @return {null|Resource}
     */
    getResourceFromExistingList({resourceType, id}) {
        // see if there is cache for this resourceType
        /**
         * @type {Resource[]}
         */
        const cacheEntryResources = this.bulkCache.get(resourceType);
        if (cacheEntryResources) {
            return getFirstResourceOrNull(
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
    addResourceToExistingList({resource}) {
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
    updateResourceInExistingList({resource}) {
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
