const { describe, test, expect, jest } = require('@jest/globals');
const { WriteConflictDetector, ENTRY_CLASS } = require('../../../../dataLayer/concurrency/writeConflictDetector');
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
    return makeEntry({
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
}

function uuidOnlyReplaceEntry (resource) {
    return makeEntry({
        operationType: 'replace',
        resource,
        operation: { replaceOne: { filter: { _uuid: resource._uuid }, upsert: false, replacement: resource } }
    });
}

function patchEntry (resource) {
    return makeEntry({
        operationType: 'merge',
        resource,
        operation: { updateOne: { filter: { _uuid: resource._uuid }, update: { $set: { gender: 'other' } } } }
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
        findLatestByUuidsAsync: jest.fn().mockResolvedValue(new Map(stored.map((d) => [d._uuid, d]))),
        toWriteDocument: jest.fn((doc) => doc)
    };
}

describe('WriteConflictDetector', () => {
    const detector = new WriteConflictDetector();

    describe('classify', () => {
        const resource = makePatient();
        test.each([
            ['an insertUniqueId upsert', createEntry(resource), ENTRY_CLASS.CREATE],
            ['a replaceOne on _uuid and a previous version', versionedEntry(resource), ENTRY_CLASS.VERSIONED_UPDATE],
            ['a replaceOne on _uuid and If-Match versions', ifMatchEntry(resource), ENTRY_CLASS.IF_MATCH_UPDATE],
            ['a replaceOne on _uuid alone', uuidOnlyReplaceEntry(resource), ENTRY_CLASS.UUID_ONLY_WRITE],
            ['an updateOne $set on _uuid', patchEntry(resource), ENTRY_CLASS.UUID_ONLY_WRITE],
            ['a replaceOne with a null filter', nullFilterEntry(resource), ENTRY_CLASS.UUID_ONLY_WRITE],
            [
                'an insertOne',
                makeEntry({ operationType: 'insert', isCreateOperation: true, resource, operation: { insertOne: { document: resource } } }),
                null
            ]
        ])('%s', (_name, entry, expected) => {
            expect(detector.classify(entry)).toBe(expected);
        });
    });

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
                stored: [makePatient({ uuid: 'u-1', extra: { _id: 'mongo-object-id', birthDate: null } })],
                expected: { losers: 0 }
            },
            {
                name: 'an If-Match update whose stored document differs as an If-Match miss',
                entry: ifMatchEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 0, ifMatchMisses: 1 }
            },
            {
                name: 'a {_uuid}-only replace whose document exists as won',
                entry: uuidOnlyReplaceEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [otherWriter],
                expected: { losers: 0 }
            },
            {
                name: 'a {_uuid}-only $set whose document is missing as missing',
                entry: patchEntry(winner),
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                stored: [],
                expected: { losers: 0, missingUuidOnly: 1 }
            }
        ])('classifies $name', async ({ entry, bulkWriteResult, stored, expected }) => {
            const updateManager = makeUpdateManager(stored);

            const result = await detector.detectAsync({ entries: [{ entry, index: 0 }], bulkWriteResult, updateManager });

            expect(result.losers).toHaveLength(expected.losers);
            expect(result.ifMatchMisses).toHaveLength(expected.ifMatchMisses || 0);
            expect(result.missingUuidOnly).toHaveLength(expected.missingUuidOnly || 0);
            if (expected.losers > 0) {
                expect(result.latestByUuid.get('u-1')).toBe(expected.latest);
            }
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

        test('leaves the entry replacement and the stored document unchanged', async () => {
            const replacement = makePatient({ uuid: 'u-1', extra: { birthDate: undefined } });
            const stored = makePatient({ uuid: 'u-1', extra: { _id: 'mongo-object-id' } });
            const updateManager = makeUpdateManager([stored]);

            await detector.detectAsync({
                entries: [{ entry: versionedEntry(replacement), index: 0 }],
                bulkWriteResult: { upsertedIds: {}, modifiedCount: 0 },
                updateManager
            });

            expect(Object.prototype.hasOwnProperty.call(replacement, 'birthDate')).toBe(true);
            expect(stored._id).toBe('mongo-object-id');
        });
    });
});
