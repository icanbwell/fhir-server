'use strict';

/**
 * Unit tests for MongoBulkWriteExecutor — the default/catch-all bulk write path that every
 * FHIR resource write (merge, create, update, bulk import) funnels through.
 *
 * Focus areas:
 * - partial-batch failure handling across multiple target collections
 * - whether a FAILED write is reported to the caller as a SUCCESS (created/updated true)
 * - whether history documents and Kafka change events are emitted for writes that never landed
 * - whether meta.security tags (owner / access / sourceAssigningAuthority) survive the path
 *   untouched
 *
 * Tests that assert CORRECT behavior the current code does NOT implement FAIL by design and
 * are the bug report.
 */

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// ── dependency mocks (must be registered before the module under test is required) ──────────
jestGlobal.mock('../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

jestGlobal.mock('../../../../operations/common/systemEventLogging', () => ({
    logSystemErrorAsync: jestGlobal.fn().mockResolvedValue(undefined),
    logSystemEventAsync: jestGlobal.fn().mockResolvedValue(undefined),
    logTraceSystemEventAsync: jestGlobal.fn().mockResolvedValue(undefined)
}));

// The executor's constructor/entry point asserts concrete DI types. Neutralize the type guard so
// lightweight mock doubles can be injected; every assertion below still exercises real executor code.
jestGlobal.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: () => {},
    assertIsValid: (value, message) => {
        if (!value) {
            throw new Error(message || 'assertIsValid failed');
        }
    },
    assertFail: () => {}
}));

