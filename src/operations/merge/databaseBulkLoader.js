const {groupByLambda} = require('../../utils/list.util');
const async = require('async');
const {
    getDatabaseConnectionForCollection, getCollectionNameForResourceType
} = require('../common/resourceManager');
const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const {getResource} = require('../common/getResource');

class DatabaseBulkLoader {
    /**
     * finds all documents with the specified resource type and ids
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {{resourceType: string, id: string}[]} requestedResources
     * @returns {Promise<{resources: Resource[], resourceType: string}[]>}
     */
    async getResourcesByResourceTypeAndIdAsync(base_version, useAtlas, requestedResources) {
        /**
         * merge results grouped by resourceType
         * @type {Object}
         */
        const groupByResourceType = groupByLambda(requestedResources, requestedResource => {
            return requestedResource.resourceType;
        });

        return async.map(Object.entries(groupByResourceType), async x => await this.getResourcesByIdAsync(base_version, useAtlas, x[0], x[1]));
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
        /**
         * @type {string}
         */
        const collectionName = getCollectionNameForResourceType(resourceType, base_version);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = getDatabaseConnectionForCollection(collectionName, useAtlas);
        /**
         * @type {import('mongodb').Collection}
         */
        let collection = await getOrCreateCollection(db, collectionName);

        const query = {
            id: {$in: resourceAndIdList.map(r => r.id)}
        };
        /**
         * cursor
         * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>}
         */
        const cursor = collection.find(
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
     * @param {import('mongodb').Cursor<import('mongodb').DefaultSchema>} cursor
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
            result.push(resource);
        }
        return result;
    }
}

module.exports = {
    DatabaseBulkLoader
};
