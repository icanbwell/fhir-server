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
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { RethrownError } = require('../../utils/rethrownError');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { MergeResultEntry } = require('../../operations/common/mergeResultEntry');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { ACCESS_LOGS_COLLECTION_NAME, MONGO_ERROR } = require('../../constants');
const { MongoInvalidArgumentError } = require('mongodb');
const { BulkWriteExecutor } = require('./bulkWriteExecutor');
const { ResourceLocatorFactory } = require('../../operations/common/resourceLocatorFactory');
const { ConfigManager } = require('../../utils/configManager');
const { PostSaveProcessor } = require('../postSaveProcessor');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const {
    wasMemberStrippedForExternalStorage,
    restoreStrippedMembersInMongo
} = require('../../utils/clickHouseGroupPreSave');

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
     * @param {Function} createUpdateManager - Strategy: ({resourceType, base_version}) => DatabaseUpdateManager
     */
    constructor ({
        resourceLocatorFactory,
        configManager,
        postSaveProcessor,
        postRequestProcessor,
        cloneResource,
        createUpdateManager
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
         * - DatabaseBulkInserter: (resource) => resource.clone()
         * - FastDatabaseBulkInserter: (resource) => deepcopy(resource)
         * @type {Function}
         */
        this.cloneResource = cloneResource;
        assertIsValid(typeof cloneResource === 'function', 'cloneResource must be a function');

        /**
         * Strategy function to create an update manager for concurrency fallback.
         * - DatabaseBulkInserter: createDatabaseUpdateManager
         * - FastDatabaseBulkInserter: createFastDatabaseUpdateManager
         * @type {Function}
         */
        this.createUpdateManager = createUpdateManager;
        assertIsValid(typeof createUpdateManager === 'function', 'createUpdateManager must be a function');
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

                    // 1. check if we got same number of inserts as we expected
                    //      If we did not, it means someone else inserted this resource.  Then we have to use update instead of insert
                    if (this.configManager.handleConcurrency &&
                        expectedInsertsByUniqueIdCount > 0 &&
                        expectedInsertsByUniqueIdCount > actualInsertsByUniqueIdCount
                    ) {
                        await logTraceSystemEventAsync(
                            {
                                event: 'bulkWriteConcurrency' + `_${resourceType}` + `${useHistoryCollection ? '_hist' : ''}`,
                                message: 'Insert count not matched so running updates one by one',
                                args: {
                                    resourceType,
                                    collectionName,
                                    expectedInsertsByUniqueId,
                                    actualInsertsByUniqueIdCount,
                                    expectedInsertsByUniqueIdCount,
                                    bulkWriteResult
                                }
                            }
                        );
                        // do inserts/updates one by one
                        await this._updateResourcesOneByOneAsync(
                            {
                                base_version,
                                requestInfo,
                                bulkInsertUpdateEntries: expectedInsertsByUniqueId
                            }
                        );
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
                    if (this.configManager.handleConcurrency && expectedUpdatesCount > 0 &&
                        actualUpdatesCount < expectedUpdatesCount) {
                        // concurrency check failed (another parallel process updated atleast one resource)
                        // process one by one
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
                        await this._updateResourcesOneByOneAsync(
                            {
                                base_version,
                                requestInfo,
                                bulkInsertUpdateEntries: expectedUpdates
                            }
                        );
                    }

                    // 3. Call postSaveAsync for each operation
                    for (const operationByCollection of operationsByCollection) {
                        try {
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
                        } catch (postSaveError) {
                            // EA-2322: Group dual-write split-brain compensation.
                            //
                            // For a Group create/PUT with useExternalStorage, the MongoDB document
                            // was already committed (above) with member[] stripped, on the
                            // assumption that the synchronous post-save handler would write the
                            // members to ClickHouse. A throw here means that ClickHouse write
                            // failed, so MongoDB now holds a Group with no members and ClickHouse
                            // holds no events: a silently-empty (orphaned) Group.
                            //
                            // Restore the original members onto the committed MongoDB document so
                            // the submitted membership is not lost, then re-throw so the client
                            // still receives a 500 and the operation is reported as failed.
                            // See restoreStrippedMembersInMongo for the rationale and the known
                            // limitation (members are restored to Mongo, not replayed to ClickHouse).
                            await this._compensateStrippedGroupMembersOnPostSaveFailure({
                                collection,
                                resourceType,
                                bulkInsertUpdateEntry: operationByCollection,
                                requestId,
                                postSaveError
                            });
                            throw postSaveError;
                        }
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
            resourceType
        });
        if (hasBulkWriteErrors) {
            const bulkWriteErrors = bulkWriteResult.getWriteErrors();
            const bulkWriteErrorsMsg = bulkWriteErrors.map(error => error.toJSON());
            const diagnostics = JSON.stringify(bulkWriteErrorsMsg, getCircularReplacer());
            const bulkWriteResultError = new Error(diagnostics);
            mergeResultEntry.issue = new OperationOutcomeIssue({
                severity: 'error',
                code: 'exception',
                details: new CodeableConcept({ text: bulkWriteResultError.message }),
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
     * EA-2322: Compensates a Group dual-write split-brain after a post-save failure.
     *
     * When the synchronous post-save handler (the ClickHouse member write) throws for a Group
     * whose member[] was stripped from MongoDB before the commit, the committed MongoDB document
     * is left silently empty. This restores the original members (carried in contextData) back
     * onto that document so the data is not lost.
     *
     * Compensation is best-effort: if the restore itself fails we log and swallow that secondary
     * error so the ORIGINAL post-save error is the one surfaced to the caller (it is the actionable
     * failure). This method never throws.
     *
     * @param {Object} params
     * @param {import('mongodb').Collection} params.collection - Open collection for this resource table
     * @param {string} params.resourceType
     * @param {BulkInsertUpdateEntry} params.bulkInsertUpdateEntry
     * @param {string|null} params.requestId
     * @param {Error} params.postSaveError - The original post-save (ClickHouse) error being compensated
     * @returns {Promise<void>}
     * @private
     */
    async _compensateStrippedGroupMembersOnPostSaveFailure ({
        collection,
        resourceType,
        bulkInsertUpdateEntry,
        requestId,
        postSaveError
    }) {
        const contextData = bulkInsertUpdateEntry.contextData || null;

        // Only Group writes that actually stripped members from Mongo can be split-brained.
        if (resourceType !== 'Group' || !wasMemberStrippedForExternalStorage(contextData)) {
            return;
        }

        const originalMembers = contextData?.groupMembers || [];
        if (originalMembers.length === 0) {
            // No members were submitted, so there is nothing to lose (empty Group is consistent).
            return;
        }

        try {
            const restored = await restoreStrippedMembersInMongo({
                collection,
                uuid: bulkInsertUpdateEntry.uuid,
                members: originalMembers
            });

            logError('mongoBulkWriteExecutor: ClickHouse member write failed; restored Group members to MongoDB to prevent data loss', {
                args: {
                    source: 'mongoBulkWriteExecutor._compensateStrippedGroupMembersOnPostSaveFailure',
                    requestId,
                    resourceType,
                    id: bulkInsertUpdateEntry.id,
                    uuid: bulkInsertUpdateEntry.uuid,
                    memberCount: originalMembers.length,
                    restored,
                    originalError: postSaveError && postSaveError.message
                }
            });
        } catch (compensationError) {
            // Secondary failure: the Group remains empty in Mongo. Log loudly but do not mask the
            // original post-save error, which the caller re-throws.
            await logSystemErrorAsync({
                event: 'mongoBulkWriteExecutor_compensationFailed',
                message: 'mongoBulkWriteExecutor: failed to restore Group members after ClickHouse write failure',
                error: compensationError,
                args: {
                    requestId,
                    resourceType,
                    id: bulkInsertUpdateEntry.id,
                    uuid: bulkInsertUpdateEntry.uuid,
                    originalError: postSaveError && postSaveError.message
                }
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
             * @type {DatabaseUpdateManager}
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
                    doc: bulkInsertUpdateEntry.resource
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
