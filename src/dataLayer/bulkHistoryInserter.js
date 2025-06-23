const { MongoInvalidArgumentError } = require('mongodb');
const async = require('async');
const { MONGO_ERROR } = require('../constants');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { RethrownError } = require('../utils/rethrownError');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { logSystemErrorAsync } = require('../operations/common/systemEventLogging');

class BulkDeleteEntry {
    /**
     * @typedef {Object} BulkDeleteEntryContructor
     * @property {string} resourceType
     * @property {string} uuid
     * @property {string} id
     * @property {Resource} resource
     * @property {import('mongodb').AnyBulkWriteOperation} operation
     * @property {string} sourceAssigningAuthority
     *
     * @param {BulkDeleteEntryContructor} params
     */
    constructor({ resourceType, id, uuid, resource, operation, sourceAssigningAuthority }) {
        this.resourceType = resourceType;
        this.id = id;
        this.uuid = uuid;
        this.resource = resource;
        this.operation = operation;
        this.sourceAssigningAuthority = sourceAssigningAuthority;
    }
}

class BulkHistoryInserter {
    /**
     * @typedef {Object} BulkHistoryInserterConstructorOptions
     * @property {RequestSpecificCache} requestSpecificCache
     * @property {ResourceLocatorFactory} resourceLocatorFactory
     *
     * @param {BulkHistoryInserterConstructorOptions} options
     */
    constructor({ requestSpecificCache, resourceLocatorFactory }) {
        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkDeleteEntry[]>}
     */
    getHistoryOperationsByResourceTypeMap({ requestId }) {
        return this.requestSpecificCache.getMap({
            requestId,
            name: 'BulkHistoryOperationsByResourceTypeMap'
        });
    }

    /**
     * @typedef {Object} AddAsyncParams
     * @property {string} requestId - The ID of the request
     * @property {string} resourceType - The type of the resource (e.g., 'Patient', 'Observation')
     * @property {Resource} resource - The resource object to be added
     * @property {string} base_version - The FHIR base version (e.g., '4_0_0')
     *
     * @param {AddAsyncParams} options
     */
    async addAsync({ requestId, resource, base_version }) {
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({
            requestId
        });
        const resourceType = resource.resourceType;

        if (!historyOperationsByResourceTypeMap.has(resourceType)) {
            historyOperationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        const historyResource = resource.clone();
        /** @type {string} */
        const sourceAssigningAuthority = resource._sourceAssigningAuthority;
        /** @type {string} */
        const id = resource.id;
        /** @type {string} */
        const uuid = resource._uuid;
        historyOperationsByResourceTypeMap.get(resourceType).push(new BulkDeleteEntry({
            resource: historyResource,
            operation: {
                insertOne: {
                    document: new BundleEntry({
                        id: historyResource.id,
                        resource: historyResource,
                        request: new BundleRequest({
                            id: requestId,
                            method: 'DELETE',
                            url: `${base_version}/${resource.resourceType}/${resource._uuid}`
                        })
                    }).toJSONInternal()
                }
            },
            resourceType,
            id,
            uuid,
            sourceAssigningAuthority
        }));
    }

    /**
     * Execute the bulk history insert operation.
     * @typedef {Object} BulkHistoryInserterExecuteAsyncParams
     * @property {FhirRequestInfo} requestInfo
     * @property {string} base_version
     * @param {BulkHistoryInserterExecuteAsyncParams} options
     */
    async executeAsync({ requestInfo, base_version }) {
        const requestId = requestInfo.requestId;
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({
            requestId
        });
        if (historyOperationsByResourceTypeMap.size > 0) {
            await async.map(
                historyOperationsByResourceTypeMap.entries(),
                async (x) =>
                    await this.performBulkHistoryInsertAsync({
                        requestInfo,
                        mapEntry: x,
                        base_version
                    })
            );
            historyOperationsByResourceTypeMap.clear();
        }
    }

    /**
     * @param {{
     *  requestInfo: FhirRequestInfo,
     *  mapEntry: [string, BulkDeleteEntry[]],
     *  base_version: string
     * }} param
     */
    async performBulkHistoryInsertAsync({ requestInfo, mapEntry, base_version }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const [resourceType, operations] = mapEntry;

        const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
            resourceType,
            base_version
        });

        /**
         * @type {Map<string, BulkDeleteEntry[]}
         */
        const operationByCollectionName = new Map();

        for (const operation of operations) {
            const resource = operation.resource;
            assertIsValid(resource, 'resource is null');
            const collectionName = await resourceLocator.getHistoryCollectionNameAsync(
                resource.resource || resource
            );

            if (!operationByCollectionName.has(collectionName)) {
                operationByCollectionName.set(collectionName, []);
            }

            operationByCollectionName.get(collectionName).push(operation);
        }

        const options = {
            // for faster write operations
            ordered: false
        };

        /**
         * @type {import('mongodb').BulkWriteResult|undefined}
         */
        let bulkWriteResult;
        /**
         * @type {Record<string, { inserted: number }>}
         */
        let writeResults = {};

        for (const [collectionName, operations] of operationByCollectionName.entries()) {
            let totalInsertedCount = 0;
            //
            const historyCollection =
                await resourceLocator.getOrCreateCollectionAsync(collectionName);
            const bulkWriteOperations = operations.map((operation) => operation.operation);

            try {
                bulkWriteResult = await historyCollection.bulkWrite(bulkWriteOperations, options);
            } catch (error) {
                await logSystemErrorAsync({
                    event: 'bulkHistoryInserter',
                    message: 'bulkHistoryInserter: Error bulkWrite',
                    error,
                    args: {
                        requestId,
                        operations: operations,
                        options,
                        collection: collectionName
                    }
                });
                /**
                 * @type {string}
                 */
                let diagnostics;
                if (
                    error instanceof MongoInvalidArgumentError &&
                    error.message === MONGO_ERROR.RESOURCE_SIZE_EXCCCEDS
                ) {
                    diagnostics = error.toString();
                } else {
                    throw new RethrownError({
                        message: 'databaseBulkHistoryInseter: Error bulkWrite',
                        error
                    });
                }
                diagnostics = `Error in one of the resources of ${resourceType}: ` + diagnostics;
                const bulkWriteResultError = new Error(diagnostics);
                throw new RethrownError({
                    message: 'databaseBulkHistoryInseter: Error bulkWrite',
                    error: bulkWriteResultError,
                    args: {
                        requestId,
                        operations: operations,
                        options,
                        collection: collectionName
                    }
                });
            }
            totalInsertedCount = bulkWriteResult.insertedCount;

            writeResults[collectionName] = {
                inserted: totalInsertedCount
            };
        }

        return {
            requestId,
            writeResults
        };
    }
}

module.exports = {
    BulkHistoryInserter
};
