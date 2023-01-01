'use strict';
const async = require('async');
const sendToS3 = require('../utils/aws-s3');
const {EventEmitter} = require('events');
const {logVerboseAsync, logSystemErrorAsync, logTraceSystemEventAsync} = require('../operations/common/logging');
const {ResourceManager} = require('../operations/common/resourceManager');
const {PostRequestProcessor} = require('../utils/postRequestProcessor');
const {ErrorReporter} = require('../utils/slack.logger');
const {MongoCollectionManager} = require('../utils/mongoCollectionManager');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {assertTypeEquals, assertIsValid} = require('../utils/assertType');
const {ChangeEventProducer} = require('../utils/changeEventProducer');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const {RethrownError} = require('../utils/rethrownError');
const {databaseBulkInserterTimer} = require('../utils/prometheus.utils');
const {PreSaveManager} = require('../preSaveHandlers/preSave');
const {RequestSpecificCache} = require('../utils/requestSpecificCache');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const {DatabaseUpdateFactory} = require('./databaseUpdateFactory');
const {ResourceMerger} = require('../operations/common/resourceMerger');
const {ConfigManager} = require('../utils/configManager');
const {getCircularReplacer} = require('../utils/getCircularReplacer');
const Meta = require('../fhir/classes/4_0_0/complex_types/meta');
const BundleResponse = require('../fhir/classes/4_0_0/backbone_elements/bundleResponse');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * @typedef BulkResultEntry
 * @type {object}
 * @property {string} resourceType
 * @property {import('mongodb').BulkWriteOpResultObject|null} mergeResult
 * @property {MergeResultEntry[]|null} mergeResultEntries
 * @property {Error|null} error
 */

/**
 * @typedef {('insert'|'replace'|'merge')} OperationType
 **/

/**
 * @typedef BulkInsertUpdateEntry
 * @type {object}
 * @property {OperationType} operationType
 * @property {string} resourceType
 * @property {string} id
 * @property {Resource} resource
 * @property {import('mongodb').AnyBulkWriteOperation} operation
 * @property {MergePatchEntry[]|undefined|null} patches
 * @property {boolean|undefined} [skipped]
 */


/**
 * This class accepts inserts and updates and when executeAsync() is called it sends them to Mongo in bulk
 */
