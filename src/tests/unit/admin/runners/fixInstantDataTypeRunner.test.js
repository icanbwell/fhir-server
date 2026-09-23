'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixInstantDataTypeRunner } = require('../../../../admin/runners/fixInstantDataTypeRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

function makeObservationDoc (overrides = {}) {
    return {
        _id: 'mongo-1',
        resourceType: 'Observation',
        id: 'obs1',
        _uuid: '3f4c9d7e-0000-4000-8000-0000000000aa',
        _sourceId: 'obs1',
        _sourceAssigningAuthority: 'tenantA',
        status: 'final',
        code: { text: 'heart rate' },
        meta: {
            versionId: '2',
            lastUpdated: '2024-01-02T03:04:05.000Z',
            source: 'https://connect.icanbwell.com/tenantA',
            security: [
                { system: SecurityTagSystem.owner, code: 'tenantA' },
                { system: SecurityTagSystem.access, code: 'tenantA' },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }
            ]
        },
        issued: '2023-05-06T07:08:09.000Z',
        ...overrides
    };
}

/**
 * Builds a mongo-ish find cursor over the supplied docs.
 * @param {Object[]} docs
 */
function makeFindCursor (docs) {
    let i = 0;
    return {
        hasNext: jestGlobal.fn().mockImplementation(async () => i < docs.length),
        next: jestGlobal.fn().mockImplementation(async () => docs[i++])
    };
}