const {
    MongoBulkWriteExecutor,
    isDocumentSizeError
} = require('../../../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');
const { BulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/bulkWriteExecutor');
const { BulkInsertUpdateEntry } = require('../../../../dataLayer/bulkInsertUpdateEntry');
const { RethrownError } = require('../../../../utils/rethrownError');
const { MongoInvalidArgumentError } = require('mongodb');
const { MONGO_ERROR, ACCESS_LOGS_COLLECTION_NAME } = require('../../../../constants');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { WriteConflictDetector } = require('../../../../dataLayer/concurrency/writeConflictDetector');
const BaseSerializer = require('../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

// the real WriteConflictDetector compares documents through the write serializers, which read this
BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

/**
 * A mongodb BulkWriteResult test double.
 * @param {Object} [opts]
 */
function makeBulkWriteResult ({ upsertedCount = 0, modifiedCount = 0, writeErrors = [], upsertedIds = {} } = {}) {
    return {
        upsertedCount,
        upsertedIds,
        modifiedCount,
        insertedCount: 0,
        matchedCount: modifiedCount,
        hasWriteErrors: () => writeErrors.length > 0,
        getWriteErrors: () => writeErrors
    };
}

function makeWriteError ({ index = 0, code = 11000, errmsg = 'duplicate key' } = {}) {
    return { index, code, errmsg, toJSON: () => ({ index, code, errmsg }) };
}

/**
 * A FHIR resource carrying the full b.well security tag triple.
 */
function makeResource ({
    id = 'patient-1',
    resourceType = 'Patient',
    owner = 'client-a',
    access = 'client-a',
    sourceAssigningAuthority = 'client-a'
} = {}) {
    return {
        resourceType,
        id,
        meta: {
            security: [
                { system: SecurityTagSystem.owner, code: owner },
                { system: SecurityTagSystem.access, code: access },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority }
            ]
        }
    };
}

function makeEntry (overrides = {}) {
    const resource = overrides.resource || makeResource();
    return new BulkInsertUpdateEntry({
        operationType: 'insertUniqueId',
        isCreateOperation: true,
        isUpdateOperation: false,
        resourceType: resource.resourceType,
        id: resource.id,
        uuid: `uuid-${resource.id}`,
        sourceAssigningAuthority: 'client-a',
        resource,
        operation: { replaceOne: { filter: { _uuid: `uuid-${resource.id}` }, replacement: resource, upsert: true } },
        patches: null,
        skipped: false,
        ...overrides
    });
}

/**
 * requestInfo double — the executor only reads .requestId off it.
 */
function makeRequestInfo (requestId = 'req-1') {
    return { requestId, user: 'test-user', scope: 'user/*.write' };
}

describe('MongoBulkWriteExecutor', () => {
    let collection;
    let resourceLocator;
    let resourceLocatorFactory;
    let configManager;
    let postSaveProcessor;
    let postRequestProcessor;
    let base64DataManager;
    let cloneResource;
    let updateManager;
    let createUpdateManager;
    let insertOneHistoryFn;
    let concurrentWriteResolver;
    let executor;

    beforeEach(() => {
        jestGlobal.clearAllMocks();

        collection = {
            bulkWrite: jestGlobal.fn().mockResolvedValue(makeBulkWriteResult({ upsertedCount: 1 }))
        };

        resourceLocator = {
            getCollectionNameForResource: jestGlobal.fn(() => 'Patient_4_0_0'),
            getHistoryCollectionNameForResource: jestGlobal.fn(() => 'Patient_4_0_0_History'),
            getCollectionByNameAsync: jestGlobal.fn().mockResolvedValue(collection),
            getAccessLogCollectionAsync: jestGlobal.fn().mockResolvedValue(collection)
        };

        resourceLocatorFactory = {
            createResourceLocator: jestGlobal.fn(() => resourceLocator)
        };

        configManager = { handleConcurrency: true };

        postSaveProcessor = {
            afterSaveAsync: jestGlobal.fn().mockResolvedValue(undefined),
            needsSyncFor: jestGlobal.fn(() => false)
        };

        postRequestProcessor = { add: jestGlobal.fn() };

        base64DataManager = {
            cleanupPreviousLiveObjectAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };

        cloneResource = jestGlobal.fn((r) => ({ ...r, __cloned: true }));

        updateManager = {
            replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: null, patches: null }),
            findLatestByUuidsAsync: jestGlobal.fn().mockResolvedValue(new Map())
        };
        createUpdateManager = jestGlobal.fn(() => updateManager);

        insertOneHistoryFn = jestGlobal.fn().mockResolvedValue(undefined);

        concurrentWriteResolver = { resolveAsync: jestGlobal.fn().mockResolvedValue(undefined) };

        executor = new MongoBulkWriteExecutor({
            resourceLocatorFactory,
            configManager,
            postSaveProcessor,
            postRequestProcessor,
            cloneResource,
            createUpdateManager,
            base64DataManager,
            writeConflictDetector: new WriteConflictDetector(),
            concurrentWriteResolver
        });
    });

    /**
     * @param {Object} [overrides]
     */
    function run (overrides = {}) {
        return executor.executeBulkAsync({
            resourceType: 'Patient',
            base_version: '4_0_0',
            useHistoryCollection: false,
            operations: [makeEntry()],
            requestInfo: makeRequestInfo(),
            maintainOrder: true,
            isAccessLogOperation: false,
            insertOneHistoryFn,
            ...overrides
        });
    }

    // ========================================================================================
    // isDocumentSizeError — the guard that decides "report per-resource failure" vs "rethrow"
    // ========================================================================================
    describe('isDocumentSizeError', () => {
        test('returns false for a null/undefined error', () => {
            expect(isDocumentSizeError(null)).toBe(false);
            expect(isDocumentSizeError(undefined)).toBe(false);
        });

        test('returns true for MongoInvalidArgumentError with the 16 MiB driver message', () => {
            const error = new MongoInvalidArgumentError(MONGO_ERROR.RESOURCE_SIZE_EXCEEDS);
            expect(isDocumentSizeError(error)).toBe(true);
        });

        test('returns false for MongoInvalidArgumentError with an unrelated message', () => {
            const error = new MongoInvalidArgumentError('Argument "ordered" must be a boolean');
            expect(isDocumentSizeError(error)).toBe(false);
        });

        test('returns true for server error code 10334 (BSONObjectTooLarge)', () => {
            expect(isDocumentSizeError(Object.assign(new Error('too big'), { code: 10334 }))).toBe(true);
        });

        test('returns true for server error code 17419', () => {
            expect(isDocumentSizeError(Object.assign(new Error('too big'), { code: 17419 }))).toBe(true);
        });

        test('returns false for an unrelated numeric server error code', () => {
            expect(isDocumentSizeError(Object.assign(new Error('dup key'), { code: 11000 }))).toBe(false);
        });

        test('returns true for ERR_OUT_OF_RANGE carrying the 17825792 buffer boundary', () => {
            const error = Object.assign(
                new RangeError('The value of "size" is out of range. Received 17825792'),
                { code: 'ERR_OUT_OF_RANGE' }
            );
            expect(isDocumentSizeError(error)).toBe(true);
        });

        test('returns false for ERR_OUT_OF_RANGE without the BSON buffer boundary', () => {
            const error = Object.assign(
                new RangeError('The value of "offset" is out of range. Received 42'),
                { code: 'ERR_OUT_OF_RANGE' }
            );
            expect(isDocumentSizeError(error)).toBe(false);
        });

        test('returns true when a nested writeErrors entry has a doc-size code', () => {
            const error = Object.assign(new Error('bulk write failed'), {
                writeErrors: [makeWriteError({ code: 11000 }), makeWriteError({ index: 1, code: 10334 })]
            });
            expect(isDocumentSizeError(error)).toBe(true);
        });

        test('returns false when writeErrors contains only unrelated codes, and tolerates null entries', () => {
            const error = Object.assign(new Error('bulk write failed'), {
                writeErrors: [null, makeWriteError({ code: 11000 })]
            });
            expect(isDocumentSizeError(error)).toBe(false);
        });
    });

    // ========================================================================================
    // canHandle
    // ========================================================================================
    describe('canHandle', () => {
        test('is the catch-all executor: claims every resource type', () => {
            expect(executor.canHandle('Patient')).toBe(true);
            expect(executor.canHandle('AuditEvent')).toBe(true);
            expect(executor.canHandle('SomeTypeThatDoesNotExist')).toBe(true);
        });

        test('extends the BulkWriteExecutor base contract', () => {
            expect(executor).toBeInstanceOf(BulkWriteExecutor);
        });
    });

    // ========================================================================================
    // executeBulkAsync — happy path / routing / ordering
    // ========================================================================================
    describe('executeBulkAsync — routing and ordering', () => {
        test('writes the operations to the resource collection with ordered:true by default', async () => {
            const result = await run();

            expect(resourceLocator.getCollectionByNameAsync).toHaveBeenCalledWith('Patient_4_0_0');
            expect(collection.bulkWrite).toHaveBeenCalledTimes(1);
            const [ops, options] = collection.bulkWrite.mock.calls[0];
            expect(ops).toHaveLength(1);
            expect(options).toEqual({ ordered: true });
            expect(result.resourceType).toBe('Patient');
            expect(result.error).toBeNull();
        });

        test('maintainOrder=false switches the bulk write to ordered:false', async () => {
            await run({ maintainOrder: false });
            expect(collection.bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
        });

        test('isAccessLogOperation routes every op to the access-logs collection', async () => {
            await run({ isAccessLogOperation: true });

            expect(resourceLocator.getAccessLogCollectionAsync).toHaveBeenCalledTimes(1);
            expect(resourceLocator.getCollectionByNameAsync).not.toHaveBeenCalled();
            expect(resourceLocator.getCollectionNameForResource).not.toHaveBeenCalled();
            // access-log entries never get history docs or change events
            expect(insertOneHistoryFn).not.toHaveBeenCalled();
            expect(postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('useHistoryCollection routes to the history collection and skips history/change events', async () => {
            await run({ useHistoryCollection: true });

            expect(resourceLocator.getHistoryCollectionNameForResource).toHaveBeenCalledTimes(1);
            expect(resourceLocator.getCollectionByNameAsync).toHaveBeenCalledWith('Patient_4_0_0_History');
            expect(insertOneHistoryFn).not.toHaveBeenCalled();
            expect(postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('the live-object cleanup runs on the main-collection pass', async () => {
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 1 }));
            await run({
                operations: [makeEntry({ operationType: 'merge', isCreateOperation: false, isUpdateOperation: true })]
            });

            expect(base64DataManager.cleanupPreviousLiveObjectAsync).toHaveBeenCalledTimes(1);
        });

        test('the live-object cleanup does not run again on the history-collection pass', async () => {
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 1 }));
            await run({
                useHistoryCollection: true,
                operations: [makeEntry({ operationType: 'merge', isCreateOperation: false, isUpdateOperation: true })]
            });

            expect(base64DataManager.cleanupPreviousLiveObjectAsync).not.toHaveBeenCalled();
        });

        test('RULE 11 boundary: zero operations performs no bulk write and returns no entries', async () => {
            const result = await run({ operations: [] });

            expect(collection.bulkWrite).not.toHaveBeenCalled();
            expect(result.mergeResultEntries).toEqual([]);
            expect(result.mergeResult).toBeUndefined();
            expect(result.error).toBeNull();
        });

        test('RULE 11 N>1: operations for two different collections each get their own bulkWrite', async () => {
            const collectionA = { bulkWrite: jestGlobal.fn().mockResolvedValue(makeBulkWriteResult({ upsertedCount: 1 })) };
            const collectionB = { bulkWrite: jestGlobal.fn().mockResolvedValue(makeBulkWriteResult({ upsertedCount: 1 })) };
            resourceLocator.getCollectionNameForResource = jestGlobal.fn((r) =>
                r.id === 'patient-2' ? 'Patient_4_0_0_b' : 'Patient_4_0_0_a'
            );
            resourceLocator.getCollectionByNameAsync = jestGlobal.fn(async (name) =>
                name === 'Patient_4_0_0_b' ? collectionB : collectionA
            );

            const result = await run({
                operations: [
                    makeEntry({ resource: makeResource({ id: 'patient-1' }) }),
                    makeEntry({ resource: makeResource({ id: 'patient-2', owner: 'client-b' }) })
                ]
            });

            expect(collectionA.bulkWrite).toHaveBeenCalledTimes(1);
            expect(collectionB.bulkWrite).toHaveBeenCalledTimes(1);
            expect(collectionA.bulkWrite.mock.calls[0][0]).toHaveLength(1);
            expect(collectionB.bulkWrite.mock.calls[0][0]).toHaveLength(1);
            expect(result.mergeResultEntries).toHaveLength(2);
        });

        test('RULE 10 parameter sensitivity: resourceType flows through to the returned entries', async () => {
            const observation = makeResource({ id: 'obs-1', resourceType: 'Observation' });
            const result = await run({
                resourceType: 'Observation',
                operations: [makeEntry({ resource: observation })]
            });

            expect(resourceLocatorFactory.createResourceLocator).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Observation' })
            );
            expect(result.resourceType).toBe('Observation');
            expect(result.mergeResultEntries[0].resourceType).toBe('Observation');
        });
    });

    // ========================================================================================
    // executeBulkAsync — merge result reporting
    // ========================================================================================
    describe('executeBulkAsync — merge result reporting', () => {
        test('a clean create is reported as created:true / updated:false with no issue', async () => {
            const result = await run();

            expect(result.mergeResultEntries).toHaveLength(1);
            const entry = result.mergeResultEntries[0];
            expect(entry.created).toBe(true);
            expect(entry.updated).toBe(false);
            expect(entry.issue).toBeUndefined();
            expect(entry.id).toBe('patient-1');
            expect(entry._uuid).toBe('uuid-patient-1');
        });

        test('a clean update is reported as updated:true / created:false', async () => {
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 1 }));
            const result = await run({
                operations: [makeEntry({ operationType: 'merge', isCreateOperation: false, isUpdateOperation: true })]
            });

            const entry = result.mergeResultEntries[0];
            expect(entry.created).toBe(false);
            expect(entry.updated).toBe(true);
        });

        test('a skipped entry is reported as neither created nor updated and writes no history', async () => {
            const result = await run({ operations: [makeEntry({ skipped: true })] });

            const entry = result.mergeResultEntries[0];
            expect(entry.created).toBe(false);
            expect(entry.updated).toBe(false);
            expect(insertOneHistoryFn).not.toHaveBeenCalled();
            expect(base64DataManager.cleanupPreviousLiveObjectAsync).not.toHaveBeenCalled();
            expect(postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('an entry carrying an issue is reported with that issue and writes no history or change event', async () => {
            const issue = { severity: 'error', code: 'conflict', expression: ['Patient/uuid-patient-1'] };
            const operationOutcome = { resourceType: 'OperationOutcome', issue: [issue] };
            postSaveProcessor.needsSyncFor.mockReturnValue(true);

            const result = await run({ operations: [makeEntry({ issue, operationOutcome })] });

            const entry = result.mergeResultEntries[0];
            expect(entry.created).toBe(false);
            expect(entry.updated).toBe(false);
            expect(entry.issue).toBe(issue);
            expect(entry.operationOutcome).toBe(operationOutcome);
            expect(insertOneHistoryFn).not.toHaveBeenCalled();
            expect(base64DataManager.cleanupPreviousLiveObjectAsync).not.toHaveBeenCalled();
            expect(postSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
            expect(postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('a merge result carries the saved resource without serializing it', async () => {
            const operations = [makeEntry()];

            const result = await run({ operations });

            const entry = result.mergeResultEntries[0];
            expect(entry.savedResource).toBe(operations[0].resource);
            expect(entry.toJSON()).not.toHaveProperty('savedResource');
        });

        test('AuditEvent writes never produce history docs or change events', async () => {
            const auditResource = makeResource({ id: 'audit-1', resourceType: 'AuditEvent' });
            await run({
                resourceType: 'AuditEvent',
                operations: [makeEntry({ resource: auditResource })]
            });

            expect(insertOneHistoryFn).not.toHaveBeenCalled();
            expect(postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('a clean write writes a cloned history doc and queues the change event asynchronously', async () => {
            await run();

            expect(insertOneHistoryFn).toHaveBeenCalledTimes(1);
            expect(cloneResource).toHaveBeenCalledTimes(1);
            expect(insertOneHistoryFn.mock.calls[0][0].doc.__cloned).toBe(true);
            expect(postSaveProcessor.needsSyncFor).toHaveBeenCalledWith({ resourceType: 'Patient' });
            expect(postRequestProcessor.add).toHaveBeenCalledTimes(1);
            // async mode defers, it does not call afterSaveAsync inline
            expect(postSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
        });

        test('needsSyncFor=true awaits afterSaveAsync inline instead of deferring it', async () => {
            postSaveProcessor.needsSyncFor.mockReturnValue(true);
            await run();

            expect(postSaveProcessor.afterSaveAsync).toHaveBeenCalledTimes(1);
            expect(postSaveProcessor.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'C', resourceType: 'Patient' })
            );
            expect(postRequestProcessor.add).not.toHaveBeenCalled();
        });
    });

    // ========================================================================================
    // SECURITY — tags must survive the bulk write path unmodified
    // ========================================================================================
    describe('security tag integrity through the bulk write path', () => {
        test('owner, access and sourceAssigningAuthority tags reach Mongo unmodified', async () => {
            const resource = makeResource({
                id: 'patient-secure',
                owner: 'client-a',
                access: 'client-a',
                sourceAssigningAuthority: 'client-a'
            });
            await run({ operations: [makeEntry({ resource })] });

            const [ops] = collection.bulkWrite.mock.calls[0];
            const written = ops[0].replaceOne.replacement;
            expect(written.meta.security).toEqual([
                { system: SecurityTagSystem.owner, code: 'client-a' },
                { system: SecurityTagSystem.access, code: 'client-a' },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: 'client-a' }
            ]);
        });

        test('two tenants in one batch never have their operations cross-assigned', async () => {
            const collectionA = { bulkWrite: jestGlobal.fn().mockResolvedValue(makeBulkWriteResult({ upsertedCount: 1 })) };
            const collectionB = { bulkWrite: jestGlobal.fn().mockResolvedValue(makeBulkWriteResult({ upsertedCount: 1 })) };
            resourceLocator.getCollectionNameForResource = jestGlobal.fn(
                (r) => `Patient_4_0_0_${r.meta.security.find((t) => t.system === SecurityTagSystem.owner).code}`
            );
            resourceLocator.getCollectionByNameAsync = jestGlobal.fn(async (name) =>
                name === 'Patient_4_0_0_client-b' ? collectionB : collectionA
            );

            await run({
                operations: [
                    makeEntry({ resource: makeResource({ id: 'p-a', owner: 'client-a', access: 'client-a' }) }),
                    makeEntry({ resource: makeResource({ id: 'p-b', owner: 'client-b', access: 'client-b' }) })
                ]
            });

            const aOwner = collectionA.bulkWrite.mock.calls[0][0][0].replaceOne.replacement
                .meta.security.find((t) => t.system === SecurityTagSystem.owner).code;
            const bOwner = collectionB.bulkWrite.mock.calls[0][0][0].replaceOne.replacement
                .meta.security.find((t) => t.system === SecurityTagSystem.owner).code;
            expect(aOwner).toBe('client-a');
            expect(bOwner).toBe('client-b');
        });

        test('the reported sourceAssigningAuthority comes from the entry, not a global default', async () => {
            const result = await run({
                operations: [makeEntry({ sourceAssigningAuthority: 'client-zeta' })]
            });
            expect(result.mergeResultEntries[0]._sourceAssigningAuthority).toBe('client-zeta');
        });
    });

    // ========================================================================================
    // executeBulkAsync — error handling
    // ========================================================================================
    describe('executeBulkAsync — error handling', () => {
        test('a non-doc-size bulkWrite failure is wrapped in a RethrownError and propagated', async () => {
            collection.bulkWrite.mockRejectedValue(new Error('connection reset'));

            await expect(run()).rejects.toThrow(RethrownError);
            await expect(run()).rejects.toThrow(/Error bulkWrite/);
        });

        test('an already-wrapped RethrownError is not double-wrapped', async () => {
            const inner = new RethrownError({ message: 'inner failure', error: new Error('root') });
            resourceLocator.getCollectionByNameAsync.mockRejectedValue(inner);

            await expect(run()).rejects.toBe(inner);
        });

        test('a prep-phase failure (null resource) is wrapped once in a RethrownError', async () => {
            await expect(run({ operations: [makeEntry({ resource: null })] })).rejects.toThrow(RethrownError);
        });

        test('a doc-size failure produces one error MergeResultEntry per operation instead of throwing', async () => {
            const sizeError = new MongoInvalidArgumentError(MONGO_ERROR.RESOURCE_SIZE_EXCEEDS);
            collection.bulkWrite.mockRejectedValue(sizeError);

            const result = await run({
                operations: [
                    makeEntry({ resource: makeResource({ id: 'p-1' }) }),
                    makeEntry({ resource: makeResource({ id: 'p-2' }) })
                ]
            });

            expect(result.error).toBe(sizeError);
            expect(result.mergeResultEntries).toHaveLength(2);
            for (const entry of result.mergeResultEntries) {
                expect(entry.created).toBe(false);
                expect(entry.updated).toBe(false);
                expect(Object.getPrototypeOf(entry.issue)).toBe(Object.prototype);
                expect(entry.issue).toEqual({
                    severity: 'error',
                    code: 'exception',
                    details: { text: expect.stringContaining('Error in one of the resources of Patient') },
                    diagnostics: expect.stringContaining('Error in one of the resources of Patient')
                });
            }
        });

        test('a bulkWrite write error is reported as a plain error issue naming the resource', async () => {
            collection.bulkWrite.mockResolvedValue(
                makeBulkWriteResult({ writeErrors: [makeWriteError({ code: 11000, errmsg: 'duplicate key' })] })
            );

            const result = await run();

            const entry = result.mergeResultEntries[0];
            expect(entry.created).toBe(false);
            expect(entry.updated).toBe(false);
            expect(Object.getPrototypeOf(entry.issue)).toBe(Object.prototype);
            expect(entry.issue).toEqual({
                severity: 'error',
                code: 'exception',
                details: { text: expect.stringContaining('duplicate key') },
                diagnostics: expect.stringContaining('duplicate key'),
                expression: ['Patient/uuid-patient-1']
            });
            expect(JSON.parse(JSON.stringify(entry)).issue).toEqual(entry.issue);
        });
    });

    // ========================================================================================
    // Concurrency resolution
    // ========================================================================================
    describe('concurrency resolution', () => {
        function patient (id, gender = 'male', versionId = '2') {
            return { ...makeResource({ id }), _uuid: `uuid-${id}`, meta: { ...makeResource({ id }).meta, versionId }, gender };
        }

        function createEntry (resource, overrides = {}) {
            return makeEntry({
                resource,
                operation: { updateOne: { filter: { _uuid: resource._uuid }, update: { $setOnInsert: resource }, upsert: true } },
                ...overrides
            });
        }

        function versionedEntry (resource) {
            return makeEntry({
                resource,
                operationType: 'merge',
                isCreateOperation: false,
                isUpdateOperation: true,
                operation: {
                    replaceOne: {
                        filter: { $and: [{ _uuid: resource._uuid }, { 'meta.versionId': '1' }] },
                        replacement: resource
                    }
                }
            });
        }

        function uuidOnlyEntry (resource, overrides = {}) {
            return makeEntry({
                resource,
                operationType: 'replace',
                isCreateOperation: false,
                isUpdateOperation: true,
                operation: { replaceOne: { filter: { _uuid: resource._uuid }, replacement: resource } },
                ...overrides
            });
        }

        test('only losing entries reach the resolver and winners are not replayed', async () => {
            const won = patient('p-1');
            const lost = patient('p-2');
            const storedForLost = patient('p-2', 'female');
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 1 }));
            updateManager.findLatestByUuidsAsync.mockResolvedValue(new Map([
                ['uuid-p-1', { ...won }],
                ['uuid-p-2', storedForLost]
            ]));
            const lostEntry = versionedEntry(lost);

            const result = await run({ operations: [versionedEntry(won), lostEntry] });

            expect(concurrentWriteResolver.resolveAsync).toHaveBeenCalledTimes(1);
            const call = concurrentWriteResolver.resolveAsync.mock.calls[0][0];
            expect(call.losers).toEqual([lostEntry]);
            expect(call.latestByUuid.get('uuid-p-2')).toBe(storedForLost);
            expect(call.cloneResource).toBe(cloneResource);
            expect(call.collection).toBe(collection);
            expect(updateManager.replaceOneAsync).not.toHaveBeenCalled();
            expect(result.mergeResultEntries[0].updated).toBe(true);
        });

        test('a lost create reaches the resolver', async () => {
            const entry = createEntry(patient('p-1', 'male', '1'));
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ upsertedCount: 0, upsertedIds: {} }));
            updateManager.findLatestByUuidsAsync.mockResolvedValue(new Map([['uuid-p-1', patient('p-1', 'female', '1')]]));

            await run({ operations: [entry] });

            expect(concurrentWriteResolver.resolveAsync.mock.calls[0][0].losers).toEqual([entry]);
            expect(updateManager.replaceOneAsync).not.toHaveBeenCalled();
        });

        test('a {_uuid}-only write whose document was deleted reaches the resolver', async () => {
            const entry = uuidOnlyEntry(patient('p-1'));
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 0 }));

            await run({ operations: [entry] });

            const call = concurrentWriteResolver.resolveAsync.mock.calls[0][0];
            expect(call.losers).toEqual([entry]);
            expect(call.latestByUuid.has('uuid-p-1')).toBe(false);
            expect(updateManager.replaceOneAsync).not.toHaveBeenCalled();
        });

        test('a {_uuid}-only write whose document exists is not replayed', async () => {
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 0 }));
            updateManager.findLatestByUuidsAsync.mockResolvedValue(new Map([['uuid-p-1', patient('p-1', 'female')]]));

            const result = await run({ operations: [uuidOnlyEntry(patient('p-1'))] });

            expect(updateManager.replaceOneAsync).not.toHaveBeenCalled();
            expect(concurrentWriteResolver.resolveAsync).not.toHaveBeenCalled();
            expect(result.mergeResultEntries[0].updated).toBe(true);
        });

        test('an If-Match update that lost throws PreconditionFailedError', async () => {
            const resource = patient('p-1');
            const entry = makeEntry({
                resource,
                operationType: 'replace',
                isCreateOperation: false,
                isUpdateOperation: true,
                writePrecondition: { ifMatchVersionIds: ['1'] },
                operation: {
                    replaceOne: {
                        filter: { $and: [{ _uuid: resource._uuid }, { 'meta.versionId': { $in: ['1'] } }] },
                        replacement: resource
                    }
                }
            });
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 0 }));
            updateManager.findLatestByUuidsAsync.mockResolvedValue(new Map([['uuid-p-1', patient('p-1', 'female', '3')]]));

            await expect(run({ operations: [entry] })).rejects.toMatchObject({ statusCode: 412 });
            expect(concurrentWriteResolver.resolveAsync).not.toHaveBeenCalled();
        });

        test('a conflict issue set by the resolver surfaces as a MergeResultEntry issue while winners report updated: true', async () => {
            const won = patient('p-1');
            const lostEntry = versionedEntry(patient('p-2'));
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ modifiedCount: 1 }));
            updateManager.findLatestByUuidsAsync.mockResolvedValue(new Map([
                ['uuid-p-1', { ...won }],
                ['uuid-p-2', patient('p-2', 'female')]
            ]));
            const issue = { severity: 'error', code: 'conflict', expression: ['Patient/uuid-p-2'] };
            concurrentWriteResolver.resolveAsync.mockImplementation(async ({ losers }) => {
                losers[0].issue = issue;
            });

            const result = await run({ operations: [versionedEntry(won), lostEntry] });

            expect(result.mergeResultEntries[0].updated).toBe(true);
            expect(result.mergeResultEntries[1].updated).toBe(false);
            expect(result.mergeResultEntries[1].issue).toBe(issue);
            expect(insertOneHistoryFn).toHaveBeenCalledTimes(1);
        });

        test('If-None-Match * still throws PreconditionFailedError before detection runs', async () => {
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ upsertedCount: 0 }));

            await expect(run({
                operations: [createEntry(patient('p-1', 'male', '1'), { writePrecondition: { rejectIfExists: true } })]
            })).rejects.toMatchObject({ statusCode: 412 });
            expect(updateManager.findLatestByUuidsAsync).not.toHaveBeenCalled();
        });

        test('handleConcurrency=false skips detection and the resolver', async () => {
            configManager.handleConcurrency = false;
            collection.bulkWrite.mockResolvedValue(makeBulkWriteResult({ upsertedCount: 0, modifiedCount: 0 }));

            await run({ operations: [createEntry(patient('p-1', 'male', '1')), uuidOnlyEntry(patient('p-2'))] });

            expect(updateManager.findLatestByUuidsAsync).not.toHaveBeenCalled();
            expect(concurrentWriteResolver.resolveAsync).not.toHaveBeenCalled();
            expect(updateManager.replaceOneAsync).not.toHaveBeenCalled();
        });
    });
});
