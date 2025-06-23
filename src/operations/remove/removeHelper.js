const moment = require('moment');
const { BulkHistoryInserter } = require('../../dataLayer/bulkHistoryInserter');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { ResourceLocator } = require('../common/resourceLocator');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { DELETE } = require('../../constants').GRIDFS;

class RemoveHelper {
    /**
     *
     * @param {BulkHistoryInserter} bulkHistoryInserter
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     */
    constructor({
        bulkHistoryInserter,
        resourceLocatorFactory,
        databaseQueryFactory,
        databaseAttachmentManager
    }) {
        /**
         * @type {BulkHistoryInserter}
         */
        this.bulkHistoryInserter = bulkHistoryInserter;
        assertTypeEquals(bulkHistoryInserter, BulkHistoryInserter);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
    }

    /**
     * Deletes resources
     * @typedef {Object} DeleteManyAsyncOption
     * @property {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @property {FhirRequestInfo} requestInfo
     * @property {import('mongodb').DeleteOptions} options
     * @property {string} resourceType
     * @property {string} base_version
     *
     * @param {DeleteManyAsyncOption}
     * @return {Promise<import('../../dataLayer/databaseQueryManager').DeleteManyResult>}
     */
    async deleteManyAsync({ query, requestInfo, options = {}, resourceType, base_version }) {
        const { requestId } = requestInfo;
        try {
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType,
                base_version
            });
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version
            });

            /**
             * @type {ResourceLocator}
             */
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await resourceLocator.getOrCreateCollectionsForQueryAsync({
                query
            });
            let deletedCount = 0;
            for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
                /**
                 * @type {DatabasePartitionedCursor}
                 */
                const resourcesCursor = await databaseQueryManager.findAsync({
                    query,
                    options
                });
                // find the history collection for each
                while (await resourcesCursor.hasNext()) {
                    /**
                     * @type {Resource|null}
                     */
                    const resource = await resourcesCursor.next();
                    if (resource) {
                        await this.databaseAttachmentManager.transformAttachments(resource, DELETE);
                        /**
                         * @type {Resource}
                         */
                        const historyResource = resource.clone();
                        historyResource.meta.lastUpdated = new Date(
                            moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
                        );
                        this.bulkHistoryInserter.addAsync({
                            requestId,
                            resource: historyResource,
                            base_version
                        });
                    }
                }

                // Add history before deletion
                await this.bulkHistoryInserter.executeAsync({ base_version, requestInfo });

                /**
                 * @type {import('mongodb').DeleteResult}
                 */
                const result = await collection.deleteMany(query, options);
                deletedCount += result.deletedCount;
            }
            return { deletedCount, error: null };
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deleteManyAsync(): ' + `query: ${JSON.stringify(query)}`,
                error: e,
                args: { query, requestId, options }
            });
        }
    }
}

module.exports = {
    RemoveHelper
};