describe('FixInstantDataTypeRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });

        runner = new FixInstantDataTypeRunner({
            mongoDatabaseManager: mockMongoDatabaseManager,
            collections: ['Observation_4_0_0'],
            batchSize: 100,
            adminLogger: mockAdminLogger,
            startFromCollection: undefined,
            limit: undefined,
            useTransaction: false,
            skip: undefined,
            startFromId: undefined
        });
    });

    // =====================================================
    // processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('converts an instant field stored as a string into a Date', async () => {
            const operations = await runner.processRecordAsync(makeObservationDoc());

            expect(operations).toHaveLength(1);
            const replacement = operations[0].replaceOne.replacement;
            expect(replacement.issued).toBeInstanceOf(Date);
            expect(replacement.issued.toISOString()).toBe('2023-05-06T07:08:09.000Z');
        });

        test('converts meta.lastUpdated from a string into a Date', async () => {
            const operations = await runner.processRecordAsync(makeObservationDoc());

            const replacement = operations[0].replaceOne.replacement;
            expect(replacement.meta.lastUpdated).toBeInstanceOf(Date);
            expect(replacement.meta.lastUpdated.toISOString()).toBe('2024-01-02T03:04:05.000Z');
        });

        test('SEC-META-PRESERVE: rewritten document keeps every owner/access/sourceAssigningAuthority tag', async () => {
            // A bulk rewrite that drops meta.security silently makes the resource unreadable to its
            // tenant (or, worse, readable by all of them). The replacement must carry the tags through.
            const operations = await runner.processRecordAsync(makeObservationDoc());

            const security = operations[0].replaceOne.replacement.meta.security;
            expect(security).toEqual(expect.arrayContaining([
                expect.objectContaining({ system: SecurityTagSystem.owner, code: 'tenantA' }),
                expect.objectContaining({ system: SecurityTagSystem.access, code: 'tenantA' }),
                expect.objectContaining({
                    system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA'
                })
            ]));
            expect(security).toHaveLength(3);
        });

        test('SEC-INTERNAL-FIELDS: rewritten document keeps _uuid, _sourceId and _sourceAssigningAuthority', async () => {
            const operations = await runner.processRecordAsync(makeObservationDoc());

            const replacement = operations[0].replaceOne.replacement;
            expect(replacement._uuid).toBe('3f4c9d7e-0000-4000-8000-0000000000aa');
            expect(replacement._sourceId).toBe('obs1');
            expect(replacement._sourceAssigningAuthority).toBe('tenantA');
        });

        test('returns no operations when the instant field is already a Date', async () => {
            const doc = makeObservationDoc({
                issued: new Date('2023-05-06T07:08:09.000Z'),
                meta: {
                    versionId: '2',
                    lastUpdated: new Date('2024-01-02T03:04:05.000Z'),
                    source: 'https://connect.icanbwell.com/tenantA',
                    security: [{ system: SecurityTagSystem.owner, code: 'tenantA' }]
                }
            });

            const operations = await runner.processRecordAsync(doc);

            expect(operations).toEqual([]);
        });

        test('leaves a non-instant dateTime field (effectiveDateTime) as a string', async () => {
            const doc = makeObservationDoc({ effectiveDateTime: '2023-03-03T00:00:00.000Z' });

            const operations = await runner.processRecordAsync(doc);

            const replacement = operations[0].replaceOne.replacement;
            expect(replacement.effectiveDateTime).toBe('2023-03-03T00:00:00.000Z');
            expect(replacement.effectiveDateTime).not.toBeInstanceOf(Date);
        });

        test('leaves an unparseable instant value untouched rather than writing Invalid Date', async () => {
            const doc = makeObservationDoc({ issued: 'not-a-date' });

            const operations = await runner.processRecordAsync(doc);

            // the only change should be meta.lastUpdated; issued stays the original string
            const replacement = operations[0].replaceOne.replacement;
            expect(replacement.issued).toBe('not-a-date');
        });

        test('targets the replace at the document _id', async () => {
            const operations = await runner.processRecordAsync(
                makeObservationDoc({ _id: 'mongo-object-id-xyz' })
            );

            expect(operations[0].replaceOne.filter).toEqual({ _id: 'mongo-object-id-xyz' });
        });

        test('wraps failures in a RethrownError naming the runner as source', async () => {
            await expect(runner.processRecordAsync(null)).rejects.toThrow(/Error processing record/);
        });
    });

    // =====================================================
    // getResourceUuidsAsync
    // =====================================================
    describe('getResourceUuidsAsync', () => {
        let mockSession;
        let mockClient;

        beforeEach(() => {
            mockSession = { endSession: jestGlobal.fn().mockResolvedValue(undefined) };
            mockClient = { close: jestGlobal.fn().mockResolvedValue(undefined) };
        });

        test('collects every _uuid from the collection cursor', async () => {
            const cursor = makeFindCursor([
                { _uuid: 'u1' }, { _uuid: 'u2' }, { _uuid: 'u3' }
            ]);
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: { find: jestGlobal.fn().mockReturnValue(cursor) },
                client: mockClient,
                session: mockSession
            });

            const result = await runner.getResourceUuidsAsync({ collectionName: 'Observation_4_0_0' });

            expect(result).toEqual(['u1', 'u2', 'u3']);
        });

        test('returns an empty list for an empty collection', async () => {
            const cursor = makeFindCursor([]);
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: { find: jestGlobal.fn().mockReturnValue(cursor) },
                client: mockClient,
                session: mockSession
            });

            const result = await runner.getResourceUuidsAsync({ collectionName: 'Observation_4_0_0' });

            expect(result).toEqual([]);
        });

        test('always ends the session and closes the client on success', async () => {
            const cursor = makeFindCursor([{ _uuid: 'u1' }]);
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: { find: jestGlobal.fn().mockReturnValue(cursor) },
                client: mockClient,
                session: mockSession
            });

            await runner.getResourceUuidsAsync({ collectionName: 'Observation_4_0_0' });

            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });

        test('ends the session, closes the client and rethrows when the cursor fails', async () => {
            const cursor = {
                hasNext: jestGlobal.fn().mockRejectedValue(new Error('cursor killed')),
                next: jestGlobal.fn()
            };
            runner.createSingeConnectionAsync = jestGlobal.fn().mockResolvedValue({
                collection: { find: jestGlobal.fn().mockReturnValue(cursor) },
                client: mockClient,
                session: mockSession
            });

            await expect(
                runner.getResourceUuidsAsync({ collectionName: 'Observation_4_0_0' })
            ).rejects.toThrow('cursor killed');

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('cursor killed'),
                expect.any(Object)
            );
            expect(mockSession.endSession).toHaveBeenCalledTimes(1);
            expect(mockClient.close).toHaveBeenCalledTimes(1);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        beforeEach(() => {
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');
        });

        test('skips collections whose resource type has no instant fields', async () => {
            runner.collections = ['Patient_4_0_0'];
            runner.getResourceUuidsAsync = jestGlobal.fn();

            await runner.processAsync();

            expect(runner.getResourceUuidsAsync).not.toHaveBeenCalled();
            expect(runner.runForQueryBatchesAsync).not.toHaveBeenCalled();
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                'Patient_4_0_0 has no dateTime fields. Skipping'
            );
        });

        test('processes collections whose resource type does have instant fields', async () => {
            runner.collections = ['Observation_4_0_0'];
            runner.getResourceUuidsAsync = jestGlobal.fn().mockResolvedValue(['u1']);

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync).toHaveBeenCalledTimes(1);
            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].sourceCollectionName)
                .toBe('Observation_4_0_0');
        });

        test('does nothing when a collection has zero uuids', async () => {
            runner.collections = ['Observation_4_0_0'];
            runner.getResourceUuidsAsync = jestGlobal.fn().mockResolvedValue([]);

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync).not.toHaveBeenCalled();
        });

        test('writes the final partial batch (5 uuids at batchSize 2 -> 2,2,1)', async () => {
            runner.batchSize = 2;
            runner.collections = ['Observation_4_0_0'];
            runner.getResourceUuidsAsync = jestGlobal.fn()
                .mockResolvedValue(['u1', 'u2', 'u3', 'u4', 'u5']);

            await runner.processAsync();

            const batches = runner.runForQueryBatchesAsync.mock.calls.map(
                (c) => c[0].query._uuid.$in
            );
            expect(batches).toEqual([['u1', 'u2'], ['u3', 'u4'], ['u5']]);
        });

        test('a single uuid still produces exactly one batch', async () => {
            runner.batchSize = 10;
            runner.collections = ['Observation_4_0_0'];
            runner.getResourceUuidsAsync = jestGlobal.fn().mockResolvedValue(['only-one']);

            await runner.processAsync();

            expect(runner.runForQueryBatchesAsync).toHaveBeenCalledTimes(1);
            expect(runner.runForQueryBatchesAsync.mock.calls[0][0].query._uuid.$in)
                .toEqual(['only-one']);
        });

        test('varying batchSize changes the chunk sizes sent to mongo', async () => {
            runner.collections = ['Observation_4_0_0'];
            runner.getResourceUuidsAsync = jestGlobal.fn()
                .mockImplementation(async () => ['u1', 'u2', 'u3', 'u4']);

            runner.batchSize = 4;
            await runner.processAsync();
            const batchesOfFour = runner.runForQueryBatchesAsync.mock.calls.map(
                (c) => c[0].query._uuid.$in
            );

            runner.runForQueryBatchesAsync.mockClear();
            runner.batchSize = 1;
            runner.collections = ['Observation_4_0_0'];
            await runner.processAsync();
            const batchesOfOne = runner.runForQueryBatchesAsync.mock.calls.map(
                (c) => c[0].query._uuid.$in
            );

            expect(batchesOfFour).toEqual([['u1', 'u2', 'u3', 'u4']]);
            expect(batchesOfOne).toEqual([['u1'], ['u2'], ['u3'], ['u4']]);
        });

        test('expands the "all" sentinel, sorts, and honours startFromCollection', async () => {
            runner.collections = ['all'];
            runner.startFromCollection = 'Provenance_4_0_0';
            runner.getAllCollectionNamesAsync = jestGlobal.fn().mockResolvedValue([
                'Task_4_0_0', 'Observation_4_0_0', 'Provenance_4_0_0', 'Appointment_4_0_0'
            ]);
            runner.getResourceUuidsAsync = jestGlobal.fn().mockResolvedValue([]);

            await runner.processAsync();

            expect(runner.getAllCollectionNamesAsync).toHaveBeenCalledWith({
                useAuditDatabase: false,
                useAccessLogsDatabase: false,
                includeHistoryCollections: false
            });
            expect(runner.collections).toEqual(['Provenance_4_0_0', 'Task_4_0_0']);
        });

        test('passes the runner flags (useTransaction/limit/skip) through to the batch runner', async () => {
            runner.collections = ['Observation_4_0_0'];
            runner.useTransaction = true;
            runner.limit = 50;
            runner.skip = 10;
            runner.getResourceUuidsAsync = jestGlobal.fn().mockResolvedValue(['u1']);

            await runner.processAsync();

            const call = runner.runForQueryBatchesAsync.mock.calls[0][0];
            expect(call.useTransaction).toBe(true);
            expect(call.limit).toBe(50);
            expect(call.skip).toBe(10);
            expect(call.ordered).toBe(false);
            expect(call.skipExistingIds).toBe(false);
        });
    });
});
