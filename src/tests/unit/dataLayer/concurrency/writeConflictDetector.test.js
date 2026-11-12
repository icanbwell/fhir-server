const { describe, test, expect, jest } = require('@jest/globals');
const { WriteConflictDetector } = require('../../../../dataLayer/concurrency/writeConflictDetector');
const { BulkInsertUpdateEntry } = require('../../../../dataLayer/bulkInsertUpdateEntry');

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

function makeEntry ({ operationType, operation, resource, isCreateOperation = false }) {
    return new BulkInsertUpdateEntry({
        operationType,
        isCreateOperation,
        isUpdateOperation: !isCreateOperation,
        resourceType: 'Patient',
        id: resource.id,
        uuid: resource._uuid,
        sourceAssigningAuthority: 'client-a',
        resource,
        operation,
        patches: null,
        skipped: false
    });
}

function createEntry (resource) {
    return makeEntry({
        operationType: 'insertUniqueId',
        isCreateOperation: true,
        resource,
        operation: { updateOne: { filter: { _uuid: resource._uuid }, update: { $setOnInsert: resource }, upsert: true } }
    });
}

function versionedEntry (resource, previousVersionId = '1') {
    return makeEntry({
        operationType: 'merge',
        resource,
        operation: {
            replaceOne: {
                filter: { $and: [{ _uuid: resource._uuid }, { 'meta.versionId': previousVersionId }] },
                upsert: false,
                replacement: resource
            }
        }
    });
}

function ifMatchEntry (resource) {
    const entry = makeEntry({
        operationType: 'replace',
        resource,
        operation: {
            replaceOne: {
                filter: { $and: [{ _uuid: resource._uuid }, { 'meta.versionId': { $in: ['1'] } }] },
                upsert: false,
                replacement: resource
            }
        }
    });
    entry.writePrecondition = { ifMatchVersionIds: ['1'] };
    return entry;
}

function uuidOnlyReplaceEntry (resource) {
    return makeEntry({
        operationType: 'replace',
        resource,
        operation: { replaceOne: { filter: { _uuid: resource._uuid }, upsert: false, replacement: resource } }
    });
}

function nullFilterEntry (resource) {
    return makeEntry({
        operationType: 'merge',
        resource,
        operation: { replaceOne: { filter: null, replacement: resource } }
    });
}

function makeUpdateManager (stored = []) {
    return {
        findLatestByUuidsAsync: jest.fn().mockResolvedValue(new Map(stored.map((d) => [d._uuid, d])))
    };
}

