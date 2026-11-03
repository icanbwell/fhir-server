const { ReadPreference } = require('mongodb');
const { assertTypeEquals } = require('../utils/assertType');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { FastDatabaseBulkInserter } = require('../dataLayer/fastDatabaseBulkInserter');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { generateUUID } = require('../utils/uid.util');
const { FhirResourceWriteSerializer } = require('../fhir/fhirResourceWriteSerializer');

class AdminResourceWriter {
    constructor (
        {
            databaseQueryFactory,
            resourceMerger,
            fastDatabaseBulkInserter,
            postRequestProcessor,
            requestSpecificCache
        }
    ) {
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        this.fastDatabaseBulkInserter = fastDatabaseBulkInserter;
        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);

        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    async writeAsync ({ requestInfo, base_version, resourceType, resource: resourceToWrite, smartMerge = true }) {
        const resource = FhirResourceWriteSerializer.serializeByResourceType({ obj: resourceToWrite, resourceType });
        const writeRequestInfo = new FhirRequestInfo({ ...requestInfo, requestId: generateUUID() });
        const { requestId } = writeRequestInfo;
        try {
            const currentResource = await this.databaseQueryFactory
                .createQuery({ resourceType, base_version })
                .fastFindOneAsync({
                    query: { _uuid: resource._uuid },
                    options: { readPreference: ReadPreference.PRIMARY }
                });

            if (currentResource) {
                writeRequestInfo.method = 'PATCH';
                const { updatedResource, patches } = await this.resourceMerger.fastMergeResourceAsync({
                    base_version,
                    requestInfo: writeRequestInfo,
                    currentResource,
                    resourceToMerge: resource,
                    smartMerge
                });
                if (!updatedResource) {
                    return;
                }
                await this.fastDatabaseBulkInserter.mergeOneAsync({
                    base_version,
                    requestInfo: writeRequestInfo,
                    resourceType,
                    doc: updatedResource,
                    previousVersionId: currentResource.meta.versionId,
                    patches,
                    smartMerge
                });
            } else {
                writeRequestInfo.method = 'POST';
                resource.meta = { ...resource.meta, lastUpdated: new Date() };
                await this.fastDatabaseBulkInserter.insertOneAsync({
                    base_version,
                    requestInfo: writeRequestInfo,
                    resourceType,
                    doc: resource
                });
            }

            const mergeResults = await this.fastDatabaseBulkInserter.executeAsync({
                requestInfo: writeRequestInfo,
                base_version
            });
            const failedResult = mergeResults.find(result => result.issue);
            if (failedResult) {
                throw new Error(
                    `Failed to write ${failedResult.resourceType}/${failedResult.uuid}: ${failedResult.issue.code}`
                );
            }
            await this.postRequestProcessor.executeAsync({ requestId });
        } finally {
            await this.requestSpecificCache.clearAsync({ requestId });
        }
    }
}

module.exports = {
    AdminResourceWriter
};
