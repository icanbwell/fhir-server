const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: () => {},
    assertIsValid: () => {}
}));
jest.mock('../../../../operations/common/logging', () => ({
    ...jest.requireActual('../../../../operations/common/logging'),
    logInfo: jest.fn()
}));

const { MongoBulkWriteError } = require('mongodb');
const { ConcurrentWriteResolver } = require('../../../../dataLayer/concurrency/concurrentWriteResolver');
const { BulkInsertUpdateEntry } = require('../../../../dataLayer/bulkInsertUpdateEntry');
const { ForbiddenError } = require('../../../../utils/httpErrors');
const { logInfo } = require('../../../../operations/common/logging');

function makePatient ({ uuid = 'u-1', versionId = '2', gender = 'male', extra = {} } = {}) {
    return {
        resourceType: 'Patient',
        id: `id-${uuid}`,
        _uuid: uuid,
        _sourceAssigningAuthority: 'client-a',
        meta: { versionId, source: 'test' },
        gender,
        ...extra
    };
}

function makeUpdateEntry (resource, { smartMerge = true } = {}) {
    return new BulkInsertUpdateEntry({
        operationType: 'merge',
        isCreateOperation: false,
        isUpdateOperation: true,
        resourceType: 'Patient',
        id: resource.id,
        uuid: resource._uuid,
        sourceAssigningAuthority: 'client-a',
        resource,
        operation: {
            replaceOne: {
                filter: { $and: [{ _uuid: resource._uuid }, { 'meta.versionId': `${parseInt(resource.meta.versionId) - 1}` }] },
                replacement: resource
            }
        },
        patches: null,
        skipped: false,
        smartMerge
    });
}

function makeCreateEntry (resource, { smartMerge = true } = {}) {
    return new BulkInsertUpdateEntry({
        operationType: 'insertUniqueId',
        isCreateOperation: true,
        isUpdateOperation: false,
        resourceType: 'Patient',
        id: resource.id,
        uuid: resource._uuid,
        sourceAssigningAuthority: 'client-a',
        resource,
        operation: { updateOne: { filter: { _uuid: resource._uuid }, update: { $setOnInsert: resource }, upsert: true } },
        patches: null,
        skipped: false,
        smartMerge
    });
}

function bulkWriteResult ({ modifiedCount = 0, upsertedIds = {} } = {}) {
    return { modifiedCount, upsertedIds };
}

const noLosers = { losers: [], latestByUuid: new Map(), ifMatchMisses: [], missingUuidOnly: [] };

