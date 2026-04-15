'use strict';
const async = require('async');
const { EventEmitter } = require('events');
const {
    logVerboseAsync,
    logInfo,
    logError
} = require('../operations/common/logging');
const {
    logSystemErrorAsync,
    logTraceSystemEventAsync
} = require('../operations/common/systemEventLogging');
const { ResourceManager } = require('../operations/common/resourceManager');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { RethrownError } = require('../utils/rethrownError');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const { DatabaseUpdateFactory } = require('./databaseUpdateFactory');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { ConfigManager } = require('../utils/configManager');
const { getCircularReplacer } = require('../utils/getCircularReplacer');
const Meta = require('../fhir/classes/4_0_0/complex_types/meta');
const BundleResponse = require('../fhir/classes/4_0_0/backbone_elements/bundleResponse');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const { MergeResultEntry } = require('../operations/common/mergeResultEntry');
const { BulkInsertUpdateEntry } = require('./bulkInsertUpdateEntry');
const { PostSaveProcessor } = require('./postSaveProcessor');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { ACCESS_LOGS_COLLECTION_NAME, MONGO_ERROR } = require('../constants');
const { CONTEXT_KEYS } = require('../constants/groupConstants');

const { MongoInvalidArgumentError } = require('mongodb');
const { handleClickHouseGroupPreSave } = require('../utils/clickHouseGroupPreSave');
const httpContext = require('express-http-context');

/**
 * @classdesc This class accepts inserts and updates and when executeAsync() is called it sends them to Mongo in bulk
 */
