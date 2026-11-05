'use strict';

const {
    logInfo,
    logError
} = require('../../operations/common/logging');
const {
    logSystemErrorAsync,
    logTraceSystemEventAsync
} = require('../../operations/common/systemEventLogging');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { MergeResultEntry } = require('../../operations/common/mergeResultEntry');
const { buildOperationOutcomeIssue } = require('../../utils/operationOutcomeBuilder');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { ACCESS_LOGS_COLLECTION_NAME, MONGO_ERROR } = require('../../constants');
const { MongoInvalidArgumentError } = require('mongodb');
const { BulkWriteExecutor } = require('./bulkWriteExecutor');
const { ResourceLocatorFactory } = require('../../operations/common/resourceLocatorFactory');
const { ConfigManager } = require('../../utils/configManager');
const { PostSaveProcessor } = require('../postSaveProcessor');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { Base64DataManager } = require('../base64DataManager');
const { PreconditionFailedError } = require('../../utils/httpErrors');
const { WriteConflictDetector } = require('../concurrency/writeConflictDetector');
const { ConcurrentWriteResolver } = require('../concurrency/concurrentWriteResolver');

// MongoDB BSON document hard limit is 16 MiB (16,777,216 bytes). The Node driver and
// libbson allocate a 17 MiB scratch buffer (kMaxBSONSize + 1 MiB headroom = 17,825,792 bytes),
// so an oversized document surfaces as a RangeError with that exact boundary.
const BSON_BUFFER_OVERFLOW_BOUNDARY = '17825792';
// MongoDB server error codes for oversized documents: 10334 = BSONObjectTooLarge, 17419 = BSONObj size invalid.
const MONGO_DOC_SIZE_ERROR_CODES = new Set([10334, 17419]);

/**
 * Detects all known shapes of "document exceeds 16 MiB" errors from a MongoDB bulk write.
 * @param {Error} error
 * @returns {boolean}
 */
function isDocumentSizeError (error) {
    if (!error) {
        return false;
    }
    if (error instanceof MongoInvalidArgumentError && error.message === MONGO_ERROR.RESOURCE_SIZE_EXCEEDS) {
        return true;
    }
    if (typeof error.code === 'number' && MONGO_DOC_SIZE_ERROR_CODES.has(error.code)) {
        return true;
    }
    if (error.code === 'ERR_OUT_OF_RANGE' && typeof error.message === 'string' && error.message.includes(BSON_BUFFER_OVERFLOW_BOUNDARY)) {
        return true;
    }
    if (Array.isArray(error.writeErrors) && error.writeErrors.some(we => MONGO_DOC_SIZE_ERROR_CODES.has(we && we.code))) {
        return true;
    }
    return false;
}

/**
 * @classdesc Executes bulk write operations against MongoDB.
 * Extracted from DatabaseBulkInserter and FastDatabaseBulkInserter.
 * The two one-line differences between the original and fast inserters are
 * handled via constructor-injected strategy functions: cloneResource and createUpdateManager.
 */
