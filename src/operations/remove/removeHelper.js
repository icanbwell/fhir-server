const moment = require('moment');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { DELETE } = require('../../constants').GRIDFS;

class RemoveHelper {
    /**
     *
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     */
    constructor({
        resourceLocatorFactory,
        databaseQueryFactory,
        databaseAttachmentManager,
        databaseBulkInserter
    }) {
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

        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
    }

    /**
     * Deletes resources
     * @typedef {Object} DeleteManyAsyncOption
     * @property {FhirRequestInfo} requestInfo
     * @property {import('mongodb').DeleteOptions} options
     * @property {string} resourceType
     * @property {string} base_version
     * @property {Resource} resources
     *
     * @param {DeleteManyAsyncOption}
     * @return {Promise<Number>}
     */
    async deleteManyAsync({ requestInfo, options = {}, resourceType, resources, base_version }) {
        const { requestId } = requestInfo;
        let uuidList = [];
        let query = {};
        try {
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType,
                base_version
            });

            for (const resource of resources) {
                if (!resource) {
                    continue;
                }
                const resourceUuid = resource._uuid;
                assertIsValid(resourceUuid, 'Resource UUID must be defined');
                uuidList.push(resourceUuid);

                await this.databaseAttachmentManager.transformAttachments(resource, DELETE);
                resource.meta.lastUpdated = new Date(
                    moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
                );
                await this.databaseBulkInserter.insertOneHistoryAsync({
                    requestInfo,
                    base_version,
                    resourceType,
                    doc: resource,
                    skipResourceAssertion: true
                });
            }

            // Add history before deletion
            await this.databaseBulkInserter.executeHistoryAsync({
                requestInfo,
                base_version
            })

            query = {
                _uuid: { $in: uuidList }
            }
            const collection = await resourceLocator.getOrCreateCollectionForQueryAsync({});
            const result = await collection.deleteMany(query, options);

            return result.deletedCount;
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
