const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { DatabaseBulkLoader } = require('../../../../dataLayer/databaseBulkLoader');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The existing-resource loader for the `findExisting` step, once for the batch: bulk-loads the
 * stored documents for all items, then sets each item's `stored`. An item that matches the same
 * stored document as an earlier item gets its own deep copy, so one item's changes to it don't
 * reach another.
 */
class BulkPreloadLoader {
    /**
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor ({ databaseBulkLoader, databaseQueryFactory }) {
        /**
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * Loads the stored documents for all items in one bulk load and sets each item's `stored`, or
     * null when none exists.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async loadAsync ({ items, context }) {
        const { requestInfo, base_version } = context;
        const { requestId } = requestInfo;

        await this.databaseBulkLoader.loadResourcesAsync({
            requestId,
            base_version,
            requestedResources: items.map((item) => item.incoming)
        });

        const assignedStored = new Set();
        for (const item of items) {
            const stored = await this.findStoredAsync({ resource: item.incoming, requestId, base_version });
            item.stored = stored && assignedStored.has(stored) ? deepcopy(stored) : stored;
            if (stored) {
                assignedStored.add(stored);
            }
        }
    }

    /**
     * Returns the stored document for the resource, or null. A cache miss for a resource type that
     * was loaded means the resource doesn't exist; only when the type wasn't loaded does it query
     * the database by `_uuid`.
     * @param {Object} resource
     * @param {string} requestId
     * @param {string} base_version
     * @returns {Promise<Object|null>}
     */
    async findStoredAsync ({ resource, requestId, base_version }) {
        const stored = this.databaseBulkLoader.getResourceFromExistingList({
            requestId,
            resourceType: resource.resourceType,
            uuid: resource._uuid
        });
        const resourceTypeWasLoaded = this.databaseBulkLoader.isResourceTypeLoaded({
            requestId,
            resourceType: resource.resourceType
        });
        if (stored || resourceTypeWasLoaded) {
            return stored;
        }
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: resource.resourceType,
            base_version
        });
        return await databaseQueryManager.fastFindOneAsync({
            query: { _uuid: resource._uuid.toString() }
        });
    }
}

module.exports = {
    BulkPreloadLoader
};
