'use strict';
const async = require('async');
const { EventEmitter } = require('events');
const {
    logVerboseAsync,
    logInfo
} = require('../operations/common/logging');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { RethrownError } = require('../utils/rethrownError');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const { Base64DataManager } = require('./base64DataManager');
const { BulkInsertUpdateEntry } = require('./bulkInsertUpdateEntry');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');

/**
 * @classdesc This class accepts inserts and updates and when executeAsync() is called it sends them to Mongo in bulk
 */
class DatabaseBulkInserter extends EventEmitter {
    /**
     * Constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {import('./base64DataManager').Base64DataManager} base64DataManager
     * @param {BulkWriteExecutor[]} bulkWriteExecutors
     * @param {HistoryKafkaProducer|null} [historyKafkaProducer] optional parallel history produce to Kafka
     */
    constructor ({
                    postRequestProcessor,
                    requestSpecificCache,
                    base64DataManager,
                    bulkWriteExecutors,
                    historyKafkaProducer = null
                }) {
        super();

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);

        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);

        /**
         * @type {HistoryKafkaProducer|null}
         */
        this.historyKafkaProducer = historyKafkaProducer;

        /**
         * @type {BulkWriteExecutor[]}
         */
        this.bulkWriteExecutors = bulkWriteExecutors || [];
        assertIsValid(Array.isArray(this.bulkWriteExecutors), 'bulkWriteExecutors must be an array');
        for (const executor of this.bulkWriteExecutors) {
            assertIsValid(
                executor && typeof executor.canHandle === 'function' && typeof executor.executeBulkAsync === 'function',
                'Each bulkWriteExecutor must implement canHandle and executeBulkAsync'
            );
        }
    }


    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getOperationsByResourceTypeMap ({ requestId }) {
        return this.requestSpecificCache.getMap({ requestId, name: 'OperationsByResourceTypeMap' });
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getHistoryOperationsByResourceTypeMap ({ requestId }) {
        return this.requestSpecificCache.getMap({ requestId, name: 'HistoryOperationsByResourceTypeMap' });
    }

    /**
     * Adds a history operation
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {MergePatchEntry[]|null} patches
     * @private
     */
    addHistoryOperationForResourceType (
        {
            requestId,
            resourceType,
            resource,
            operationType,
            operation,
            patches,
            contextData = null
        }
    ) {
        // If there is no entry for this collection then create one
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({ requestId });
        if (!(historyOperationsByResourceTypeMap.has(resourceType))) {
            historyOperationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        /** @type {string} */
        const sourceAssigningAuthority = resource._sourceAssigningAuthority;
        /** @type {string} */
        const id = resource.id;
        /** @type {string} */
        const uuid = resource._uuid;
        historyOperationsByResourceTypeMap.get(resourceType).push(
            new BulkInsertUpdateEntry({
                    id,
                    uuid,
                    sourceAssigningAuthority,
                    resourceType,
                    resource,
                    operation,
                    operationType,
                    patches,
                    isCreateOperation: true,
                    isUpdateOperation: false,
                    contextData
                }
            )
        );
    }

    /**
     * Inserts item into collection without checking if item exists
     * @typedef {Object} getOperationForResourceAsyncParam
     * @property {string} requestId
     * @property {string} resourceType
     * @property {Resource} doc
     * @property {string} operationType
     * @property {import('mongodb').AnyBulkWriteOperation} operation
     * @property {MergePatchEntry[]|null} patches
     * @property {boolean} isAccessLogOperation
     * @property {Object|null} contextData
     *
     * @param {getOperationForResourceAsyncParam}
     * @returns {BulkInsertUpdateEntry}
     */
    getOperationForResourceAsync ({
        requestId,
        resourceType,
        doc,
        operationType,
        operation,
        patches,
        isAccessLogOperation = false,
        contextData = null,
        writePrecondition = null
    }) {
        try {
            if (!isAccessLogOperation) {
                assertTypeEquals(doc, Resource);
                assertIsValid(doc._uuid, `No uuid found for ${doc.resourceType}/${doc.id}`);
            }
            if (doc._id) {
                logInfo('_id still present', {
                    args: {
                        source: 'DatabaseBulkInserter.getOperationForResourceAsync',
                        doc
                    }
                });
            }

            return new BulkInsertUpdateEntry({
                id: doc.id,
                uuid: doc._uuid,
                sourceAssigningAuthority: doc._sourceAssigningAuthority,
                requestId,
                resourceType,
                resource: doc,
                operation,
                operationType,
                patches,
                isCreateOperation: operationType === 'insert' || operationType === 'insertUniqueId',
                isUpdateOperation: operationType === 'replace' || operationType === 'merge',
                contextData,
                writePrecondition
            });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Inserts item into history collection
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {Resource} doc
     * @param {MergePatchEntry[]|null} patches
     * @param {boolean} skipResourceAssertion Skip assertion for doc to be as instance of Resource
     * @param {Object|null} contextData Optional context data for resource-specific handling
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync ({ requestInfo, base_version, resourceType, doc, patches, skipResourceAssertion = false, contextData = null }) {
        if (!skipResourceAssertion) {
            assertTypeEquals(doc, Resource);
        }
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const userRequestId = requestInfo.userRequestId;
        const method = requestInfo.method;
        try {
            const historyDocument = new BundleEntry({
                id: doc._uuid,
                resource: doc,
                request: new BundleRequest({
                    id: userRequestId,
                    method,
                    url: `/${base_version}/${resourceType}/${doc.id}`
                })
            }).toJSONInternal();

            // stamped once here (Mongo Date, ms precision) so retries of this bulk op reuse the same value
            historyDocument._recorded = new Date();

            await this.base64DataManager.transformHistoryAsync(historyDocument, requestInfo);

            this.addHistoryOperationForResourceType({
                requestId,
                resourceType,
                resource: doc,
                operationType: 'insert', // history operations are blind merges without checking id
                operation: {
                    insertOne: {
                        document: historyDocument
                    }
                },
                patches,
                contextData
            });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Executes all the operations in bulk
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Map<string, BulkInsertUpdateEntry[]>|undefined} operationsMap
     * @param {boolean} maintainOrder
     * @param {boolean} isAccessLogOperation
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync ({
        requestInfo,
        base_version,
        operationsMap,
        maintainOrder = true,
        isAccessLogOperation = false
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        assertIsValid(requestId, 'requestId is null');
        try {
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
            const operationsByResourceTypeMap = operationsMap || this.getOperationsByResourceTypeMap({ requestId });

            await logVerboseAsync({
                source: 'DatabaseBulkInserter.executeAsync',
                args:
                    {
                        message: 'start',
                        bufferLength: operationsByResourceTypeMap.size
                    }
            });
            // run both the operations on the main tables and the history tables in parallel
            /**
             * @type {BulkResultEntry[]}
             */
            const resultsByResourceType = await async.map(
                operationsByResourceTypeMap.entries(),
                async mapEntry => await this.performBulkForResourceTypeWithMapEntryAsync(
                    {
                        requestInfo,
                        mapEntry,
                        base_version,
                        useHistoryCollection: false,
                        maintainOrder,
                        isAccessLogOperation
                    }
                ));

            if (!operationsMap) {
                await this.executeHistoryInPostRequestAsync(
                    {
                        requestInfo, base_version
                    }
                );
            }

            operationsByResourceTypeMap.clear();

            await logVerboseAsync({
                source: 'DatabaseBulkInserter.executeAsync',
                args:
                    {
                        message: 'end',
                        bufferLength: operationsByResourceTypeMap.size
                    }
            });
            return resultsByResourceType.flatMap(
                r => r.mergeResultEntries
            );
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Executes all the history operations in bulk in a Post Request operation
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<void>}
     */
    async executeHistoryInPostRequestAsync ({ requestInfo, base_version }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({ requestId });
        if (historyOperationsByResourceTypeMap.size > 0) {
            this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await async.map(
                            historyOperationsByResourceTypeMap.entries(),
                            async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                                {
                                    requestInfo,
                                    mapEntry: x,
                                    base_version,
                                    useHistoryCollection: true
                                }
                            ));
                        historyOperationsByResourceTypeMap.clear();
                    }
                }
            );
        }
    }

    /**
     * Performs bulk operations
     * @param {FhirRequestInfo} requestInfo
     * @param {[string, BulkInsertUpdateEntry[]]} mapEntry
     * @param {string} base_version
     * @param {boolean|null} useHistoryCollection
     * @param {boolean} maintainOrder
     * @param {boolean} isAccessLogOperation
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeWithMapEntryAsync (
        {
            base_version,
            requestInfo,
            mapEntry,
            useHistoryCollection,
            maintainOrder = true,
            isAccessLogOperation = false
        }
    ) {
        try {
            const [
                /** @type {string} */resourceType,
                /** @type {BulkInsertUpdateEntry[]} */ operations
            ] = mapEntry;

            return await this.performBulkForResourceTypeAsync(
                {
                    requestInfo,
                    resourceType,
                    base_version,
                    useHistoryCollection,
                    operations,
                    maintainOrder,
                    isAccessLogOperation
                });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Run bulk operations for collection of resourceType.
     * Delegates to the first matching BulkWriteExecutor.
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {boolean|null} useHistoryCollection
     * @param {BulkInsertUpdateEntry[]} operations
     * @param {boolean} maintainOrder
     * @param {boolean} isAccessLogOperation
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeAsync ({
        resourceType,
        base_version,
        useHistoryCollection,
        operations,
        requestInfo,
        maintainOrder = true,
        isAccessLogOperation = false
    }) {
        const executor = this.bulkWriteExecutors.find(e => e.canHandle(resourceType));
        if (!executor) {
            const available = this.bulkWriteExecutors
                .map(e => e.constructor.name)
                .join(', ') || 'none';
            throw new Error(
                `No BulkWriteExecutor registered for resourceType=${resourceType}. Available: ${available}`
            );
        }
        // Kafka-only history: produce first and write to MongoDB only what Kafka did not accept, so a
        // Kafka outage loses no history. The producer never throws.
        const mongoHistoryDisabled = useHistoryCollection === true && !!this.historyKafkaProducer &&
            this.historyKafkaProducer.isMongoWriteDisabledFor(resourceType);
        let operationsToWrite = operations;
        if (mongoHistoryDisabled) {
            operationsToWrite = await this.historyKafkaProducer.produceWithMongoFallbackAsync({
                resourceType, operations, requestId: requestInfo.requestId
            });
            if (operationsToWrite.length === 0) {
                return { resourceType, mergeResult: undefined, error: null, mergeResultEntries: [] };
            }
        }
        const result = await executor.executeBulkAsync({
            resourceType, operations: operationsToWrite, requestInfo, base_version,
            useHistoryCollection, maintainOrder, isAccessLogOperation,
            insertOneHistoryFn: this.insertOneHistoryAsync.bind(this)
        });
        // Parallel history produce: only after a successful history write (a size-rejected write returns
        // `error` and writes nothing), never replaces it, never throws.
        if (useHistoryCollection === true && !mongoHistoryDisabled && this.historyKafkaProducer && !result?.error &&
            this.historyKafkaProducer.isEnabledFor(resourceType)) {
            await this.historyKafkaProducer.produceAsync({
                resourceType, operations, requestId: requestInfo.requestId
            });
        }
        return result;
    }

}

module.exports = {
    DatabaseBulkInserter
};