class DatabaseBulkInserter extends EventEmitter {
    /**
     * Constructor
     * @param {ResourceManager} resourceManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ErrorReporter} errorReporter
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ChangeEventProducer} changeEventProducer
     * @param {PreSaveManager} preSaveManager
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {ResourceMerger} resourceMerger
     * @param {ConfigManager} configManager
     */
    constructor({
                    resourceManager,
                    postRequestProcessor,
                    errorReporter,
                    mongoCollectionManager,
                    resourceLocatorFactory,
                    changeEventProducer,
                    preSaveManager,
                    requestSpecificCache,
                    databaseUpdateFactory,
                    resourceMerger,
                    configManager
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
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
        assertTypeEquals(errorReporter, ErrorReporter);

        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {ChangeEventProducer}
         */
        this.changeEventProducer = changeEventProducer;
        assertTypeEquals(changeEventProducer, ChangeEventProducer);

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
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getOperationsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'OperationsByResourceTypeMap'});
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getHistoryOperationsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'HistoryOperationsByResourceTypeMap'});
    }

    /**
     * Adds an operation
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @param {MergePatchEntry[]|null} patches
     * @private
     */
    addOperationForResourceType(
        {
            requestId,
            resourceType,
            resource,
            operationType,
            operation,
            patches
        }
    ) {
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(resourceType, `resourceType: ${resourceType} is null`);
        assertIsValid(resource, `resource: ${resource} is null`);
        assertIsValid(operation, `operation: ${operation} is null`);
        assertIsValid(!(operation.insertOne && operation.insertOne.document instanceof Resource));
        assertIsValid(!(operation.replaceOne && operation.replaceOne.replacement instanceof Resource));
        assertIsValid(resource.id, `resource id is not set: ${JSON.stringify(resource)}`);
        // If there is no entry for this collection then create one
        const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
        if (!(operationsByResourceTypeMap.has(resourceType))) {
            operationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        operationsByResourceTypeMap.get(resourceType).push({
            id: resource.id,
            resourceType,
            resource,
            operation,
            operationType,
            patches
        });
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
    addHistoryOperationForResourceType(
        {
            requestId,
            resourceType,
            resource,
            operationType,
            operation,
            patches
        }
    ) {
        // If there is no entry for this collection then create one
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({requestId});
        if (!(historyOperationsByResourceTypeMap.has(resourceType))) {
            historyOperationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        historyOperationsByResourceTypeMap.get(resourceType).push({
            id: resource.id,
            resourceType,
            resource,
            operation,
            operationType,
            patches
        });
    }

    /**
     * Inserts item into collection
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async insertOneAsync({requestId, resourceType, doc}) {
        try {
            assertTypeEquals(doc, Resource);
            if (!doc.meta) {
                doc.meta = new Meta({});
            }
            if (!doc.meta.versionId || isNaN(parseInt(doc.meta.versionId))) {
                doc.meta.versionId = '1';
            }
            await this.preSaveManager.preSaveAsync(doc);
            // check to see if we already have this insert and if so use replace
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
            const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const operationsByResourceType = operationsByResourceTypeMap.get(resourceType);
            if (operationsByResourceType &&
                operationsByResourceType.filter(
                    bulkEntry => bulkEntry.id === doc.id &&
                        bulkEntry.operationType === 'insert').length > 0) {
                const previousVersionId = 1;
                await this.mergeOneAsync(
                    {
                        requestId,
                        resourceType, id: doc.id, doc,
                        previousVersionId: `${previousVersionId}`,
                        patches: null
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
                        insertOne: {
                            document: doc.toJSONInternal()
                        }
                    },
                    operationType: 'insert',
                    patches: null
                });
            }
            if (doc._id) {
                await this.errorReporter.reportMessageAsync({
                    source: 'DatabaseBulkInserter.insertOneAsync',
                    message: '_id still present',
                    args: {
                        doc: doc
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
     * @param {string} requestId
     * @param {string} method
     * @param {string} base_version
     * @param {string} resourceType
     * @param {Resource} doc
     * @param {MergePatchEntry[]|null} patches
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync({requestId, method, base_version, resourceType, doc, patches}) {
        try {
            assertTypeEquals(doc, Resource);
            this.addHistoryOperationForResourceType({
                    requestId,
                    resourceType,
                    resource: doc,
                    operationType: 'insert',
                    operation: {
                        insertOne: {
                            document: new BundleEntry(
                                {
                                    id: doc.id,
                                    resource: doc,
                                    request: new BundleRequest(
                                        {
                                            id: requestId,
                                            method,
                                            url: `/${base_version}/${resourceType}/${doc.id}`
                                        }
                                    ),
                                    response: patches ?
                                        new BundleResponse(
                                            {
                                                status: '200',
                                                outcome: new OperationOutcome({
                                                        issue: patches.map(p => new OperationOutcomeIssue(
                                                                {
                                                                    severity: 'information',
                                                                    code: 'informational',
                                                                    diagnostics: JSON.stringify(p, getCircularReplacer())
                                                                }
                                                            )
                                                        )
                                                    }
                                                )
                                            }
                                        ) : null
                                }
                            ).toJSONInternal()
                        }
                    },
                    patches
                }
            );
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} requestId
     * @param {string} resourceType
     * @param {string} id
     * @param {string|null} previousVersionId
     * @param {Resource} doc
     * @param {boolean} [upsert]
     * @param {MergePatchEntry[]|null} patches
     * @returns {Promise<void>}
     */
    async replaceOneAsync(
        {
            requestId,
            resourceType,
            id,
            previousVersionId,
            doc,
            upsert = false,
            patches
        }
    ) {
        try {
            assertTypeEquals(doc, Resource);
            await this.preSaveManager.preSaveAsync(doc);

            // see if there are any other pending updates for this doc
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const pendingUpdates = this.getPendingUpdates({requestId, resourceType})
                .filter(a => a.id === doc.id);
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
                previousVersionId = previousResource.meta.versionId;
                /**
                 * returns null if doc is the same
                 * @type {Resource|null}
                 */
                const {updatedResource, patches: mergePatches} = await this.resourceMerger.mergeResourceAsync({
                    currentResource: previousResource,
                    resourceToMerge: doc,
                    incrementVersion: false
                });
                if (!updatedResource) {
                    return; // no change so ignore
                } else {
                    doc = updatedResource;
                    previousUpdate.resource = doc;
                    previousUpdate.operation.replaceOne.replacement = doc.toJSONInternal();
                    previousUpdate.patches = [...previousUpdate.patches, mergePatches];
                }
            } else {
                /**
                 * @type {BulkInsertUpdateEntry[]}
                 */
                const pendingInserts = this.getPendingInserts({requestId, resourceType})
                    .filter(a => a.id === doc.id);
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
                    previousVersionId = previousResource.meta.versionId;
                    /**
                     * returns null if doc is the same
                     * @type {Resource|null}
                     */
                    const {updatedResource} = await this.resourceMerger.mergeResourceAsync({
                        currentResource: previousResource,
                        resourceToMerge: doc,
                        incrementVersion: false
                    });
                    if (!updatedResource) {
                        return; // no change so ignore
                    } else {
                        doc = updatedResource;
                        previousInsert.resource = doc;
                        previousInsert.operation.insertOne.document = doc.toJSONInternal();
                    }
                } else { // no previuous insert or update found
                    const filter = previousVersionId && previousVersionId !== '0' ?
                        {$and: [{id: id.toString()}, {'meta.versionId': `${previousVersionId}`}]} :
                        {id: id.toString()};
                    assertIsValid(!previousVersionId || previousVersionId < parseInt(doc.meta.versionId),
                        `previousVersionId ${previousVersionId} is not less than doc versionId ${doc.meta.versionId}`);
                    // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
                    this.addOperationForResourceType({
                            requestId,
                            resourceType,
                            resource: doc,
                            operationType: 'replace',
                            operation: {
                                replaceOne: {
                                    filter: filter,
                                    upsert: upsert,
                                    replacement: doc.toJSONInternal()
                                }
                            },
                            patches
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
     * @param {string} requestId
     * @param {string} resourceType
     * @param {string} id
     * @param {string|null} previousVersionId
     * @param {Resource} doc
     * @param {boolean} [upsert]
     * @param {MergePatchEntry[]|null} patches
     * @returns {Promise<void>}
     */
    async mergeOneAsync(
        {
            requestId,
            resourceType,
            id,
            previousVersionId,
            doc,
            upsert = false,
            patches
        }
    ) {
        try {
            assertTypeEquals(doc, Resource);
            await this.preSaveManager.preSaveAsync(doc);

            // see if there are any other pending updates for this doc
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const pendingUpdates = this.getPendingUpdates({requestId, resourceType})
                .filter(a => a.id === doc.id);
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
                previousVersionId = previousResource.meta.versionId;
                /**
                 * returns null if doc is the same
                 * @type {Resource|null}
                 */
                const {updatedResource, patches: mergePatches} = await this.resourceMerger.mergeResourceAsync({
                    currentResource: previousResource,
                    resourceToMerge: doc,
                    incrementVersion: false
                });
                if (!updatedResource) {
                    return; // no change so ignore
                } else {
                    doc = updatedResource;
                    previousUpdate.resource = doc;
                    previousUpdate.operation.replaceOne.replacement = doc.toJSONInternal();
                    previousUpdate.patches = [...previousUpdate.patches, mergePatches];
                }
            } else {
                /**
                 * @type {BulkInsertUpdateEntry[]}
                 */
                const pendingInserts = this.getPendingInserts({requestId, resourceType})
                    .filter(a => a.id === doc.id);
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
                    previousVersionId = previousResource.meta.versionId;
                    /**
                     * returns null if doc is the same
                     * @type {Resource|null}
                     */
                    const {updatedResource} = await this.resourceMerger.mergeResourceAsync({
                        currentResource: previousResource,
                        resourceToMerge: doc,
                        incrementVersion: false
                    });
                    if (!updatedResource) {
                        return; // no change so ignore
                    } else {
                        doc = updatedResource;
                        previousInsert.resource = doc;
                        previousInsert.operation.insertOne.document = doc.toJSONInternal();
                    }
                } else { // no previuous insert or update found
                    const filter = previousVersionId && previousVersionId !== '0' ?
                        {$and: [{id: id.toString()}, {'meta.versionId': `${previousVersionId}`}]} :
                        {id: id.toString()};
                    assertIsValid(!previousVersionId || previousVersionId < parseInt(doc.meta.versionId),
                        `previousVersionId ${previousVersionId} is not less than doc versionId ${doc.meta.versionId}`);
                    // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
                    this.addOperationForResourceType({
                            requestId,
                            resourceType,
                            resource: doc,
                            operationType: 'merge',
                            operation: {
                                replaceOne: {
                                    filter: filter,
                                    upsert: upsert,
                                    replacement: doc.toJSONInternal()
                                }
                            },
                            patches
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
     * @param {string} requestId
     * @param {string} currentDate
     * @param {string} method
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync({requestId, currentDate, base_version, method}) {
        assertIsValid(requestId, 'requestId is null');
        try {
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
            const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
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
                        requestId, currentDate,
                        mapEntry: mapEntry,
                        base_version,
                        useHistoryCollection: false,
                        method
                    }
                ));

            await this.executeHistoryInPostRequestAsync({requestId, currentDate, base_version, method});

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
     * @param {string} requestId
     * @param {string} currentDate
     * @param {string} method
     * @returns {Promise<void>}
     */
    async executeHistoryInPostRequestAsync({requestId, currentDate, base_version, method}) {
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({requestId});
        if (historyOperationsByResourceTypeMap.size > 0) {
            this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await async.map(
                            historyOperationsByResourceTypeMap.entries(),
                            async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                                {
                                    requestId, currentDate,
                                    mapEntry: x, base_version,
                                    useHistoryCollection: true,
                                    method
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
     * @param {string} requestId
     * @param {string} currentDate
     * @param {[string, BulkInsertUpdateEntry[]]} mapEntry
     * @param {string} base_version
     * @param {boolean|null} useHistoryCollection
     * @param {string} method
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeWithMapEntryAsync(
        {
            requestId,
            currentDate,
            mapEntry, base_version,
            useHistoryCollection,
            method
        }
    ) {
        try {
            const [
                /** @type {string} */resourceType,
                /** @type {BulkInsertUpdateEntry[]} */ operations
            ] = mapEntry;

            return await this.performBulkForResourceTypeAsync(
                {
                    requestId, currentDate,
                    resourceType, base_version, useHistoryCollection, operations,
                    method
                });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Run bulk operations for collection of resourceType
     * @param {string} requestId
     * @param {string} currentDate
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean|null} useHistoryCollection
     * @param {BulkInsertUpdateEntry[]} operations
     * @param {string} method
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeAsync(
        {
            requestId,
            currentDate,
            resourceType,
            base_version,
            useHistoryCollection,
            operations,
            method
        }) {
        // Start the FHIR request timer, saving a reference to the returned method
        const timer = databaseBulkInserterTimer.startTimer();
        try {
            return await mutex.runExclusive(async () => {
                /**
                 * @type {Map<string, BulkInsertUpdateEntry[]>}
                 */
                const operationsByCollectionNames = new Map();
                /**
                 * @type {ResourceLocator}
                 */
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                    {
                        resourceType, base_version
                    }
                );
                for (const /** @type {BulkInsertUpdateEntry} */ operation of operations) {
                    /**
                     * @type {Resource}
                     */
                    const resource = operation.resource;
                    assertIsValid(resource, 'resource is null');
                    /**
                     * @type {string}
                     */
                    const collectionName = useHistoryCollection ?
                        await resourceLocator.getHistoryCollectionNameAsync(resource.resource ? resource.resource : resource) :
                        await resourceLocator.getCollectionNameAsync(resource);
                    if (!(operationsByCollectionNames.has(collectionName))) {
                        operationsByCollectionNames.set(`${collectionName}`, []);
                    }
                    // remove _id if present so mongo can insert properly
                    if (!useHistoryCollection && operation.operationType === 'insert') {
                        delete operation.operation.insertOne.document['_id'];
                    }
                    if (!useHistoryCollection && resource._id) {
                        await this.errorReporter.reportMessageAsync({
                            source: 'DatabaseBulkInserter.performBulkForResourceTypeAsync',
                            message: '_id still present',
                            args: {
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
                const options = {ordered: true};
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
                        /** @type {string} */collectionName,
                        /** @type {BulkInsertUpdateEntry[]} */
                        operationsByCollection] = operationsByCollectionName;

                    if (this.configManager.logAllMerges) {
                        await sendToS3('bulk_inserter',
                            resourceType,
                            operations,
                            currentDate,
                            requestId,
                            'merge');
                    }
                    try {
                        /**
                         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
                         */
                        const collection = await resourceLocator.getOrCreateCollectionAsync(collectionName);
                        /**
                         * @type {BulkInsertUpdateEntry[]}
                         */
                        const expectedInserts = operationsByCollection.filter(o => o.operationType === 'insert');
                        // const expectedInsertsCount = expectedInserts.length;
                        /**
                         * @type {BulkInsertUpdateEntry[]}
                         */
                        const expectedUpdates = operationsByCollection.filter(
                            o => o.operationType === 'merge' || o.operationType === 'replace');
                        /**
                         * @type {number}
                         */
                        const expectedUpdatesCount = expectedUpdates.length;
                        /**
                         * @type {(import('mongodb').AnyBulkWriteOperation)[]}
                         */
                        const bulkOperations = operationsByCollection.map(o => o.operation);
                        await logTraceSystemEventAsync(
                            {
                                event: 'bulkWriteBegin' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                                message: 'Begin Bulk Write',
                                args: {
                                    resourceType,
                                    collectionName,
                                    operationsByCollection,
                                    requestId
                                }
                            }
                        );
                        /**
                         * @type {import('mongodb').BulkWriteResult}
                         */
                        const result = await collection.bulkWrite(bulkOperations, options);
                        bulkWriteResult = result;
                        await logTraceSystemEventAsync(
                            {
                                event: 'bulkWriteResult' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                                message: 'Result of Bulk Write',
                                args: {
                                    resourceType,
                                    collectionName,
                                    operationsByCollection,
                                    result,
                                    requestId
                                }
                            }
                        );

                        // create history table entries

                        // const actualInsertsCount = bulkWriteResult.nInserted;

                        // 1. create history entry for inserts
                        for (const expectedInsert of expectedInserts) {
                            mergeResultEntries.push(
                                await this.postSaveAsync({
                                    requestId,
                                    method,
                                    base_version,
                                    resourceType,
                                    bulkInsertUpdateEntry: expectedInsert,
                                    bulkWriteResult,
                                    useHistoryCollection
                                })
                            );
                        }

                        // 2. Now create history entries for updates
                        // case 1: No concurrency failures
                        // case 2: Concurrency failures
                        if (this.configManager.handleConcurrency && expectedUpdatesCount > 0) {
                            // https://www.mongodb.com/docs/manual/reference/method/BulkWriteResult/
                            // const actualInserts = bulkWriteResult.nInserted;
                            // nMatched: The number of existing documents selected for update or replacement.
                            // If the update/replacement operation results in no change to an existing document,
                            // e.g. $set expression updates the value to the current value,
                            // nMatched can be greater than nModified.
                            const actualUpdatesCount = bulkWriteResult.nMatched;
                            if (actualUpdatesCount === expectedUpdatesCount) { // case 1: no concurrency failures
                                for (const expectedUpdate of expectedUpdates) {
                                    mergeResultEntries.push(
                                        await this.postSaveAsync({
                                            requestId,
                                            method,
                                            base_version,
                                            resourceType,
                                            bulkInsertUpdateEntry: expectedUpdate,
                                            bulkWriteResult,
                                            useHistoryCollection
                                        })
                                    );
                                }
                            } else { // case 2: concurrency check failed (another parallel process updated atleast one resource)
                                // if updates don't match then get latest and merge again
                                await logTraceSystemEventAsync(
                                    {
                                        event: 'bulkWriteConcurrency' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                                        message: 'Update count not matched so running updates one by one',
                                        args: {
                                            resourceType,
                                            collectionName,
                                            expectedUpdates,
                                            actualUpdatesCount,
                                            expectedUpdatesCount,
                                            bulkWriteResult
                                        }
                                    }
                                );
                                await this.updateResourcesOneByOneAsync(
                                    {
                                        expectedUpdates
                                    }
                                );
                                for (const expectedUpdate of expectedUpdates) {
                                    mergeResultEntries.push(
                                        await this.postSaveAsync({
                                            requestId,
                                            method,
                                            base_version,
                                            resourceType,
                                            bulkInsertUpdateEntry: expectedUpdate,
                                            bulkWriteResult,
                                            useHistoryCollection
                                        })
                                    );
                                }
                            }
                        } else {
                            // no concurrency failures
                            for (const expectedUpdate of expectedUpdates) {
                                mergeResultEntries.push(
                                    await this.postSaveAsync({
                                        requestId,
                                        method,
                                        base_version,
                                        resourceType,
                                        bulkInsertUpdateEntry: expectedUpdate,
                                        bulkWriteResult,
                                        useHistoryCollection
                                    })
                                );
                            }
                        }
                    } catch (e) {
                        await this.errorReporter.reportErrorAsync({
                            source: 'databaseBulkInserter',
                            message: 'databaseBulkInserter: Error bulkWrite',
                            error: e,
                            args: {
                                requestId: requestId,
                                operations: operationsByCollection,
                                options: options,
                                collection: collectionName
                            }
                        });
                        await logSystemErrorAsync({
                            event: 'databaseBulkInserter',
                            message: 'databaseBulkInserter: Error bulkWrite',
                            error: e,
                            args: {
                                requestId: requestId,
                                operations: operationsByCollection,
                                options: options,
                                collection: collectionName
                            }
                        });
                        return {resourceType: resourceType, mergeResult: null, error: e, mergeResultEntries};
                    }
                }
                return {resourceType: resourceType, mergeResult: bulkWriteResult, error: null, mergeResultEntries};
            });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        } finally {
            timer({resourceType});
        }
    }

    /**
     * @param {string} requestId
     * @param {string} method
     * @param {string} base_version
     * @param {string} resourceType
     * @param {BulkInsertUpdateEntry} bulkInsertUpdateEntry
     * @param {import('mongodb').BulkWriteResult} bulkWriteResult
     * @param {boolean} useHistoryCollection
     * @returns {Promise<MergeResultEntry>}
     */
    async postSaveAsync(
        {
            requestId,
            method,
            base_version,
            resourceType,
            bulkInsertUpdateEntry,
            bulkWriteResult,
            useHistoryCollection
        }
    ) {
        await logTraceSystemEventAsync(
            {
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
            }
        );
        if (!bulkInsertUpdateEntry.skipped && resourceType !== 'AuditEvent' && !useHistoryCollection) {
            await this.insertOneHistoryAsync(
                {
                    requestId,
                    method,
                    base_version,
                    resourceType,
                    doc: bulkInsertUpdateEntry.resource.clone(),
                    patches: bulkInsertUpdateEntry.patches
                }
            );
        }
        /**
         * @type {MergeResultEntry}
         */
        const mergeResultEntry = {
            'id': bulkInsertUpdateEntry.id,
            created: bulkInsertUpdateEntry.operationType === 'insert' && !bulkWriteResult.error && !bulkInsertUpdateEntry.skipped,
            updated: (bulkInsertUpdateEntry.operationType === 'merge' || bulkInsertUpdateEntry.operationType === 'replace') &&
                !bulkWriteResult.error && !bulkInsertUpdateEntry.skipped,
            resourceType: resourceType,
        };
        if (bulkWriteResult.error) {
            const diagnostics = JSON.stringify(bulkWriteResult.error, getCircularReplacer());
            mergeResultEntry.issue = new OperationOutcomeIssue({
                severity: 'error',
                code: 'exception',
                details: new CodeableConcept({text: bulkWriteResult.error.message}),
                diagnostics: diagnostics,
                expression: [
                    resourceType + '/' + bulkInsertUpdateEntry.id
                ]
            });
        }
        if (bulkWriteResult.error) {
            await this.errorReporter.reportErrorAsync(
                {
                    source: 'databaseBulkInserter',
                    message: `databaseBulkInserter: Error resource ${resourceType} with operation:` +
                        ` ${JSON.stringify(bulkInsertUpdateEntry, getCircularReplacer())}`,
                    error: bulkWriteResult.error,
                    args: {
                        requestId: requestId,
                        resourceType: resourceType,
                        operation: bulkInsertUpdateEntry
                    }
                }
            );
        }

        // fire change events
        if (!bulkInsertUpdateEntry.skipped && resourceType !== 'AuditEvent' && !useHistoryCollection) {
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => await this.changeEventProducer.fireEventsAsync({
                    requestId,
                    eventType: bulkInsertUpdateEntry.operationType === 'insert' ? 'C' : 'U',
                    resourceType: resourceType,
                    doc: bulkInsertUpdateEntry.resource
                })
            });
        }

        return mergeResultEntry;
    }

    /**
     * Gets list of pending inserts for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingInserts({requestId, resourceType}) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({requestId}).get(resourceType);
        return operationsByResourceType ? operationsByResourceType.filter(operation => operation.operationType === 'insert') : [];
    }

    /**
     * Gets list of pending updates for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingUpdates({requestId, resourceType}) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({requestId}).get(resourceType);
        return operationsByResourceType ?
            operationsByResourceType.filter(operation => operation.operationType === 'merge' || operation.operationType === 'replace') :
            [];
    }

    /**
     * Updates resources one by one
     * @param {BulkInsertUpdateEntry[]} expectedUpdates
     * @returns {Promise<void>}
     */
    async updateResourcesOneByOneAsync({expectedUpdates}) {
        let i = 0;
        for (const /* @type {BulkInsertUpdateEntry} */ expectedUpdate of expectedUpdates) {
            i = i + 1;
            await logTraceSystemEventAsync(
                {
                    event: 'updateResourcesOneByOneAsync',
                    message: 'Updating resources one by one',
                    args: {
                        expectedUpdates
                    }
                }
            );
            /**
             * @type {DatabaseUpdateManager}
             */
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager(
                {
                    resourceType: expectedUpdate.resourceType,
                    base_version: '4_0_0'
                }
            );
            /**
             * @type {Resource|null}
             */
            const {savedResource, patches} = await databaseUpdateManager.replaceOneAsync(
                {
                    doc: expectedUpdate.resource
                }
            );
            if (savedResource) {
                expectedUpdate.resource = savedResource;
                expectedUpdate.patches = patches;
            } else { // resource was same as what was in the database
                expectedUpdate.skipped = true;
            }
        }
    }
}

module.exports = {
    DatabaseBulkInserter
};