describe('ConcurrentWriteResolver', () => {
    let configManager;
    let base64DataManager;
    let scopesValidator;
    let writeConflictDetector;
    let sleep;
    let updateManager;
    let collection;
    let resolver;
    const requestInfo = { requestId: 'req-1' };
    const cloneResource = (r) => ({ ...r, __copy: true });

    beforeEach(() => {
        configManager = { concurrencyResolutionRounds: 3, concurrencyResolutionBackoffMs: 25 };
        base64DataManager = { deleteOwnUploadedLiveObjectsAsync: jest.fn().mockResolvedValue(undefined) };
        scopesValidator = {
            isAccessToResourceAllowedByAccessAndPatientScopes: jest.fn().mockResolvedValue(true),
            isAccessTagChangeAllowedByAccessScopes: jest.fn().mockReturnValue(true)
        };
        writeConflictDetector = { detectAsync: jest.fn().mockResolvedValue(noLosers) };
        sleep = jest.fn().mockResolvedValue(undefined);
        updateManager = {
            rebaseOnLatestAsync: jest.fn(async ({ currentResource }) => ({
                updatedResource: { ...currentResource, meta: { ...currentResource.meta, versionId: `${parseInt(currentResource.meta.versionId) + 1}` } },
                patches: [{ op: 'replace', path: '/gender' }]
            })),
            toWriteDocument: jest.fn((doc) => doc),
            findLatestByUuidsAsync: jest.fn()
        };
        collection = { bulkWrite: jest.fn().mockResolvedValue(bulkWriteResult({ modifiedCount: 1 })) };
        resolver = new ConcurrentWriteResolver({
            configManager, base64DataManager, scopesValidator, writeConflictDetector, sleep, random: () => 1
        });
    });

    function resolve (losers, latestByUuid) {
        return resolver.resolveAsync({
            base_version: '4_0_0', requestInfo, collection, losers, latestByUuid, updateManager, cloneResource
        });
    }

    test('a loser that wins in round 1 is rebased once and gets no issue', async () => {
        const entry = makeUpdateEntry(makePatient({ versionId: '2' }));
        const stored = makePatient({ versionId: '2', gender: 'female' });

        await resolve([entry], new Map([['u-1', stored]]));

        expect(updateManager.rebaseOnLatestAsync).toHaveBeenCalledTimes(1);
        expect(collection.bulkWrite).toHaveBeenCalledTimes(1);
        expect(collection.bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
        expect(entry.issue).toBeNull();
        expect(entry.resource.meta.versionId).toBe('3');
        expect(entry.patches).toEqual([{ op: 'replace', path: '/gender' }]);
        expect(entry.operation.replaceOne.filter).toEqual({ $and: [{ _uuid: 'u-1' }, { 'meta.versionId': '2' }] });
    });

    test('only losers are rewritten, never winners', async () => {
        const losers = [makeUpdateEntry(makePatient({ uuid: 'u-1' })), makeUpdateEntry(makePatient({ uuid: 'u-3' }))];
        const latest = new Map([['u-1', makePatient({ uuid: 'u-1' })], ['u-3', makePatient({ uuid: 'u-3' })]]);

        await resolve(losers, latest);

        const written = collection.bulkWrite.mock.calls[0][0].map((op) => op.replaceOne.replacement._uuid);
        expect(written).toEqual(['u-1', 'u-3']);
    });

    test('each round rebases on the detector read and the resolver reads nothing itself', async () => {
        const entry = makeUpdateEntry(makePatient());
        const round1Stored = makePatient({ versionId: '2', gender: 'female' });
        const round2Stored = makePatient({ versionId: '4', gender: 'other' });
        writeConflictDetector.detectAsync.mockResolvedValueOnce({
            ...noLosers, losers: [entry], latestByUuid: new Map([['u-1', round2Stored]])
        });

        await resolve([entry], new Map([['u-1', round1Stored]]));

        expect(updateManager.rebaseOnLatestAsync.mock.calls[0][0].currentResource).toBe(round1Stored);
        expect(updateManager.rebaseOnLatestAsync.mock.calls[1][0].currentResource).toBe(round2Stored);
        expect(updateManager.findLatestByUuidsAsync).not.toHaveBeenCalled();
    });

    test.each([true, false])('the rebase uses the entry smartMerge %s', async (smartMerge) => {
        const entry = makeUpdateEntry(makePatient(), { smartMerge });

        await resolve([entry], new Map([['u-1', makePatient({ gender: 'female' })]]));

        expect(updateManager.rebaseOnLatestAsync).toHaveBeenCalledWith(expect.objectContaining({ smartMerge }));
        expect(scopesValidator.isAccessTagChangeAllowedByAccessScopes).toHaveBeenCalledWith(
            expect.objectContaining({ ignoreRemovals: smartMerge, accessRequested: 'u' })
        );
    });

    test('a lost create is rebased as an update and flipped to update flags', async () => {
        const entry = makeCreateEntry(makePatient({ versionId: '1' }));

        await resolve([entry], new Map([['u-1', makePatient({ versionId: '1', gender: 'female' })]]));

        expect(entry.isCreateOperation).toBe(false);
        expect(entry.isUpdateOperation).toBe(true);
        expect(entry.operationType).toBe('merge');
        expect(entry.operation.replaceOne.filter).toEqual({ $and: [{ _uuid: 'u-1' }, { 'meta.versionId': '1' }] });
    });

    test('losers still conflicting after the configured rounds get a conflict issue', async () => {
        const entry = makeUpdateEntry(makePatient());
        writeConflictDetector.detectAsync.mockImplementation(async () => ({
            ...noLosers, losers: [entry], latestByUuid: new Map([['u-1', makePatient({ versionId: '9' })]])
        }));

        await resolve([entry], new Map([['u-1', makePatient({ versionId: '5' })]]));

        expect(collection.bulkWrite).toHaveBeenCalledTimes(3);
        expect(entry.issue).toEqual(expect.objectContaining({
            severity: 'error',
            code: 'conflict',
            details: { text: 'Concurrent update conflict' },
            diagnostics: 'Resource Patient/u-1 was modified concurrently and could not be saved after 3 attempts',
            expression: ['Patient/u-1']
        }));
    });

    test('a rebase that finds no change is skipped and carries the stored document', async () => {
        const entry = makeUpdateEntry(makePatient());
        const stored = makePatient({ versionId: '2', gender: 'female' });
        updateManager.rebaseOnLatestAsync.mockResolvedValue({ updatedResource: null, patches: null });

        await resolve([entry], new Map([['u-1', stored]]));

        expect(entry.skipped).toBe(true);
        expect(entry.resource).toBe(stored);
        expect(entry.issue).toBeNull();
        expect(collection.bulkWrite).not.toHaveBeenCalled();
    });

    test('a lost create whose document vanished is re-queued as an insertUniqueId upsert', async () => {
        const resource = makePatient({ versionId: '1' });
        const entry = makeCreateEntry(resource);

        await resolve([entry], new Map());

        expect(updateManager.rebaseOnLatestAsync).not.toHaveBeenCalled();
        expect(entry.operationType).toBe('insertUniqueId');
        expect(entry.isCreateOperation).toBe(true);
        expect(collection.bulkWrite.mock.calls[0][0]).toEqual([
            { updateOne: { filter: { _uuid: 'u-1' }, update: { $setOnInsert: resource }, upsert: true } }
        ]);
        expect(entry.issue).toBeNull();
    });

    test('an update target deleted concurrently gets a conflict issue', async () => {
        const entry = makeUpdateEntry(makePatient());

        await resolve([entry], new Map());

        expect(entry.issue.code).toBe('conflict');
        expect(entry.issue.expression).toEqual(['Patient/u-1']);
        expect(collection.bulkWrite).not.toHaveBeenCalled();
    });

    test.each([
        ['isAccessToResourceAllowedByAccessAndPatientScopes', 'mockRejectedValue'],
        ['isAccessTagChangeAllowedByAccessScopes', 'mockImplementation']
    ])('a rebased write refused by %s gets a forbidden issue and operationOutcome and is not written', async (method, mockKind) => {
        const error = new ForbiddenError('user cannot write Patient');
        if (mockKind === 'mockRejectedValue') {
            scopesValidator[method].mockRejectedValue(error);
        } else {
            scopesValidator[method].mockImplementation(() => { throw error; });
        }
        const entry = makeUpdateEntry(makePatient());

        await resolve([entry], new Map([['u-1', makePatient({ gender: 'female' })]]));

        expect(entry.issue.code).toBe('forbidden');
        expect(entry.operationOutcome.resourceType).toBe('OperationOutcome');
        expect(entry.operationOutcome.issue[0].code).toBe('forbidden');
        expect(collection.bulkWrite).not.toHaveBeenCalled();
    });

    test('an access check error other than 403 is rethrown', async () => {
        scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes.mockRejectedValue(new Error('boom'));

        await expect(
            resolve([makeUpdateEntry(makePatient())], new Map([['u-1', makePatient({ gender: 'female' })]]))
        ).rejects.toThrow('boom');
    });

    test('the access check gets a copy of the rebase target', async () => {
        const stored = makePatient({ gender: 'female' });

        await resolve([makeUpdateEntry(makePatient())], new Map([['u-1', stored]]));

        const checked = scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes.mock.calls[0][0];
        expect(checked.resource).not.toBe(stored);
        expect(checked.resource.__copy).toBe(true);
        expect(checked).toEqual(expect.objectContaining({ accessRequested: 'u', base_version: '4_0_0' }));
        expect(scopesValidator.isAccessTagChangeAllowedByAccessScopes.mock.calls[0][0].currentResource).toBe(stored);
    });

    test('a non-duplicate-key write error marks only that entry with an exception issue', async () => {
        const first = makeUpdateEntry(makePatient({ uuid: 'u-1' }));
        const second = makeUpdateEntry(makePatient({ uuid: 'u-2' }));
        const result = bulkWriteResult({ modifiedCount: 1 });
        collection.bulkWrite.mockRejectedValue(new MongoBulkWriteError(
            { message: 'write failed', code: 2, writeErrors: [{ index: 0, code: 2, errmsg: 'bad value' }] },
            result
        ));

        await resolve([first, second], new Map([['u-1', makePatient({ uuid: 'u-1' })], ['u-2', makePatient({ uuid: 'u-2' })]]));

        expect(first.issue).toEqual(expect.objectContaining({ code: 'exception', diagnostics: 'bad value' }));
        expect(second.issue).toBeNull();
        const detection = writeConflictDetector.detectAsync.mock.calls[0][0];
        expect(detection.bulkWriteResult).toBe(result);
        expect(detection.entries).toEqual([{ entry: second, index: 1 }]);
    });

    test('a duplicate-key write error keeps the entry for detection', async () => {
        const entry = makeCreateEntry(makePatient({ versionId: '1' }));
        collection.bulkWrite.mockRejectedValue(new MongoBulkWriteError(
            { message: 'dup', code: 11000, writeErrors: [{ index: 0, code: 11000, errmsg: 'E11000 duplicate key' }] },
            bulkWriteResult()
        ));

        await resolve([entry], new Map());

        expect(entry.issue).toBeNull();
        expect(writeConflictDetector.detectAsync.mock.calls[0][0].entries).toEqual([{ entry, index: 0 }]);
    });

    test('a bulkWrite failure that is not a MongoBulkWriteError is rethrown', async () => {
        collection.bulkWrite.mockRejectedValue(new Error('connection reset'));

        await expect(
            resolve([makeUpdateEntry(makePatient())], new Map([['u-1', makePatient({ gender: 'female' })]]))
        ).rejects.toThrow();
    });

    test('an oversized rebased write gets an exception issue and the rest of the round is written', async () => {
        const big = makeUpdateEntry(makePatient({ uuid: 'u-big' }));
        const small = makeUpdateEntry(makePatient({ uuid: 'u-small' }));
        const hugeText = 'x'.repeat(16 * 1024 * 1024);
        const latest = new Map([
            ['u-big', makePatient({ uuid: 'u-big', extra: { text: { status: 'generated', div: hugeText } } })],
            ['u-small', makePatient({ uuid: 'u-small' })]
        ]);

        await resolve([big, small], latest);

        expect(big.issue).toEqual(expect.objectContaining({
            code: 'exception', diagnostics: 'Document is larger than the maximum size 16777216'
        }));
        const written = collection.bulkWrite.mock.calls[0][0].map((op) => op.replaceOne.replacement._uuid);
        expect(written).toEqual(['u-small']);
    });

    describe('uploaded binaries', () => {
        test.each([
            {
                name: 'a last-round conflict at the entry version',
                storedGender: 'other',
                setup: (entry) => {
                    writeConflictDetector.detectAsync.mockImplementation(async () => ({
                        ...noLosers, losers: [entry], latestByUuid: new Map([['u-1', makePatient({ versionId: entry.resource.meta.versionId, gender: 'other' })]])
                    }));
                }
            },
            {
                name: 'a forbidden rebase',
                storedGender: 'female',
                setup: () => scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes.mockRejectedValue(new ForbiddenError('no'))
            },
            {
                name: 'a write error',
                storedGender: 'female',
                setup: () => collection.bulkWrite.mockRejectedValue(new MongoBulkWriteError(
                    { message: 'x', code: 2, writeErrors: [{ index: 0, code: 2, errmsg: 'bad' }] }, bulkWriteResult()
                ))
            },
            {
                name: 'a skipped rebase',
                storedGender: 'female',
                setup: () => updateManager.rebaseOnLatestAsync.mockResolvedValue({ updatedResource: null, patches: null })
            }
        ])('are deleted for $name when no write of the entry can have committed', async ({ setup, storedGender }) => {
            const entry = makeUpdateEntry(makePatient({ versionId: '2' }));
            setup(entry);
            const uncommitted = entry.resource;

            await resolve([entry], new Map([['u-1', makePatient({ versionId: '2', gender: 'female' })]]));

            expect(base64DataManager.deleteOwnUploadedLiveObjectsAsync).toHaveBeenCalledTimes(1);
            const deleted = base64DataManager.deleteOwnUploadedLiveObjectsAsync.mock.calls[0][0];
            expect(deleted === uncommitted || deleted._uuid === 'u-1').toBe(true);
            expect(base64DataManager.deleteOwnUploadedLiveObjectsAsync.mock.calls[0][1]).toBe(requestInfo);
            // objects the stored document still references are kept by the delete
            expect(base64DataManager.deleteOwnUploadedLiveObjectsAsync.mock.calls[0][2].keepReferencedBy.gender).toBe(storedGender);
        });

        test('are kept when the stored version is past the entry version, since its write may have committed', async () => {
            const entry = makeUpdateEntry(makePatient({ versionId: '2' }));
            updateManager.rebaseOnLatestAsync.mockResolvedValue({ updatedResource: null, patches: null });

            await resolve([entry], new Map([['u-1', makePatient({ versionId: '3', gender: 'female' })]]));

            expect(entry.skipped).toBe(true);
            expect(base64DataManager.deleteOwnUploadedLiveObjectsAsync).not.toHaveBeenCalled();
        });

        test('are never deleted for an entry that wins a retry round', async () => {
            await resolve([makeUpdateEntry(makePatient())], new Map([['u-1', makePatient({ gender: 'female' })]]));

            expect(base64DataManager.deleteOwnUploadedLiveObjectsAsync).not.toHaveBeenCalled();
        });
    });

    test('logs one summary with counts by outcome and the unsaved uuids, never the resources', async () => {
        logInfo.mockClear();
        const saved = makeUpdateEntry(makePatient({ uuid: 'u-1' }));
        const conflicted = makeUpdateEntry(makePatient({ uuid: 'u-2' }));
        writeConflictDetector.detectAsync.mockImplementation(async () => ({
            ...noLosers, losers: [conflicted], latestByUuid: new Map([['u-2', makePatient({ uuid: 'u-2', versionId: '9' })]])
        }));

        await resolve([saved, conflicted], new Map([['u-1', makePatient({ uuid: 'u-1' })], ['u-2', makePatient({ uuid: 'u-2' })]]));

        expect(logInfo).toHaveBeenCalledTimes(1);
        expect(logInfo).toHaveBeenCalledWith('Resolved concurrent writes', {
            source: 'ConcurrentWriteResolver',
            requestId: 'req-1',
            resourceType: 'Patient',
            losers: 2,
            roundsUsed: 3,
            outcomes: { saved: 1, conflict: 1 },
            unsavedUuids: ['u-2']
        });
    });

    test('backoff before round r is random()*base*2^(r-1)', async () => {
        const entry = makeUpdateEntry(makePatient());
        writeConflictDetector.detectAsync.mockImplementation(async () => ({
            ...noLosers, losers: [entry], latestByUuid: new Map([['u-1', makePatient({ versionId: '9' })]])
        }));

        await resolve([entry], new Map([['u-1', makePatient({ versionId: '5' })]]));

        expect(sleep.mock.calls.map((c) => c[0])).toEqual([25, 50, 100]);
    });
});
