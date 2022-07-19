const {groupByLambda} = require('../../utils/list.util');
const async = require('async');
const {
    getHistoryCollectionNameForResourceType,
    getDatabaseConnectionForCollection
} = require('../common/resourceManager');
const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');

class DatabaseBulkLoader {
    /**
     * finds all documents with the specified resource type and ids
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {{resourceType: string, id: string}[]} requestedResources
     * @returns {Promise<{documents: import('mongodb').DefaultSchema[], resourceType: string}[]>}
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
     * @param {string[]} idList
     * @returns {Promise<{documents: import('mongodb').DefaultSchema[], resourceType: string}>}
     */
    async getResourcesByIdAsync(base_version, useAtlas, resourceType, idList) {
        /**
         * @type {string}
         */
        const collectionName = getHistoryCollectionNameForResourceType(resourceType, base_version);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = getDatabaseConnectionForCollection(collectionName, useAtlas);
        /**
         * @type {import('mongodb').Collection}
         */
        let collection = await getOrCreateCollection(db, collectionName);

        /**
         * cursor
         * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>}
         */
        const cursor = collection.find(
            {
                id: idList
            }
        );

        return {resourceType, documents: await cursor.toArray()};
    }
}

module.exports = {
    DatabaseBulkLoader
};