class MongoBulkWriteExecutor extends BulkWriteExecutor {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ConfigManager} configManager
     * @param {PostSaveProcessor} postSaveProcessor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {Function} cloneResource - Strategy: (resource) => cloned resource
     * @param {Function} createUpdateManager - Strategy: ({resourceType, base_version}) => FastDatabaseUpdateManager
     * @param {Base64DataManager} base64DataManager
     * @param {WriteConflictDetector} writeConflictDetector
     * @param {ConcurrentWriteResolver} concurrentWriteResolver
     */
    constructor ({
        resourceLocatorFactory,
        configManager,
        postSaveProcessor,
        postRequestProcessor,
        cloneResource,
        createUpdateManager,
        base64DataManager,
        writeConflictDetector,
        concurrentWriteResolver
    }) {
        super();

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

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
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * Strategy function to clone a resource for history doc creation.
         * - FastDatabaseBulkInserter: (resource) => deepcopy(resource)
         * @type {Function}
         */
        this.cloneResource = cloneResource;
        assertIsValid(typeof cloneResource === 'function', 'cloneResource must be a function');

        /**
         * Strategy function to create an update manager for concurrency fallback.
         * - FastDatabaseBulkInserter: createFastDatabaseUpdateManager
         * @type {Function}
         */
        this.createUpdateManager = createUpdateManager;
        assertIsValid(typeof createUpdateManager === 'function', 'createUpdateManager must be a function');

        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);

        /**
         * @type {WriteConflictDetector}
         */
        this.writeConflictDetector = writeConflictDetector;
        assertTypeEquals(writeConflictDetector, WriteConflictDetector);

        /**
         * @type {ConcurrentWriteResolver}
         */
        this.concurrentWriteResolver = concurrentWriteResolver;
        assertTypeEquals(concurrentWriteResolver, ConcurrentWriteResolver);
    }

    /**
     * Returns true for all resource types — this is the default/catch-all executor.
     * EA-2193 will add a ClickHouseBulkWriteExecutor that claims ClickHouse-only
     * resources via schema registry; this executor handles everything else.
     * @param {string} resourceType
     * @returns {boolean}
     */
    canHandle (resourceType) {
        return true;
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
     * @param {Function} insertOneHistoryFn - bound from the inserter
     * @returns {Promise<BulkResultEntry>}
     */
    async executeBulkAsync ({
        resourceType,
        base_version,
        useHistoryCollection,
        operations,
        requestInfo,
        maintainOrder = true,
        isAccessLogOperation = false,
        insertOneHistoryFn
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
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                {
                    resourceType, base_version
                }
            );
            for (const /** @type {BulkInsertUpdateEntry} */ operation of operations) {
                /**
                 * @type {Resource|Object}
                 */
                const resource = operation.resource;
                assertIsValid(resource, 'resource is null');
                /**
                 * @type {string}
                 */
                const collectionName = isAccessLogOperation
                    ? ACCESS_LOGS_COLLECTION_NAME
                    : useHistoryCollection
                      ? resourceLocator.getHistoryCollectionNameForResource(
                            resource.resource || resource
                        )
                      : resourceLocator.getCollectionNameForResource(resource);
                if (!(operationsByCollectionNames.has(collectionName))) {
                    operationsByCollectionNames.set(`${collectionName}`, []);
                }

                if (!useHistoryCollection && resource._id) {
                    logInfo('_id still present', {
                        args: {
                            source: 'MongoBulkWriteExecutor.executeBulkAsync',
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
                    /** @type {string} */collectionName,
                    /** @type {BulkInsertUpdateEntry[]} */
                    operationsByCollection] = operationsByCollectionName;

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
                    const expectedInsertsByUniqueId = operationsByCollection.filter(o => o.operationType === 'insertUniqueId');
                    const expectedInsertsByUniqueIdCount = expectedInsertsByUniqueId.length;
                    /**
                     * @type {BulkInsertUpdateEntry[]}
                     */
                    const expectedUpdates = operationsByCollection.filter(o => o.isUpdateOperation);
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
                                requestId
                            }
                        }
                    );
                    /**
                     * @type {import('mongodb').BulkWriteResult}
                     */
                    let result;
                    try {
                        result = await collection.bulkWrite(bulkOperations, options);
                    } catch (error) {
                        await logSystemErrorAsync({
                            event: 'mongoBulkWriteExecutor',
                            message: 'mongoBulkWriteExecutor: Error bulkWrite',
                            error,
                            args: {
                                requestId,
                                options,
                                collection: collectionName
                            }
                        });
                        if (!isDocumentSizeError(error)) {
                            throw new RethrownError({ message: 'mongoBulkWriteExecutor: Error bulkWrite', error });
                        }

                        /**
                         * @type {string}
                         */
                        const diagnostics = `Error in one of the resources of ${resourceType}: ` + error.toString();
                        const bulkWriteResultError = new Error(diagnostics);
                        for (const operationByCollection of operationsByCollection) {
                            const mergeResultEntry = new MergeResultEntry({
                                id: operationByCollection.id,
                                uuid: operationByCollection.uuid,
                                sourceAssigningAuthority: operationByCollection.sourceAssigningAuthority,
                                created: false,
                                updated: false,
                                resourceType,
                                issue: buildOperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'exception',
                                    details: { text: bulkWriteResultError.message },
                                    diagnostics
                                })
                            });
                            mergeResultEntries.push(mergeResultEntry);
                        }

                        return { resourceType, mergeResult: bulkWriteResult, error: error, mergeResultEntries };
                    }
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

                    // https://www.mongodb.com/docs/manual/reference/method/BulkWriteResult/
                    /**
                     * @type {number}
                     */
                    const actualInsertsByUniqueIdCount = bulkWriteResult.upsertedCount;
                    // fewer upserts than expected: a concurrent writer created at least one of
                    // these resources first
                    const insertsFellShort = expectedInsertsByUniqueIdCount > 0 &&
                        expectedInsertsByUniqueIdCount > actualInsertsByUniqueIdCount;
                    // fewer modified than expected: a concurrent writer updated at least one of
                    // these resources first, so its versioned filter matched nothing
                    const updatesFellShort = expectedUpdatesCount > 0 &&
                        bulkWriteResult.modifiedCount < expectedUpdatesCount;

                    // The insertUniqueId operation (fastDatabaseBulkInserter.js) is itself an atomic
                    // updateOne-with-upsert, so upsertedCount < expected here means a concurrent
                    // writer's create won the race for at least one of these resources -- exactly
                    // what If-None-Match: * asks us to reject rather than silently fold into an
                    // update, so check that before resolving the conflict.
                    if (this.configManager.handleConcurrency && insertsFellShort &&
                        expectedInsertsByUniqueId.some(e => e.writePrecondition?.rejectIfExists)
                    ) {
                        throw new PreconditionFailedError('Version conflict: If-None-Match: * was provided but resource already exists.');
                    }
                    if (this.configManager.handleConcurrency && (insertsFellShort || updatesFellShort)) {
                        await logTraceSystemEventAsync(
                            {
                                event: 'bulkWriteConcurrency' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                                message: 'Write counts not matched so resolving the concurrent writes',
                                args: {
                                    resourceType,
                                    collectionName,
                                    actualInsertsByUniqueIdCount,
                                    expectedInsertsByUniqueIdCount,
                                    actualUpdatesCount: bulkWriteResult.modifiedCount,
                                    expectedUpdatesCount
                                }
                            }
                        );
                        await this._resolveConcurrentWritesAsync({
                            base_version,
                            requestInfo,
                            resourceType,
                            collection,
                            operationsByCollection,
                            bulkWriteResult
                        });
                    }

                    // 3. Call postSaveAsync for each operation
                    for (const operationByCollection of operationsByCollection) {
                        mergeResultEntries.push(
                            await this._postSaveAsync({
                                base_version,
                                requestInfo,
                                resourceType,
                                bulkInsertUpdateEntry: operationByCollection,
                                bulkWriteResult,
                                useHistoryCollection,
                                isAccessLogOperation,
                                insertOneHistoryFn
                            })
                        );
                    }
                } catch (e) {
                    // Errors already wrapped at a lower layer (inner bulkWrite catch, post-save,
                    // concurrency fallback) propagate untouched — wrapping a RethrownError again
                    // is what produced the original "RethrownError: undefined" audit log lines.
                    // Plain errors (e.g. from resource-locator collection fetches) get a single
                    // wrap so upstream consumers still receive a RethrownError with .statusCode,
                    // .issue, and .nested set.
                    if (e instanceof RethrownError) {
                        throw e;
                    }
                    await logSystemErrorAsync({
                        event: 'mongoBulkWriteExecutor_postBulkWrite',
                        message: 'mongoBulkWriteExecutor: Error after bulk write',
                        error: e,
                        args: {
                            requestId,
                            options,
                            collection: collectionName
                        }
                    });
                    throw new RethrownError({ error: e });
                }
            }
            return { resourceType, mergeResult: bulkWriteResult, error: null, mergeResultEntries };
        } catch (e) {
            // Same wrap-if-not-already policy as the inner outer catch: preserve any RethrownError
            // from lower layers verbatim, but wrap raw prep-phase errors (assertIsValid,
            // resourceLocator failures) once so the upstream contract holds.
            if (e instanceof RethrownError) {
                throw e;
            }
            await logSystemErrorAsync({
                event: 'mongoBulkWriteExecutor_prep',
                message: 'mongoBulkWriteExecutor: Error before bulk write',
                error: e,
                args: { requestId, resourceType }
            });
            throw new RethrownError({ error: e });
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
     * @param {Function} insertOneHistoryFn - bound from the inserter
     * @returns {Promise<MergeResultEntry>}
     * @private
     */
    async _postSaveAsync ({
        requestInfo,
        base_version,
        resourceType,
        bulkInsertUpdateEntry,
        bulkWriteResult,
        useHistoryCollection,
        isAccessLogOperation = false,
        insertOneHistoryFn
    }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const requestId = requestInfo.requestId;
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
        // an entry the concurrency resolver could not save carries its issue: no history, no event
        if (bulkInsertUpdateEntry.issue) {
            return new MergeResultEntry({
                id: bulkInsertUpdateEntry.id,
                uuid: bulkInsertUpdateEntry.uuid,
                sourceAssigningAuthority: bulkInsertUpdateEntry.sourceAssigningAuthority,
                created: false,
                updated: false,
                resourceType,
                issue: bulkInsertUpdateEntry.issue,
                operationOutcome: bulkInsertUpdateEntry.operationOutcome,
                savedResource: bulkInsertUpdateEntry.resource
            });
        }
        if (
            !bulkInsertUpdateEntry.skipped &&
            resourceType !== 'AuditEvent' &&
            !useHistoryCollection &&
            !isAccessLogOperation
        ) {
            await insertOneHistoryFn(
                {
                    requestInfo,
                    base_version,
                    resourceType,
                    doc: this.cloneResource(bulkInsertUpdateEntry.resource),
                    patches: bulkInsertUpdateEntry.patches
                }
            );
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
            resourceType,
            savedResource: bulkInsertUpdateEntry.resource
        });
        if (hasBulkWriteErrors) {
            const bulkWriteErrors = bulkWriteResult.getWriteErrors();
            const bulkWriteErrorsMsg = bulkWriteErrors.map(error => error.toJSON());
            const diagnostics = JSON.stringify(bulkWriteErrorsMsg, getCircularReplacer());
            const bulkWriteResultError = new Error(diagnostics);
            mergeResultEntry.issue = buildOperationOutcomeIssue({
                severity: 'error',
                code: 'exception',
                details: { text: bulkWriteResultError.message },
                diagnostics,
                expression: [
                    resourceType + '/' + bulkInsertUpdateEntry.uuid
                ]
            });
            logError(
                `mongoBulkWriteExecutor: Error resource ${resourceType}`,
                {
                    args: {
                        error: bulkWriteResult.getWriteErrors(),
                        source: 'mongoBulkWriteExecutor',
                        requestId,
                        resourceType,
                        operation: bulkInsertUpdateEntry
                    }
                }
            );
        }

        // Superseded live-bucket objects are swept once, on the main-collection pass. The
        // history-collection pass runs afterwards for the same entry and only writes history rows
        // (whose payloads live in the history bucket), so sweeping again would just re-list the
        // same prefix.
        if (!bulkInsertUpdateEntry.skipped && !hasBulkWriteErrors && !useHistoryCollection) {
            await this.base64DataManager.cleanupPreviousLiveObjectAsync(bulkInsertUpdateEntry.resource, requestInfo);
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

            const afterSaveTask = async () => await this.postSaveProcessor.afterSaveAsync({
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
     * Finds the entries of this collection's bulk write that lost a concurrency race and
     * resolves them: losers are rebased and rewritten in bulk, an If-Match update that lost
     * fails the request, and a {_uuid}-only write whose document is missing is replayed one by one
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {import('mongodb').Collection} collection
     * @param {BulkInsertUpdateEntry[]} operationsByCollection - in the order they were written
     * @param {import('mongodb').BulkWriteResult} bulkWriteResult
     * @returns {Promise<void>}
     * @private
     */
    async _resolveConcurrentWritesAsync ({
        base_version,
        requestInfo,
        resourceType,
        collection,
        operationsByCollection,
        bulkWriteResult
    }) {
        const updateManager = this.createUpdateManager({ resourceType, base_version: '4_0_0' });
        const { losers, latestByUuid, ifMatchMisses, missingUuidOnly } = await this.writeConflictDetector.detectAsync({
            entries: operationsByCollection.map((entry, index) => ({ entry, index })),
            bulkWriteResult,
            updateManager
        });
        if (ifMatchMisses.length > 0) {
            const ifMatchVersionIds = ifMatchMisses[0].writePrecondition?.ifMatchVersionIds || [];
            throw new PreconditionFailedError(
                `Version conflict: If-Match does not match current resource version. If-Match: ${ifMatchVersionIds.join(', ')}`
            );
        }
        if (losers.length > 0) {
            await this.concurrentWriteResolver.resolveAsync({
                base_version,
                requestInfo,
                collection,
                losers,
                latestByUuid,
                updateManager,
                cloneResource: this.cloneResource
            });
        }
        if (missingUuidOnly.length > 0) {
            await this._updateResourcesOneByOneAsync({
                base_version,
                requestInfo,
                bulkInsertUpdateEntries: missingUuidOnly
            });
        }
    }

    /**
     * Updates resources one by one
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {BulkInsertUpdateEntry[]} bulkInsertUpdateEntries
     * @returns {Promise<void>}
     * @private
     */
    async _updateResourcesOneByOneAsync ({ base_version, requestInfo, bulkInsertUpdateEntries }) {
        // let i = 0;
        for (const /* @type {BulkInsertUpdateEntry} */ bulkInsertUpdateEntry of bulkInsertUpdateEntries) {
            // i += 1;
            await logTraceSystemEventAsync(
                {
                    event: 'updateResourcesOneByOneAsync',
                    message: 'Updating resources one by one',
                    args: {
                        expectedUpdates: bulkInsertUpdateEntries
                    }
                }
            );
            /**
             * @type {FastDatabaseUpdateManager}
             */
            const databaseUpdateManager = this.createUpdateManager(
                {
                    resourceType: bulkInsertUpdateEntry.resourceType,
                    base_version: '4_0_0'
                }
            );
            /**
             * @type {Resource|Object|null}
             */
            const { savedResource, patches } = await databaseUpdateManager.replaceOneAsync(
                {
                    base_version,
                    requestInfo,
                    doc: bulkInsertUpdateEntry.resource,
                    smartMerge: bulkInsertUpdateEntry.smartMerge,
                    ifMatchVersionIds: bulkInsertUpdateEntry.writePrecondition?.ifMatchVersionIds
                }
            );
            if (savedResource) {
                bulkInsertUpdateEntry.resource = savedResource;
                bulkInsertUpdateEntry.patches = patches;
            } else { // resource was same as what was in the database
                bulkInsertUpdateEntry.skipped = true;
            }
        }
    }
}

module.exports = {
    MongoBulkWriteExecutor,
    isDocumentSizeError
};