describe('WriteConflictDetector', () => {
    const detector = new WriteConflictDetector();

    describe('detectAsync', () => {
        const winner = makePatient({ uuid: 'u-1', versionId: '2', gender: 'male' });
        const otherWriter = makePatient({ uuid: 'u-1', versionId: '2', gender: 'female' });
        const later = makePatient({ uuid: 'u-1', versionId: '3', gender: 'male' });

        test.each([
            {
                name: 'a create whose index is in upsertedIds as won',
                entry: createEntry(winner),
                bulkWriteResult: { upsertedIds: { 0: 'x' }, modifiedCount: 0 },
                stored: [],
                expected: { losers: 0 }
            },
            {
                name: 'a create whose index is not in upsertedIds as lost, with the stored document',
                entry: createEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 1, latest: otherWriter }
            },
            {
                name: 'a versioned update whose stored document equals its replacement as won',
                entry: versionedEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [makePatient({ uuid: 'u-1', versionId: '2', gender: 'male' })],
                expected: { losers: 0 }
            },
            {
                name: 'a versioned update whose stored document has another writer content at the same version as lost',
                entry: versionedEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 1, latest: otherWriter }
            },
            {
                name: 'a versioned update with a higher version stored as lost',
                entry: versionedEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [later],
                expected: { losers: 1, latest: later }
            },
            {
                name: 'a versioned update whose document is missing as lost, without a stored document',
                entry: versionedEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [],
                expected: { losers: 1, latest: undefined }
            },
            {
                name: 'a versioned update that differs only by values the write serializer drops as won',
                entry: versionedEntry(makePatient({ uuid: 'u-1', extra: { birthDate: undefined, name: [] } })),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [makePatient({ uuid: 'u-1' })],
                expected: { losers: 0 }
            },
            {
                name: 'an If-Match update whose stored document differs as lost',
                entry: ifMatchEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 1, latest: otherWriter }
            },
            {
                name: 'a {_uuid}-only replace whose document exists as won',
                entry: uuidOnlyReplaceEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 0 }
            },
            {
                name: 'a {_uuid}-only replace whose document was deleted as lost, without a stored document',
                entry: uuidOnlyReplaceEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [],
                expected: { losers: 1, latest: undefined }
            },
            {
                name: 'a repeat write with a null filter whose document exists as won',
                entry: nullFilterEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 0 }
            },
            {
                name: 'an If-Match: * replace whose document was deleted as lost',
                entry: Object.assign(uuidOnlyReplaceEntry(winner), { writePrecondition: { ifMatchVersionIds: ['*'] } }),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [],
                expected: { losers: 1, latest: undefined }
            },
            {
                name: 'a versioned update equal to the stored document when matchedCount is 0 as lost (an identical write by another request)',
                entry: versionedEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0, matchedCount: 0 },
                stored: [makePatient({ uuid: 'u-1', versionId: '2', gender: 'male' })],
                expected: { losers: 1, latest: expect.objectContaining({ _uuid: 'u-1' }) }
            },
            {
                name: 'a versioned update equal to the stored document when matchedCount is 1 as won',
                entry: versionedEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0, matchedCount: 1 },
                stored: [makePatient({ uuid: 'u-1', versionId: '2', gender: 'male' })],
                expected: { losers: 0 }
            },
            {
                name: 'an If-Match update equal to the stored document when matchedCount is 0 as lost',
                entry: ifMatchEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0, matchedCount: 0 },
                stored: [makePatient({ uuid: 'u-1', versionId: '2', gender: 'male' })],
                expected: { losers: 1, latest: expect.objectContaining({ _uuid: 'u-1' }) }
            }
        ])('classifies $name', async ({ entry, bulkWriteResult, stored, expected }) => {
            const updateManager = makeUpdateManager(stored);

            const result = await detector.detectAsync({ entries: [{ entry, index: 0 }], bulkWriteResult, updateManager });

            expect(result.losers).toHaveLength(expected.losers);
            if (expected.losers > 0) {
                expect(result.latestByUuid.get('u-1')).toEqual(expected.latest);
            }
        });

        test('never reads for an insertOne, which can\'t lose', async () => {
            const resource = makePatient();
            const updateManager = makeUpdateManager();
            const entry = makeEntry({
                operationType: 'insert', isCreateOperation: true, resource, operation: { insertOne: { document: resource } }
            });

            const result = await detector.detectAsync({
                entries: [{ entry, index: 0 }], bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 }, updateManager
            });

            expect(updateManager.findLatestByUuidsAsync).not.toHaveBeenCalled();
            expect(result.losers).toHaveLength(0);
        });

        test('reads nothing when every create inserted and modifiedCount covers the updates', async () => {
            const updateManager = makeUpdateManager();
            const entries = [
                { entry: createEntry(makePatient({ uuid: 'u-1' })), index: 0 },
                { entry: versionedEntry(makePatient({ uuid: 'u-2' })), index: 1 }
            ];

            const result = await detector.detectAsync({
                entries, bulkWriteResult: { upsertedIds: { 0: 'x' }, modifiedCount: 1 }, updateManager
            });

            expect(updateManager.findLatestByUuidsAsync).not.toHaveBeenCalled();
            expect(result.losers).toHaveLength(0);
        });

        test('reads the update entries and the lost creates in one query', async () => {
            const updateManager = makeUpdateManager();
            const entries = [
                { entry: createEntry(makePatient({ uuid: 'u-1' })), index: 0 },
                { entry: versionedEntry(makePatient({ uuid: 'u-2' })), index: 1 },
                { entry: uuidOnlyReplaceEntry(makePatient({ uuid: 'u-3' })), index: 2 }
            ];

            await detector.detectAsync({ entries, bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 }, updateManager });

            expect(updateManager.findLatestByUuidsAsync).toHaveBeenCalledTimes(1);
            expect(updateManager.findLatestByUuidsAsync.mock.calls[0][0].uuids.sort()).toEqual(['u-1', 'u-2', 'u-3']);
        });

        test('reads only the lost creates when the updates were all modified', async () => {
            const updateManager = makeUpdateManager();
            const entries = [
                { entry: createEntry(makePatient({ uuid: 'u-1' })), index: 0 },
                { entry: versionedEntry(makePatient({ uuid: 'u-2' })), index: 1 }
            ];

            await detector.detectAsync({ entries, bulkWriteResult: { upsertedIds: {}, modifiedCount: 1 }, updateManager });

            expect(updateManager.findLatestByUuidsAsync.mock.calls[0][0].uuids).toEqual(['u-1']);
        });

        test('counts the lost creates and {_uuid}-only writes in matchedCount before the versioned updates', async () => {
            const won = makePatient({ uuid: 'u-3' });
            const updateManager = makeUpdateManager([
                makePatient({ uuid: 'u-1', gender: 'female' }),
                makePatient({ uuid: 'u-2' }),
                { ...won }
            ]);
            const entries = [
                { entry: createEntry(makePatient({ uuid: 'u-1' })), index: 0 },
                { entry: uuidOnlyReplaceEntry(makePatient({ uuid: 'u-2' })), index: 1 },
                { entry: versionedEntry(won), index: 2 }
            ];

            // the lost create's upsert and the {_uuid}-only write matched, so 2 is no versioned match
            const result = await detector.detectAsync({
                entries, bulkWriteResult: { upsertedIds: {}, modifiedCount: 1, matchedCount: 2 }, updateManager
            });

            expect(result.losers.map((e) => e.uuid)).toEqual(['u-1', 'u-3']);
        });

        test('keeps only the losers in latestByUuid', async () => {
            const won = makePatient({ uuid: 'u-1' });
            const lost = makePatient({ uuid: 'u-2', gender: 'male' });
            const updateManager = makeUpdateManager([{ ...won }, makePatient({ uuid: 'u-2', gender: 'female' })]);
            const entries = [{ entry: versionedEntry(won), index: 0 }, { entry: versionedEntry(lost), index: 1 }];

            const result = await detector.detectAsync({
                entries, bulkWriteResult: { upsertedIds: {}, modifiedCount: 1 }, updateManager
            });

            expect([...result.latestByUuid.keys()]).toEqual(['u-2']);
        });

        test('leaves the entry replacement unchanged', async () => {
            const replacement = makePatient({ uuid: 'u-1', extra: { birthDate: undefined } });
            const updateManager = makeUpdateManager([makePatient({ uuid: 'u-1' })]);

            await detector.detectAsync({
                entries: [{ entry: versionedEntry(replacement), index: 0 }],
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                updateManager
            });

            expect(Object.prototype.hasOwnProperty.call(replacement, 'birthDate')).toBe(true);
        });
    });
});
