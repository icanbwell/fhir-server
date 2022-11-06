const {groupByLambda, getFirstResourceOrNull} = require('../utils/list.util');
const async = require('async');
const {DatabaseQueryFactory} = require('./databaseQueryFactory');
const {assertTypeEquals} = require('../utils/assertType');
const {RethrownError} = require('../utils/rethrownError');
const {databaseBulkLoaderTimer} = require('../utils/prometheus.utils');

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
     * @param {Resource[]} requestedResources
     * @returns {Promise<{resources: Resource[], resourceType: string}[]>}
     */
    async loadResourcesAsync({base_version, requestedResources}) {
        try {
            /**
             * merge results grouped by resourceType
             * @type {Object}
             */
            const groupByResourceType = groupByLambda(requestedResources, requestedResource => {
                return requestedResource.resourceType;
            });

            /**
             * Load all specified resource groups in async
             * @type {{resources: Resource[], resourceType: string}[]}
             */
            const result = await async.map(
                Object.entries(groupByResourceType),
                async x => await this.getResourcesAsync(
                    {
                        base_version,
                        resourceType: x[0],
                        resources: x[1]
                    }
                )
            );
            // Now add them to our cache
            for (const {resourceType, resources} of result) {
                this.bulkCache.set(resourceType, resources);
            }
            return result;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Get resources by id for this resourceType
     * @param {string} base_version
     * @param {string} resourceType
     * @param {Resource[]} resources
     * @returns {Promise<{resources: Resource[], resourceType: string}>}
     */
    async getResourcesAsync({base_version, resourceType, resources}) {
        // Start the FHIR request timer, saving a reference to the returned method
        const timer = databaseBulkLoaderTimer.startTimer();
        try {
            /**
             * cursor
             * @type {DatabasePartitionedCursor}
             */
            const cursor = await this.databaseQueryFactory.createQuery(
                {resourceType, base_version}
            ).findResourcesInDatabaseAsync({resources});

            /**
             * @type {Resource[]}
             */
            const foundResources = await this.cursorToResourcesAsync({cursor});
            return {resourceType, resources: foundResources};
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        } finally {
            timer({resourceType});
        }
    }

    /**
     * Reads resources from cursor
     * @param {DatabasePartitionedCursor} cursor
     * @returns {Promise<Resource[]>}
     */
    async cursorToResourcesAsync({cursor}) {
        try {
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
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
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
        let cacheEntryResources = this.bulkCache.get(resource.resourceType);
        const resourceCopy = resource.clone(); // copy to avoid someone changing this object in the future
        if (cacheEntryResources) {
            // remove the resource with same id
            cacheEntryResources = cacheEntryResources.filter(c => c.id !== resource.id);
            cacheEntryResources.push(resourceCopy);
            this.bulkCache.set(resource.resourceType, cacheEntryResources);
        } else {
            this.bulkCache.set(resource.resourceType, [resourceCopy]);
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
        const resourceCopy = resource.clone(); // copy to avoid someone changing this object in the future
        if (cacheEntryResources) {
            // remove the resource with same id
            cacheEntryResources = cacheEntryResources.filter(c => c.id !== resource.id);
            cacheEntryResources.push(resourceCopy);
            this.bulkCache.set(resource.resourceType, cacheEntryResources);
        } else {
            this.bulkCache.set(resource.resourceType, [resourceCopy]);
        }
    }
}

module.exports = {
    DatabaseBulkLoader
};
