'use strict';
const async = require('async');
const { EventEmitter } = require('events');
const { logVerboseAsync, logInfo, logError } = require('../operations/common/logging');
const { logSystemErrorAsync, logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const { ResourceManager } = require('../operations/common/resourceManager');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const { RethrownError } = require('../utils/rethrownError');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { DatabaseUpdateFactory } = require('./databaseUpdateFactory');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { ConfigManager } = require('../utils/configManager');
const { getCircularReplacer } = require('../utils/getCircularReplacer');
const { MergeResultEntry } = require('../operations/common/mergeResultEntry');
const { BulkInsertUpdateEntry } = require('./bulkInsertUpdateEntry');
const { PostSaveProcessor } = require('./postSaveProcessor');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { ACCESS_LOGS_COLLECTION_NAME, MONGO_ERROR } = require('../constants');
const BundleEntryWriteSerializer = require('../fhir/writeSerializers/4_0_0/backboneElements/bundleEntry.js');

/**
 * Configuration for resources that need array field stripping for ClickHouse hybrid storage
 * Resources with large arrays (>16MB MongoDB limit) store metadata in MongoDB, array data in ClickHouse
 *
 * Currently configured: Group.member
 * Future: List.entry would follow the same pattern if needed
 *
 * NOTE: Other ClickHouse resources (AuditEvent, MeasureReport, Observation) write directly
 * to ClickHouse event logs without MongoDB storage, so don't need this stripping pattern.
 */
const ARRAY_STRIPPING_CONFIG = {
    Group: { field: 'member', contextKey: 'GROUP_MEMBERS' }
    // List: { field: 'entry', contextKey: 'LIST_ENTRIES' } // Add when needed
};
const { MongoInvalidArgumentError } = require('mongodb');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../fhir/fhirResourceWriteSerializer');
const { FastDatabaseUpdateManager } = require('./fastDatabaseUpdateManager.js');

/**
 * @classdesc This class accepts inserts and updates and when executeAsync() is called it sends them to Mongo in bulk
 */
class FastDatabaseBulkInserter extends EventEmitter {
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
     */
    constructor({
        resourceManager,
        postRequestProcessor,
        resourceLocatorFactory,
        preSaveManager,
        requestSpecificCache,
        databaseUpdateFactory,
        resourceMerger,
        configManager,
        postSaveProcessor
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
    }

    /**
     * Handles array field stripping for ClickHouse-backed resources with large arrays
     * This prevents 16MB MongoDB document size limit errors
     *
     * Generic implementation that works for any resource type configured in ARRAY_STRIPPING_CONFIG.
     * Currently handles Group.member, easily extensible to List.entry or similar patterns.
     *
     * @param {Object} resource - FHIR resource being saved
     * @param {string} requestId - Request ID for httpContext storage
     * @param {Object|null} contextData - Optional context data (preferred over httpContext)
     * @param {Array} contextData.groupMembers - Array data (e.g., Group members, List entries)
     * @param {string} contextData.resourceType - Resource type
     * @param {string} contextData.resourceId - Resource ID
     * @returns {Object} Resource with array field stripped (if applicable)
     * @private
     */
    _handleArrayFieldStripping({ resource, requestId, contextData = null }) {
        // Check if this resource type needs array stripping
        const config = ARRAY_STRIPPING_CONFIG[resource.resourceType];
        if (!config) {
            return resource; // Resource not configured for array stripping
        }

        if (
            !this.configManager.enableClickHouse ||
            !this.configManager.mongoWithClickHouseResources.includes(resource.resourceType)
        ) {
            return resource;
        }

        // Get array data from contextData (preferred) or resource field (fallback)
        const fieldName = config.field;
        const contextFieldName = `${resource.resourceType.toLowerCase()}${config.field.charAt(0).toUpperCase()}${config.field.slice(1)}s`;
        const arrayData = contextData?.[contextFieldName] || resource[fieldName] || [];

        // Strip array from resource (hybrid storage: MongoDB stores metadata, ClickHouse stores array data)
        // This prevents 16MB document size limit errors for large arrays
        // Array data is passed to post-save handler via contextData parameter (explicit threading)
        // IMPORTANT: Modify in place to preserve Resource type
        resource[fieldName] = [];

        return resource;
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getOperationsByResourceTypeMap({ requestId }) {
        return this.requestSpecificCache.getMap({ requestId, name: 'OperationsByResourceTypeMap' });
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getHistoryOperationsByResourceTypeMap({ requestId }) {
        return this.requestSpecificCache.getMap({ requestId, name: 'HistoryOperationsByResourceTypeMap' });
    }

    /**
     * Adds an operation
     * @param {string | null} requestId
     * @param {string} resourceType
     * @param {Object} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {MergePatchEntry[]|null} patches
     * @private
     */
    addOperationForResourceType({
        requestId,
        resourceType,
        resource,
        operationType,
        operation,
        patches,
        contextData = null
    }) {
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(resourceType, `resourceType: ${resourceType} is null`);
        assertIsValid(resource, `resource: ${resource} is null`);
        assertIsValid(operation, `operation: ${operation} is null`);
        assertIsValid(!(operation.insertOne && typeof operation.insertOne.document !== 'object'));
        assertIsValid(
            !(
                operation.updateOne &&
                operation.updateOne.replacement &&
                typeof operation.updateOne.replacement !== 'object'
            )
        );
        assertIsValid(
            !(
                operation.updateOne &&
                operation.updateOne.$setOnInsert &&
                typeof operation.updateOne.$setOnInsert !== 'object'
            )
        );
        assertIsValid(!(operation.replaceOne && typeof operation.replaceOne.replacement !== 'object'));
        assertIsValid(resource.id, `resource id is not set: ${JSON.stringify(resource)}`);
        assertIsValid(resource._uuid, `resource _uuid is not set: ${JSON.stringify(resource)}`);
        // If there is no entry for this collection then create one
        const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({ requestId });
        if (!operationsByResourceTypeMap.has(resourceType)) {
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
     * @param {Object} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {MergePatchEntry[]|null} patches
     * @private
     */
    addHistoryOperationForResourceType({
        requestId,
        resourceType,
        resource,
        operationType,
        operation,
        patches,
        contextData = null
    }) {
        // If there is no entry for this collection then create one
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({ requestId });
        if (!historyOperationsByResourceTypeMap.has(resourceType)) {
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
            })
        );
    }

    /**
     * Inserts item into collection without checking if item exists
     * @typedef {Object} getOperationForResourceAsyncParam
     * @property {string} requestId
     * @property {string} resourceType
     * @property {Object} doc
     * @property {string} operationType
     * @property {import('mongodb').AnyBulkWriteOperation} operation
     * @property {MergePatchEntry[]|null} patches
     * @property {boolean} isAccessLogOperation
     * @property {Object|null} contextData
     *
     * @param {getOperationForResourceAsyncParam}
     * @returns {BulkInsertUpdateEntry}
     */
    getOperationForResourceAsync({
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
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {Object} doc
     * @param {Object|null} contextData - Optional context data for resource-specific handling
     * @returns {Promise<void>}
     */
    async insertOneAsync({ requestInfo, resourceType, doc, contextData = null }) {
        try {
            if (!doc.meta) {
                doc.meta = {};
            }
            if (!doc.meta.versionId || isNaN(parseInt(doc.meta.versionId))) {
                doc.meta.versionId = '1';
            }
            // Run preSave handlers FIRST (includes invariant validation)
            doc = await this.preSaveManager.preSaveAsync({ resource: doc });
            // THEN handle array field stripping for ClickHouse hybrid storage (Group, List, etc.)
            doc = this._handleArrayFieldStripping({ resource: doc, requestId: requestInfo.requestId, contextData });

            assertIsValid(doc._uuid, `No uuid found for ${doc.resourceType}/${doc.id}`);
            // check to see if we already have this insert and if so use replace
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
            if (
                operationsByResourceType &&
                operationsByResourceType.filter(
                    (bulkEntry) => bulkEntry.uuid === doc._uuid && bulkEntry.operationType === 'insertUniqueId'
                ).length > 0
            ) {
                const previousVersionId = 1;
                await this.mergeOneAsync({
                    requestInfo,
                    resourceType,
                    doc,
                    previousVersionId: `${previousVersionId}`,
                    patches: null,
                    contextData
                });
            } else {
                // else insert it
                await logVerboseAsync({
                    source: 'DatabaseBulkInserter.insertOneAsync',
                    args: {
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
                                $setOnInsert: doc
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
     * @param {Object} doc
     * @param {MergePatchEntry[]|null} patches
     * @param {Object|null} contextData Optional context data for resource-specific handling
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync({ requestInfo, base_version, resourceType, doc, patches, contextData = null }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const userRequestId = requestInfo.userRequestId;
        const method = requestInfo.method;
        try {
            const historyResource = {
                id: doc._uuid,
                resource: doc,
                request: {
                    id: userRequestId,
                    method,
                    url: `/${base_version}/${resourceType}/${doc.id}`
                },
                response: patches
                    ? {
                            status: '200',
                            outcome: {
                                resourceType: 'OperationOutcome',
                                issue: patches.map((p) => ({
                                    severity: 'information',
                                    code: 'informational',
                                    diagnostics: JSON.stringify(p)
                                }))
                            }
                        }
                    : null
            }

            FhirResourceWriteSerializer.serialize({obj: historyResource, SerializerClass: BundleEntryWriteSerializer});

            this.addHistoryOperationForResourceType({
                requestId,
                resourceType,
                resource: doc,
                operationType: 'insert', // history operations are blind merges without checking id
                operation: {
                    insertOne: {
                        document: historyResource
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
     * @param {string|null} previousVersionId
     * @param {Object} doc
     * @param {boolean} [upsert]
     * @param {MergePatchEntry[]|null} patches
     * @param {Object|null} contextData - Optional context data for resource-specific handling
     * @returns {Promise<void>}
     */
    async mergeOneAsync({
        requestInfo,
        resourceType,
        previousVersionId,
        doc,
        upsert = false,
        patches,
        contextData = null
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);

        const requestId = requestInfo.requestId;
        const lastVersionId = previousVersionId;
        try {
            // Run preSave handlers FIRST (includes invariant validation)
            doc = await this.preSaveManager.preSaveAsync({ resource: doc });

            // handle array field stripping for ClickHouse hybrid storage (Group, List, etc.)
            doc = this._handleArrayFieldStripping({ resource: doc, requestId: requestInfo.requestId, contextData });

            assertIsValid(doc._uuid, `No uuid found for ${doc.resourceType}/${doc.id}`);

            // see if there are any other pending updates for this doc
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const pendingUpdates = this.getPendingUpdates({ requestId, resourceType }).filter(
                (a) => a.uuid === doc._uuid
            );
            // noinspection JSValidateTypes
            /**
             * @type {BulkInsertUpdateEntry|null}
             */
            const previousUpdate = pendingUpdates.length > 0 ? pendingUpdates[pendingUpdates.length - 1] : null;
            if (previousUpdate) {
                /**
                 * @type {Object}
                 */
                const previousResource = previousUpdate.resource;
                /**
                 * returns null if doc is the same
                 * @type {Object|null}
                 */
                const { updatedResource, patches: mergePatches } = await this.resourceMerger.fastMergeResourceAsync({
                    requestInfo,
                    currentResource: previousResource,
                    resourceToMerge: doc,
                    incrementVersion: false
                });
                if (updatedResource) {
                    doc = updatedResource;
                    previousUpdate.resource = doc;
                    previousUpdate.operation.replaceOne.replacement = doc;
                    previousUpdate.patches = [...previousUpdate.patches, mergePatches];
                } else {
                    // no change so ignore
                }
            } else {
                /**
                 * @type {BulkInsertUpdateEntry[]}
                 */
                const pendingInserts = this.getPendingInsertsWithUniqueId({ requestId, resourceType }).filter(
                    (a) => a.uuid === doc._uuid
                );
                // noinspection JSValidateTypes
                /**
                 * @type {BulkInsertUpdateEntry|null}
                 */
                const previousInsert = pendingInserts.length > 0 ? pendingInserts[pendingInserts.length - 1] : null;
                if (previousInsert) {
                    /**
                     * @type {Object}
                     */
                    const previousResource = previousInsert.resource;
                    /**
                     * returns null if doc is the same
                     * @type {Object|null}
                     */
                    const { updatedResource } = await this.resourceMerger.fastMergeResourceAsync({
                        requestInfo,
                        currentResource: previousResource,
                        resourceToMerge: doc,
                        incrementVersion: false
                    });
                    if (updatedResource) {
                        doc = updatedResource;
                        previousInsert.resource = doc;
                        previousInsert.operation.updateOne.update.$setOnInsert = doc;
                    } else {
                        // no change so ignore
                    }
                } else {
                    // no previuous insert or update found
                    const filter =
                        lastVersionId && lastVersionId !== '0'
                            ? { $and: [{ _uuid: doc._uuid }, { 'meta.versionId': `${lastVersionId}` }] }
                            : { _uuid: doc._uuid };
                    assertIsValid(
                        !lastVersionId || lastVersionId < parseInt(doc.meta.versionId),
                        `lastVersionId ${lastVersionId} is not less than doc versionId ${doc.meta.versionId}` +
                            `, doc: ${JSON.stringify(doc)}`
                    );
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
                                replacement: doc
                            }
                        },
                        patches,
                        contextData
                    });
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
    async executeAsync({
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
                args: {
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
                async (mapEntry) =>
                    await this.performBulkForResourceTypeWithMapEntryAsync({
                        requestInfo,
                        mapEntry,
                        base_version,
                        useHistoryCollection: false,
                        maintainOrder,
                        isAccessLogOperation
                    })
            );

            if (!operationsMap) {
                await this.executeHistoryInPostRequestAsync({
                    requestInfo,
                    base_version
                });
            }

            operationsByResourceTypeMap.clear();

            await logVerboseAsync({
                source: 'DatabaseBulkInserter.executeAsync',
                args: {
                    message: 'end',
                    bufferLength: operationsByResourceTypeMap.size
                }
            });
            return resultsByResourceType.flatMap((r) => r.mergeResultEntries);
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
    async executeHistoryInPostRequestAsync({ requestInfo, base_version }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({ requestId });
        if (historyOperationsByResourceTypeMap.size > 0) {
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await async.map(
                        historyOperationsByResourceTypeMap.entries(),
                        async (x) =>
                            await this.performBulkForResourceTypeWithMapEntryAsync({
                                requestInfo,
                                mapEntry: x,
                                base_version,
                                useHistoryCollection: true
                            })
                    );
                    historyOperationsByResourceTypeMap.clear();
                }
            });
        }
    }

    /**
     * Executes all the history operations in bulk
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<void>}
     */
    async executeHistoryAsync({ requestInfo, base_version }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({ requestId });
        if (historyOperationsByResourceTypeMap.size > 0) {
            await async.map(
                historyOperationsByResourceTypeMap.entries(),
                async (x) =>
                    await this.performBulkForResourceTypeWithMapEntryAsync({
                        requestInfo,
                        mapEntry: x,
                        base_version,
                        useHistoryCollection: true
                    })
            );
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
    async performBulkForResourceTypeWithMapEntryAsync({
        base_version,
        requestInfo,
        mapEntry,
        useHistoryCollection,
        maintainOrder = true,
        isAccessLogOperation = false
    }) {
        try {
            const [/** @type {string} */ resourceType, /** @type {BulkInsertUpdateEntry[]} */ operations] = mapEntry;

            return await this.performBulkForResourceTypeAsync({
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
     * Run bulk operations for collection of resourceType
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {boolean|null} useHistoryCollection
     * @param {BulkInsertUpdateEntry[]} operations
     * @param {boolean} maintainOrder
     * @param {boolean} isAccessLogOperation
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeAsync({
        resourceType,
        base_version,
        useHistoryCollection,
        operations,
        requestInfo,
        maintainOrder = true,
        isAccessLogOperation = false
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        try {
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
            const operationsByCollectionNames = new Map();
            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType,
                base_version
            });
            for (const /** @type {BulkInsertUpdateEntry} */ operation of operations) {
                /**
                 * @type {Object}
                 */
                const resource = operation.resource;
                assertIsValid(resource, 'resource is null');
                /**
                 * @type {string}
                 */
                const collectionName = isAccessLogOperation
                    ? ACCESS_LOGS_COLLECTION_NAME
                    : useHistoryCollection
                      ? resourceLocator.getHistoryCollectionNameForResource(resource.resource || resource)
                      : resourceLocator.getCollectionNameForResource(resource);
                if (!operationsByCollectionNames.has(collectionName)) {
                    operationsByCollectionNames.set(`${collectionName}`, []);
                }

                if (!useHistoryCollection && resource._id) {
                    logInfo('_id still present', {
                        args: {
                            source: 'DatabaseBulkInserter.performBulkForResourceTypeAsync',
                            doc: resource,
                            collection: collectionName,
                            operation
                        }
                    });
                }
                operationsByCollectionNames.get(collectionName).push(operation);
            }

            // preserve order so inserts come before updates
            /**
             * @type {import('mongodb').BulkWriteOptions|null}
             */
            let options = { ordered: true };

            if (!maintainOrder) {
                options = { ordered: false };
            }
            /**
             * @type {import('mongodb').BulkWriteResult|undefined}
             */
            let bulkWriteResult;

            /**
             *
             * @type {MergeResultEntry[]}
             */
            const mergeResultEntries = [];
            for (const operationsByCollectionName of operationsByCollectionNames) {
                const [
                    /** @type {string} */ collectionName,
                    /** @type {BulkInsertUpdateEntry[]} */
                    operationsByCollection
                ] = operationsByCollectionName;

                try {
                    /**
                     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
                     */
                    const collection = isAccessLogOperation
                        ? await resourceLocator.getAccessLogCollectionAsync()
                        : await resourceLocator.getCollectionByNameAsync(collectionName);
                    /**
                     * @type {BulkInsertUpdateEntry[]}
                     */
                    const expectedInsertsByUniqueId = operationsByCollection.filter(
                        (o) => o.operationType === 'insertUniqueId'
                    );
                    const expectedInsertsByUniqueIdCount = expectedInsertsByUniqueId.length;
                    /**
                     * @type {BulkInsertUpdateEntry[]}
                     */
                    const expectedUpdates = operationsByCollection.filter((o) => o.isUpdateOperation);
                    /**
                     * @type {number}
                     */
                    const expectedUpdatesCount = expectedUpdates.length;
                    /**
                     * @type {(import('mongodb').AnyBulkWriteOperation)[]}
                     */
                    const bulkOperations = operationsByCollection.map((o) => o.operation);
                    await logTraceSystemEventAsync({
                        event: 'bulkWriteBegin' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                        message: 'Begin Bulk Write',
                        args: {
                            resourceType,
                            collectionName,
                            operationsByCollection,
                            requestId
                        }
                    });
                    /**
                     * @type {import('mongodb').BulkWriteResult}
                     */
                    let result;
                    try {
                        result = await collection.bulkWrite(bulkOperations, options);
                    } catch (error) {
                        await logSystemErrorAsync({
                            event: 'databaseBulkInserter',
                            message: 'databaseBulkInserter: Error bulkWrite',
                            error,
                            args: {
                                requestId,
                                operations: operationsByCollection,
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
                            error.message === MONGO_ERROR.RESOURCE_SIZE_EXCEEDS
                        ) {
                            diagnostics = error.toString();
                        } else {
                            throw new RethrownError({ message: 'databaseBulkInserter: Error bulkWrite', error });
                        }

                        diagnostics = `Error in one of the resources of ${resourceType}: ` + diagnostics;
                        const bulkWriteResultError = new Error(diagnostics);
                        for (const operationByCollection of operationsByCollection) {
                            const mergeResultEntry = new MergeResultEntry({
                                id: operationByCollection.id,
                                uuid: operationByCollection.uuid,
                                sourceAssigningAuthority: operationByCollection.sourceAssigningAuthority,
                                created: false,
                                updated: false,
                                resourceType,
                                issue: new OperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'exception',
                                    details: new CodeableConcept({ text: bulkWriteResultError.message }),
                                    diagnostics
                                })
                            });
                            mergeResultEntries.push(mergeResultEntry);
                        }

                        return { resourceType, mergeResult: bulkWriteResult, error: error, mergeResultEntries };
                    }
                    bulkWriteResult = result;
                    await logTraceSystemEventAsync({
                        event: 'bulkWriteResult' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                        message: 'Result of Bulk Write',
                        args: {
                            resourceType,
                            collectionName,
                            operationsByCollection,
                            result,
                            requestId
                        }
                    });

                    // https://www.mongodb.com/docs/manual/reference/method/BulkWriteResult/
                    /**
                     * @type {number}
                     */
                    const actualInsertsByUniqueIdCount = bulkWriteResult.upsertedCount;

                    // 1. check if we got same number of inserts as we expected
                    //      If we did not, it means someone else inserted this resource.  Then we have to use update instead of insert
                    if (
                        this.configManager.handleConcurrency &&
                        expectedInsertsByUniqueIdCount > 0 &&
                        expectedInsertsByUniqueIdCount > actualInsertsByUniqueIdCount
                    ) {
                        await logTraceSystemEventAsync({
                            event:
                                'bulkWriteConcurrency' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                            message: 'Insert count not matched so running updates one by one',
                            args: {
                                resourceType,
                                collectionName,
                                expectedInsertsByUniqueId,
                                actualInsertsByUniqueIdCount,
                                expectedInsertsByUniqueIdCount,
                                bulkWriteResult
                            }
                        });
                        // do inserts/updates one by one
                        await this.updateResourcesOneByOneAsync({
                            base_version,
                            requestInfo,
                            bulkInsertUpdateEntries: expectedInsertsByUniqueId
                        });
                    }
                    // 2. Now check if we got the same number of updates as we expected.
                    //      If we did not, it means someone else updated the version of the resources we were updating
                    // NOTE: Mongo does NOT return ids of updated resources so we have to go through each
                    //       document to see if it is same in db as we have it
                    // https://www.mongodb.com/docs/manual/reference/method/BulkWriteResult/
                    // nMatched: The number of existing documents selected for update or replacement.
                    // If the update/replacement operation results in no change to an existing document,
                    // e.g. $set expression updates the value to the current value,
                    // nMatched can be greater than nModified.
                    // insertsByUniqueId are also matches so subtract that count to get count of matches for updates
                    /**
                     * @type {number}
                     */
                    const actualUpdatesCount = bulkWriteResult.modifiedCount;
                    if (
                        this.configManager.handleConcurrency &&
                        expectedUpdatesCount > 0 &&
                        actualUpdatesCount < expectedUpdatesCount
                    ) {
                        // concurrency check failed (another parallel process updated atleast one resource)
                        // process one by one
                        await logTraceSystemEventAsync({
                            event:
                                'bulkWriteConcurrency' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                            message: 'Update count not matched so running updates one by one',
                            args: {
                                resourceType,
                                collectionName,
                                expectedUpdates,
                                actualUpdatesCount,
                                expectedUpdatesCount,
                                bulkWriteResult
                            }
                        });
                        await this.updateResourcesOneByOneAsync({
                            base_version,
                            requestInfo,
                            bulkInsertUpdateEntries: expectedUpdates
                        });
                    }

                    // 3. Call postSaveAsync for each operation
                    for (const operationByCollection of operationsByCollection) {
                        mergeResultEntries.push(
                            await this.postSaveAsync({
                                base_version,
                                requestInfo,
                                resourceType,
                                bulkInsertUpdateEntry: operationByCollection,
                                bulkWriteResult,
                                useHistoryCollection,
                                isAccessLogOperation
                            })
                        );
                    }
                } catch (e) {
                    await logSystemErrorAsync({
                        event: 'databaseBulkInserter',
                        message: 'databaseBulkInserter: Error bulkWrite',
                        error: e,
                        args: {
                            requestId,
                            operations: operationsByCollection,
                            options,
                            collection: collectionName
                        }
                    });
                    throw new RethrownError({
                        error: e
                    });
                }
            }
            return { resourceType, mergeResult: bulkWriteResult, error: null, mergeResultEntries };
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @param {string} resourceType
     * @param {BulkInsertUpdateEntry} bulkInsertUpdateEntry
     * @param {import('mongodb').BulkWriteResult} bulkWriteResult
     * @param {boolean} useHistoryCollection
     * @param {boolean} isAccessLogOperation
     * @returns {Promise<MergeResultEntry>}
     */
    async postSaveAsync({
        requestInfo,
        base_version,
        resourceType,
        bulkInsertUpdateEntry,
        bulkWriteResult,
        useHistoryCollection,
        isAccessLogOperation = false
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
        await logTraceSystemEventAsync({
            event: 'postSaveAsync' + `_${resourceType}`,
            message: 'Post Save',
            args: {
                resourceType,
                requestId,
                bulkInsertUpdateEntry,
                bulkWriteResult,
                skipped: bulkInsertUpdateEntry.skipped,
                useHistoryCollection
            }
        });
        if (
            !bulkInsertUpdateEntry.skipped &&
            resourceType !== 'AuditEvent' &&
            !useHistoryCollection &&
            !isAccessLogOperation
        ) {
            await this.insertOneHistoryAsync({
                requestInfo,
                base_version,
                resourceType,
                doc: deepcopy(bulkInsertUpdateEntry.resource),
                patches: bulkInsertUpdateEntry.patches
            });
        }
        const hasBulkWriteErrors = bulkWriteResult.hasWriteErrors();
        /**
         * @type {MergeResultEntry}
         */
        const mergeResultEntry = new MergeResultEntry({
            id: bulkInsertUpdateEntry.id,
            uuid: bulkInsertUpdateEntry.uuid,
            sourceAssigningAuthority: bulkInsertUpdateEntry.sourceAssigningAuthority,
            created: bulkInsertUpdateEntry.isCreateOperation && !hasBulkWriteErrors && !bulkInsertUpdateEntry.skipped,
            updated: bulkInsertUpdateEntry.isUpdateOperation && !hasBulkWriteErrors && !bulkInsertUpdateEntry.skipped,
            resourceType
        });
        if (hasBulkWriteErrors) {
            const bulkWriteErrors = bulkWriteResult.getWriteErrors();
            const bulkWriteErrorsMsg = bulkWriteErrors.map((error) => error.toJSON());
            const diagnostics = JSON.stringify(bulkWriteErrorsMsg, getCircularReplacer());
            const bulkWriteResultError = new Error(diagnostics);
            mergeResultEntry.issue = new OperationOutcomeIssue({
                severity: 'error',
                code: 'exception',
                details: new CodeableConcept({ text: bulkWriteResultError.message }),
                diagnostics,
                expression: [resourceType + '/' + bulkInsertUpdateEntry.uuid]
            });
            logError(`databaseBulkInserter: Error resource ${resourceType}`, {
                args: {
                    error: bulkWriteResult.getWriteErrors(),
                    source: 'databaseBulkInserter',
                    requestId,
                    resourceType,
                    operation: bulkInsertUpdateEntry
                }
            });
        }

        // fire change events
        if (
            !bulkInsertUpdateEntry.skipped &&
            resourceType !== 'AuditEvent' &&
            !useHistoryCollection &&
            !isAccessLogOperation
        ) {
            const eventType = bulkInsertUpdateEntry.isCreateOperation ? 'C' : 'U';
            const contextData = bulkInsertUpdateEntry.contextData || null;

            const afterSaveTask = async () =>
                await this.postSaveProcessor.afterSaveAsync({
                    requestId,
                    eventType,
                    resourceType,
                    doc: bulkInsertUpdateEntry.resource,
                    contextData
                });

            // Check if any handler needs sync mode for this resource
            const needsSync = this.postSaveProcessor.needsSyncFor({ resourceType });

            if (needsSync) {
                // Sync mode: Block API response until hybrid storage write completes
                // (e.g., ClickHouse write for Group members must complete before returning)
                await afterSaveTask();
            } else {
                // Async mode: Defer to post-request processor
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: afterSaveTask
                });
            }
        }

        return mergeResultEntry;
    }

    /**
     * Gets list of pending inserts for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingInsertsWithUniqueId({ requestId, resourceType }) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({ requestId }).get(resourceType);
        return operationsByResourceType
            ? operationsByResourceType.filter((operation) => operation.operationType === 'insertUniqueId')
            : [];
    }

    /**
     * Gets list of pending updates for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingUpdates({ requestId, resourceType }) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({ requestId }).get(resourceType);
        return operationsByResourceType
            ? operationsByResourceType.filter((operation) => operation.isUpdateOperation)
            : [];
    }

    /**
     * Updates resources one by one
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {BulkInsertUpdateEntry[]} bulkInsertUpdateEntries
     * @returns {Promise<void>}
     */
    async updateResourcesOneByOneAsync({ base_version, requestInfo, bulkInsertUpdateEntries }) {
        // let i = 0;
        for (const /* @type {BulkInsertUpdateEntry} */ bulkInsertUpdateEntry of bulkInsertUpdateEntries) {
            // i += 1;
            await logTraceSystemEventAsync({
                event: 'updateResourcesOneByOneAsync',
                message: 'Updating resources one by one',
                args: {
                    expectedUpdates: bulkInsertUpdateEntries
                }
            });
            /**
             * @type {FastDatabaseUpdateManager}
             */
            const databaseUpdateManager = this.databaseUpdateFactory.createFastDatabaseUpdateManager({
                resourceType: bulkInsertUpdateEntry.resourceType,
                base_version: '4_0_0'
            });
            /**
             * @type {Object|null}
             */
            const { savedResource, patches } = await databaseUpdateManager.replaceOneAsync({
                base_version,
                requestInfo,
                doc: bulkInsertUpdateEntry.resource
            });
            if (savedResource) {
                bulkInsertUpdateEntry.resource = savedResource;
                bulkInsertUpdateEntry.patches = patches;
            } else {
                // resource was same as what was in the database
                bulkInsertUpdateEntry.skipped = true;
            }
        }
    }
}

module.exports = {
    FastDatabaseBulkInserter
};
