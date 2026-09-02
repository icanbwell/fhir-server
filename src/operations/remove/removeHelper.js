const moment = require('moment');
const { DatabaseAttachmentManager } = require('../../dataLayer/databaseAttachmentManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { ResourceLocatorFactory } = require('../common/resourceLocatorFactory');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { ACCESS_LOGS_ENTRY_DATA, BLOB_OP } = require('../../constants');
const { DELETE } = require('../../constants').GRIDFS;
const httpContext = require('express-http-context');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PostSaveProcessor } = require('../../dataLayer/postSaveProcessor');
const { Base64DataManager } = require('../../dataLayer/base64DataManager');

class RemoveHelper {
    /**
     *
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {Base64DataManager} base64DataManager
     */
    constructor({
        resourceLocatorFactory,
        databaseQueryFactory,
        databaseAttachmentManager,
        databaseBulkInserter,
        postRequestProcessor,
        postSaveProcessor,
        base64DataManager
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

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);

        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
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

            const deletionResult = [];
            const liveObjectRefsByResource = [];

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
                // Snapshot the live-bucket cleanup boundary per configured leaf, for cleanup AFTER
                // the Mongo delete commits (not here — deleting the live object before the Mongo
                // write commits would orphan it if that write then failed). Captured BEFORE
                // transformAsync below, not after: a leaf that gets newly externalized at delete
                // time (never externalized, over threshold) gets a brand-new `_blobMeta` with no
                // corresponding live object, so capturing first correctly excludes it here. A leaf
                // with no `_blobMeta` at all still gets a boundary (`resource.meta.lastUpdated`, set
                // above) so a stray object from an earlier externalized version whose own supersede
                // cleanup never ran still gets swept.
                const liveRefs = this.base64DataManager.getLiveObjectRefsOrResourceLastUpdated(resource);
                // Ensure this version's base64 data (if any) is durably in the history bucket, and
                // strip it from `resource` to `_blobMeta`-only, BEFORE it's snapshotted into history
                // below — a no-op for a resource type with no configured base64 paths.
                await this.base64DataManager.transformAsync(resource, BLOB_OP.DELETE);
                liveObjectRefsByResource.push({
                    resource, liveRefs
                });
                await this.databaseBulkInserter.insertOneHistoryAsync({
                    requestInfo,
                    base_version,
                    resourceType,
                    doc: resource,
                    skipResourceAssertion: true
                });

                deletionResult.push({
                    id: resource.id,
                    uuid: resourceUuid,
                    sourceAssigningAuthority: resource._sourceAssigningAuthority,
                    resourceType,
                    deleted: true,
                    created: false,
                    updated: false
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
            const collection = await resourceLocator.getCollectionAsync({});
            const result = await collection.deleteMany(query, options);

            // Now that the Mongo delete has committed, clean up any live-bucket objects this
            // resource's base64 leaves referenced — they're superseded by the history-bucket copy
            // persisted above. Never throws (deleteLiveObjectAsync catches + logs internally).
            for (const { resource, liveRefs } of liveObjectRefsByResource) {
                for (const lastUpdated of liveRefs.values()) {
                    await this.base64DataManager.deleteLiveObjectAsync(
                        resource.resourceType, resource._uuid, lastUpdated
                    );
                }
            }

            const operationResult = httpContext.get(ACCESS_LOGS_ENTRY_DATA)?.operationResult || [];
            operationResult.push(...deletionResult);
            httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
                operationResult: operationResult
            });

            if (resourceType !== 'AuditEvent') {
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        for (const resource of resources) {
                            await this.postSaveProcessor.afterSaveAsync({
                                requestId, eventType: 'D', resourceType, doc: resource
                            });
                        }
                    }
                });
            }

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
