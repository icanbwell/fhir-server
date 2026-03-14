const { groupByLambda, getFirstResourceOrNull } = require('../utils/list.util');
const async = require('async');
const { DatabaseQueryFactory } = require('./databaseQueryFactory');
const { assertTypeEquals } = require('../utils/assertType');
const { RethrownError } = require('../utils/rethrownError');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { FhirResourceWriteSerializer } = require('../fhir/fhirResourceWriteSerializer');

/**
 * This class loads data from Mongo into memory and allows updates to this cache
 */
class DatabaseBulkLoader {
    /**
     * Constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor ({
        databaseQueryFactory,
        requestSpecificCache
    }) {
        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {string}
         */
        this.cacheName = 'bulkLoaderCache';
    }

    /**
     * Finds all documents with the specified resource type and ids
     * @param {string} requestId
     * @param {string} base_version
     * @param {Object[]} requestedResources
     * @returns {Promise<{resources: Object[], resourceType: string}[]>}
     */
    async loadResourcesAsync ({ requestId, base_version, requestedResources }) {
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
             * @type {{resources: Object[], resourceType: string}[]}
             */
            const result = await async.map(
                Object.entries(groupByResourceType),
                async x => await this.getResourcesAsync(
                    {
                        base_version, resourceType: x[0], resources: x[1]
                    }
                )
            );
            /**
             * @type {Map<string, Object[]>}
             */
            const bulkCache = this.getBulkCache({ requestId });
            // Now add them to our cache
            for (const { resourceType, resources } of result) {
                bulkCache.set(resourceType, resources);
            }
            return result;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Gets bulk cache
     * @param {string} requestId
     * @returns {Map<string, Object[]>}
     */
    getBulkCache ({ requestId }) {
        return this.requestSpecificCache.getMap({ requestId, name: this.cacheName });
    }

    /**
     * Get resources by id for this resourceType
     * @param {string} base_version
     * @param {string} resourceType
     * @param {Object[]} resources
     * @returns {Promise<{resources: Object[], resourceType: string}>}
     */

    async getResourcesAsync ({ base_version, resourceType, resources }) {
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                {
                    resourceType, base_version
                }
            );
            /**
             * cursor
             * @type {import('../dataLayer/databaseCursor').DatabaseCursor}
             */
            const cursor = await databaseQueryManager.findResourcesInDatabaseAsync({ resources });

            /**
             * @type {Object[]}
             */
            let foundResources = await cursor.toArrayAsync();
            foundResources = FhirResourceWriteSerializer.serializeArray({obj: foundResources});

            return { resourceType, resources: foundResources };
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * gets resources from list
     * @param {string} requestId
     * @param {string} resourceType
     * @param {string} uuid
     * @return {null|Object}
     */
    getResourceFromExistingList ({ requestId, resourceType, uuid }) {
        const bulkCache = this.getBulkCache({ requestId });
        // see if there is cache for this resourceType
        /**
         * @type {Object[]}
         */
        const cacheEntryResources = bulkCache.get(resourceType);
        if (cacheEntryResources) {
            return this.getMatchingResource(
                {
                    cacheEntryResources, uuid
                }
            );
        } else {
            return null;
        }
    }

    /**
     * Gets matching resources from list
     * @param {Object[]} cacheEntryResources
     * @param {string} uuid
     * @return {Object|null}
     */
    getMatchingResource ({ cacheEntryResources, uuid }) {
        /**
         * @type {Object[]}
         */
        let matchingResources = [];
        matchingResources = cacheEntryResources.filter(
            resource => resource._uuid === uuid
        );

        return getFirstResourceOrNull(matchingResources);
    }
}

module.exports = {
    DatabaseBulkLoader
};