class DatabaseBulkInserter extends EventEmitter {
    /**
     * Constructor
     * @param {ResourceManager} resourceManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {PreSaveManager} preSaveManager
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {ResourceMerger} resourceMerger
     * @param {ConfigManager} configManager
     * @param {PostSaveProcessor} postSaveProcessor
     * @param {BulkWriteExecutor[]} bulkWriteExecutors
     */
    constructor ({
                    resourceManager,
                    postRequestProcessor,
                    resourceLocatorFactory,
                    preSaveManager,
                    requestSpecificCache,
                    databaseUpdateFactory,
                    resourceMerger,
                    configManager,
                    postSaveProcessor,
                    bulkWriteExecutors
                }) {
        super();

        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        // https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);

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
     * Adds an operation
     * @param {string | null} requestId
     * @param {string} resourceType
     * @param {Resource} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {MergePatchEntry[]|null} patches
     * @private
     */
    addOperationForResourceType (
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
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(resourceType, `resourceType: ${resourceType} is null`);
        assertIsValid(resource, `resource: ${resource} is null`);
        assertIsValid(operation, `operation: ${operation} is null`);
        assertIsValid(!(operation.insertOne && operation.insertOne.document instanceof Resource));
        assertIsValid(!(operation.updateOne && operation.updateOne.replacement instanceof Resource));
        assertIsValid(!(operation.replaceOne && operation.replaceOne.replacement instanceof Resource));
        assertIsValid(resource.id, `resource id is not set: ${JSON.stringify(resource)}`);
        assertIsValid(resource._uuid, `resource _uuid is not set: ${JSON.stringify(resource)}`);
        // If there is no entry for this collection then create one
        const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({ requestId });
        if (!(operationsByResourceTypeMap.has(resourceType))) {
            operationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        operationsByResourceTypeMap.get(resourceType).push(
            this.getOperationForResourceAsync({
                requestId,
                resourceType,
                doc: resource,
                operationType,
                operation,
                patches,
                contextData
            })
        );
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
        contextData = null
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
                contextData
            });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Inserts item into collection if item doesn't exists else updates the item
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {Resource} doc
     * @param {Object|null} contextData - Optional context data for resource-specific handling
     * @returns {Promise<void>}
     */
    async insertOneAsync ({ base_version, requestInfo, resourceType, doc, contextData = null }) {
        try {
            assertTypeEquals(doc, Resource);
            if (!doc.meta) {
                doc.meta = new Meta({});
            }
            if (!doc.meta.versionId || isNaN(parseInt(doc.meta.versionId))) {
                doc.meta.versionId = '1';
            }
            // Run preSave handlers (includes invariant validation)
            doc = await this.preSaveManager.preSaveAsync({ resource: doc });
            handleClickHouseGroupPreSave(doc, contextData);

            assertIsValid(doc._uuid, `No uuid found for ${doc.resourceType}/${doc.id}`);
            /** @type {string|null} */
            const requestId = requestInfo.requestId;
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
            const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({ requestId });
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const operationsByResourceType = operationsByResourceTypeMap.get(resourceType);
            if (operationsByResourceType &&
                operationsByResourceType.filter(
                    bulkEntry => bulkEntry.uuid === doc._uuid &&
                        bulkEntry.operationType === 'insertUniqueId').length > 0) {
                const previousVersionId = 1;
                await this.mergeOneAsync(
                    {
                        base_version,
                        requestInfo,
                        resourceType,
                        doc,
                        previousVersionId: `${previousVersionId}`,
                        patches: null,
                        contextData
                    }
                );
            } else {
                // else insert it
                await logVerboseAsync({
                    source: 'DatabaseBulkInserter.insertOneAsync',
                    args:
                        {
                            message: 'start',
                            bufferLength: operationsByResourceTypeMap.size
                        }
                });

                this.addOperationForResourceType({
                    requestId,
                    resourceType,
                    resource: doc,
                    operation: {
                        // use an updateOne instead of insertOne to handle concurrency when another entity may have already inserted this entity
                        updateOne: {
                            filter: {
                                _uuid: doc._uuid
                            },
                            update: {
                                $setOnInsert: doc.toJSONInternal()
                            },
                            upsert: true
                        }
                    },
                    operationType: 'insertUniqueId',
                    patches: null,
                    contextData
                });
            }
            if (doc._id) {
                logInfo('_id still present', {
                    args: {
                        source: 'DatabaseBulkInserter.insertOneAsync',
                        doc
                    }
                });
            }
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
            this.addHistoryOperationForResourceType({
                requestId,
                resourceType,
                resource: doc,
                operationType: 'insert', // history operations are blind merges without checking id
                operation: {
                    insertOne: {
                        document: new BundleEntry({
                            id: doc._uuid,
                            resource: doc,
                            request: new BundleRequest({
                                id: userRequestId,
                                method,
                                url: `/${base_version}/${resourceType}/${doc.id}`
                            }),
                            response: patches
                                ? new BundleResponse({
                                      status: '200',
                                      outcome: new OperationOutcome({
                                          issue: patches.map(
                                              (p) =>
                                                  new OperationOutcomeIssue({
                                                      severity: 'information',
                                                      code: 'informational',
                                                      diagnostics: JSON.stringify(p, getCircularReplacer())
                                                  })
                                          )
                                      })
                                  })
                                : null
                        }).toJSONInternal()
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
     * Replaces a document in Mongo with this one
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} uuid
     * @param {Resource} doc
     * @param {boolean} [upsert]
     * @param {MergePatchEntry[]|null} patches
     * @param {Object|null} contextData - Optional context data for resource-specific handling (e.g., Group members)
     * @param {Array} contextData.groupMembers - Group member array (for Group resources)
     * @param {string} contextData.resourceType - Resource type
     * @param {string} contextData.resourceId - Resource ID
     * @returns {Promise<void>}
     */
    async replaceOneAsync (
        {
            requestInfo,
            resourceType,
            uuid,
            doc,
            upsert = false,
            patches,
            contextData = null
        }
    ) {
        assertTypeEquals(doc, Resource);
        assertTypeEquals(requestInfo, FhirRequestInfo);

        const requestId = requestInfo.requestId;

        try {
            assertTypeEquals(doc, Resource);
            // Run preSave handlers FIRST (includes invariant validation)
            doc = await this.preSaveManager.preSaveAsync({ resource: doc });
            handleClickHouseGroupPreSave(doc, contextData);

            assertIsValid(doc._uuid, `No uuid found for ${doc.resourceType}/${doc.id}`);

            // see if there are any other pending updates for this doc
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const pendingUpdates = this.getPendingUpdates({ requestId, resourceType })
                .filter(a => a.uuid === doc._uuid);
            // noinspection JSValidateTypes
            /**
             * @type {BulkInsertUpdateEntry|null}
             */
            const previousUpdate = pendingUpdates.length > 0 ? pendingUpdates[pendingUpdates.length - 1] : null;
            if (previousUpdate) {
                // don't merge but replace
                previousUpdate.resource = doc;
                previousUpdate.operation.replaceOne.replacement = doc.toJSONInternal();
                // replace without a filter so we replace regardless of version in db
                previousUpdate.operation.replaceOne.filter = null;
            } else {
                /**
                 * @type {BulkInsertUpdateEntry[]}
                 */
                const pendingInserts = this.getPendingInsertsWithUniqueId({ requestId, resourceType })
                    .filter(a => a.uuid === doc._uuid);
                // noinspection JSValidateTypes
                /**
                 * @type {BulkInsertUpdateEntry|null}
                 */
                const previousInsert = pendingInserts.length > 0 ? pendingInserts[pendingInserts.length - 1] : null;
                if (previousInsert) {
                    previousInsert.resource = doc;
                    previousInsert.operation.updateOne.update.$setOnInsert = doc.toJSONInternal();
                } else { // no previuous insert or update found
                    const filter = { _uuid: uuid };
                    // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
                    this.addOperationForResourceType({
                            requestId,
                            resourceType,
                            resource: doc,
                            operationType: 'replace',
                            operation: {
                                replaceOne: {
                                    filter,
                                    upsert,
                                    replacement: doc.toJSONInternal()
                                }
                            },
                            patches,
                            contextData
                        }
                    );
                }
            }
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string|null} previousVersionId
     * @param {Resource} doc
     * @param {boolean} [upsert]
     * @param {MergePatchEntry[]|null} patches
     * @param {Object|null} contextData - Optional context data for resource-specific handling
     * @returns {Promise<void>}
     */
    async mergeOneAsync (
        {
            base_version,
            requestInfo,
            resourceType,
            previousVersionId,
            doc,
            upsert = false,
            patches,
            contextData = null
        }
    ) {
        assertTypeEquals(doc, Resource);
        assertTypeEquals(requestInfo, FhirRequestInfo);

        const requestId = requestInfo.requestId;
        const lastVersionId = previousVersionId;
        try {
            assertTypeEquals(doc, Resource);
            // Run preSave handlers FIRST (includes invariant validation)
            doc = await this.preSaveManager.preSaveAsync({ resource: doc });
            handleClickHouseGroupPreSave(doc, contextData);

            assertIsValid(doc._uuid, `No uuid found for ${doc.resourceType}/${doc.id}`);

            // see if there are any other pending updates for this doc
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const pendingUpdates = this.getPendingUpdates({ requestId, resourceType })
                .filter(a => a.uuid === doc._uuid);
            // noinspection JSValidateTypes
            /**
             * @type {BulkInsertUpdateEntry|null}
             */
            const previousUpdate = pendingUpdates.length > 0 ? pendingUpdates[pendingUpdates.length - 1] : null;
            if (previousUpdate) {
                /**
                 * @type {Resource}
                 */
                const previousResource = previousUpdate.resource;
                /**
                 * returns null if doc is the same
                 * @type {Resource|null}
                 */
                const { updatedResource, patches: mergePatches } = await this.resourceMerger.mergeResourceAsync(
                    {
                        base_version,
                        requestInfo,
                        currentResource: previousResource,
                        resourceToMerge: doc,
                        incrementVersion: false
                    }
                );
                if (updatedResource) {
                    doc = updatedResource;
                    previousUpdate.resource = doc;
                    previousUpdate.operation.replaceOne.replacement = doc.toJSONInternal();
                    previousUpdate.patches = [...previousUpdate.patches, mergePatches];
                } else {
                    // no change so ignore
                }
            } else {
                /**
                 * @type {BulkInsertUpdateEntry[]}
                 */
                const pendingInserts = this.getPendingInsertsWithUniqueId({ requestId, resourceType })
                    .filter(a => a.uuid === doc._uuid);
                // noinspection JSValidateTypes
                /**
                 * @type {BulkInsertUpdateEntry|null}
                 */
                const previousInsert = pendingInserts.length > 0 ? pendingInserts[pendingInserts.length - 1] : null;
                if (previousInsert) {
                    /**
                     * @type {Resource}
                     */
                    const previousResource = previousInsert.resource;
                    /**
                     * returns null if doc is the same
                     * @type {Resource|null}
                     */
                    const { updatedResource } = await this.resourceMerger.mergeResourceAsync({
                        base_version,
                        requestInfo,
                        currentResource: previousResource,
                        resourceToMerge: doc,
                        incrementVersion: false
                    });
                    if (updatedResource) {
                        doc = updatedResource;
                        previousInsert.resource = doc;
                        previousInsert.operation.updateOne.update.$setOnInsert = doc.toJSONInternal();
                    } else {
                        // no change so ignore
                    }
                } else { // no previuous insert or update found
                    const filter = lastVersionId && lastVersionId !== '0'
                        ? { $and: [{ _uuid: doc._uuid }, { 'meta.versionId': `${lastVersionId}` }] }
                        : { _uuid: doc._uuid };
                    assertIsValid(!lastVersionId || lastVersionId < parseInt(doc.meta.versionId),
                        `lastVersionId ${lastVersionId} is not less than doc versionId ${doc.meta.versionId}` +
                        `, doc: ${JSON.stringify(doc.toJSONInternal(), getCircularReplacer())}`);
                    // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
                    this.addOperationForResourceType({
                            requestId,
                            resourceType,
                            resource: doc,
                            operationType: 'merge',
                            operation: {
                                replaceOne: {
                                    filter,
                                    upsert,
                                    replacement: doc.toJSONInternal()
                                }
                            },
                            patches,
                            contextData
                        }
                    );
                }
            }
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
     * Executes all the history operations in bulk
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<void>}
     */
    async executeHistoryAsync ({ requestInfo, base_version }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({ requestId });
        if (historyOperationsByResourceTypeMap.size > 0) {
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
        return executor.executeBulkAsync({
            resourceType, operations, requestInfo, base_version,
            useHistoryCollection, maintainOrder, isAccessLogOperation,
            insertOneHistoryFn: this.insertOneHistoryAsync.bind(this)
        });
    }

    /**
     * Gets list of pending inserts for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingInsertsWithUniqueId ({ requestId, resourceType }) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({ requestId }).get(resourceType);
        return operationsByResourceType
            ? operationsByResourceType.filter(operation => operation.operationType === 'insertUniqueId')
            : [];
    }

    /**
     * Gets list of pending updates for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingUpdates ({ requestId, resourceType }) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({ requestId }).get(resourceType);
        return operationsByResourceType
            ? operationsByResourceType.filter(operation => operation.isUpdateOperation)
            : [];
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * A function that adds a operation to be performed on any document to the requestSpecificCache
     * @param {String} requestId
     * @param {Resource} resource
     * @param {String} fieldName - field that is to be patched
     * @param {Object} fieldValue - The new document with which the field is to be updated
     * @param {boolean} upsert - If true a new document is created if filter is not matched
     */
    async patchFieldAsync ({
                              requestId, resource, fieldName, fieldValue, upsert = false
                          }) {
        if (resource._id) {
            delete resource._id;
        }
        this.addOperationForResourceType({
            requestId,
            resourceType: resource.resourceType,
            resource,
            operationType: 'merge',
            operation: {
                updateOne: {
                    filter: {
                        _uuid: resource._uuid
                    },
                    upsert,
                    update: {
                        $set: { [fieldName]: fieldValue }
                    }
                }
            },
            patches: null
        });
    }
}

module.exports = {
    DatabaseBulkInserter
};
