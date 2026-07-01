const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const {
    wasMemberStrippedForExternalStorage,
    restoreStrippedMembersInMongo
} = require('../../utils/clickHouseGroupPreSave');
const { MongoBulkWriteExecutor } = require('../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');

/**
 * Unit tests for the Group dual-write split-brain compensation.
 *
 * These exercise the compensation logic in isolation (no container, ClickHouse, or MongoDB),
 * so they run fast and deterministically and document the exact intended behavior:
 *
 *  - The strip precondition (wasMemberStrippedForExternalStorage) and its inverse
 *    (restoreStrippedMembersInMongo) are mutually consistent.
 *  - MongoBulkWriteExecutor._compensateStrippedGroupMembersOnPostSaveFailure restores members to
 *    MongoDB ONLY for Group writes that actually stripped members, is a no-op otherwise, and
 *    never throws (a failed restore must not mask the original ClickHouse error).
 */
describe('Group ClickHouse compensation (unit)', () => {
    process.env.LOGLEVEL = 'SILENT';

    /**
     * Minimal fake MongoDB collection capturing updateOne calls.
     */
    function makeFakeCollection({ matchedCount = 1, throwOnUpdate = false } = {}) {
        const calls = [];
        return {
            calls,
            updateOne: jestGlobal.fn(async (filter, update) => {
                calls.push({ filter, update });
                if (throwOnUpdate) {
                    throw new Error('mongo updateOne failed');
                }
                return { matchedCount, modifiedCount: matchedCount };
            })
        };
    }

    function strippedGroupContext(members) {
        return {
            resourceType: 'Group',
            useExternalStorage: true,
            groupMembers: members
        };
    }

    describe('wasMemberStrippedForExternalStorage', () => {
        test('true when external storage and not PATCH/smartMerge', () => {
            expect(wasMemberStrippedForExternalStorage({ useExternalStorage: true })).toBe(true);
        });

        test.each([
            ['no external storage', { useExternalStorage: false }],
            ['null contextData', null],
            ['PATCH already wrote events', { useExternalStorage: true, groupMemberEventsWritten: true }],
            ['smartMerge $merge', { useExternalStorage: true, smartMerge: true }]
        ])('false for %s', (_label, contextData) => {
            expect(wasMemberStrippedForExternalStorage(contextData)).toBe(false);
        });
    });

    describe('restoreStrippedMembersInMongo', () => {
        test('writes serialized members back keyed by _uuid', async () => {
            const collection = makeFakeCollection();
            const members = [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ];

            const result = await restoreStrippedMembersInMongo({
                collection,
                uuid: 'uuid-abc',
                members
            });

            expect(result).toBe(true);
            expect(collection.updateOne).toHaveBeenCalledTimes(1);
            expect(collection.calls[0].filter).toEqual({ _uuid: 'uuid-abc' });
            expect(collection.calls[0].update).toEqual({ $set: { member: members } });
        });

        test('serializes FHIR class instances via toJSONInternal', async () => {
            const collection = makeFakeCollection();
            const members = [
                {
                    entity: { reference: 'Patient/raw' },
                    toJSONInternal() {
                        return { entity: { reference: 'Patient/serialized' } };
                    }
                }
            ];

            await restoreStrippedMembersInMongo({ collection, uuid: 'u1', members });

            expect(collection.calls[0].update).toEqual({
                $set: { member: [{ entity: { reference: 'Patient/serialized' } }] }
            });
        });

        test.each([
            ['no members', []],
            ['null members', null],
            ['missing uuid (members present)', [{ entity: { reference: 'Patient/1' } }]]
        ])('no-op and returns false for %s', async (label, members) => {
            const collection = makeFakeCollection();
            const uuid = label === 'missing uuid (members present)' ? null : 'u1';

            const result = await restoreStrippedMembersInMongo({ collection, uuid, members });

            expect(result).toBe(false);
            expect(collection.updateOne).not.toHaveBeenCalled();
        });

        // Security: uuid becomes the Mongo filter value ({ _uuid: uuid }). A non-string uuid (e.g. a
        // query-operator object) must be rejected before it can reach the query, otherwise it is a
        // NoSQL injection. The guard rejects it: no updateOne, returns false.
        test.each([
            ['query-operator object', { $ne: null }],
            ['array', ['u1']],
            ['empty string', ''],
            ['number', 123]
        ])('rejects non-string uuid (%s) without querying Mongo (NoSQL injection guard)', async (_label, uuid) => {
            const collection = makeFakeCollection();
            const members = [{ entity: { reference: 'Patient/1' } }];

            const result = await restoreStrippedMembersInMongo({ collection, uuid, members });

            expect(result).toBe(false);
            expect(collection.updateOne).not.toHaveBeenCalled();
        });
    });

    describe('_compensateStrippedGroupMembersOnPostSaveFailure', () => {
        // Invoke the private method on a minimal `this` — it needs only configManager (for the
        // self-contained enableClickHouse guard) and module-level loggers, not the full executor.
        const compensate = MongoBulkWriteExecutor.prototype._compensateStrippedGroupMembersOnPostSaveFailure;
        const chOnCtx = { configManager: { enableClickHouse: true } };

        let postSaveError;
        beforeEach(() => {
            postSaveError = new Error('Simulated ClickHouse outage');
        });

        function makeEntry({ contextData, uuid = 'uuid-xyz', id = 'group-1' }) {
            return { id, uuid, contextData };
        }

        test('restores members to MongoDB for a stripped Group create/PUT', async () => {
            const collection = makeFakeCollection();
            const members = [{ entity: { reference: 'Patient/1' } }];

            await compensate.call(chOnCtx, {
                collection,
                resourceType: 'Group',
                bulkInsertUpdateEntry: makeEntry({ contextData: strippedGroupContext(members) }),
                requestId: 'req-1',
                postSaveError
            });

            expect(collection.updateOne).toHaveBeenCalledTimes(1);
            expect(collection.calls[0].filter).toEqual({ _uuid: 'uuid-xyz' });
            expect(collection.calls[0].update).toEqual({ $set: { member: members } });
        });

        test('no-op for non-Group resource', async () => {
            const collection = makeFakeCollection();

            await compensate.call(chOnCtx, {
                collection,
                resourceType: 'Patient',
                bulkInsertUpdateEntry: makeEntry({
                    contextData: { useExternalStorage: true, groupMembers: [{ entity: { reference: 'Patient/1' } }] }
                }),
                requestId: 'req-1',
                postSaveError
            });

            expect(collection.updateOne).not.toHaveBeenCalled();
        });

        test.each([
            ['PATCH (groupMemberEventsWritten)', { resourceType: 'Group', useExternalStorage: true, groupMemberEventsWritten: true, groupMembers: [{ entity: { reference: 'Patient/1' } }] }],
            ['smartMerge $merge', { resourceType: 'Group', useExternalStorage: true, smartMerge: true, groupMembers: [{ entity: { reference: 'Patient/1' } }] }],
            ['no external storage', { resourceType: 'Group', useExternalStorage: false, groupMembers: [{ entity: { reference: 'Patient/1' } }] }]
        ])('no-op for %s (members were not stripped from Mongo)', async (_label, contextData) => {
            const collection = makeFakeCollection();

            await compensate.call(chOnCtx, {
                collection,
                resourceType: 'Group',
                bulkInsertUpdateEntry: makeEntry({ contextData }),
                requestId: 'req-1',
                postSaveError
            });

            expect(collection.updateOne).not.toHaveBeenCalled();
        });

        test('no-op when no members were submitted (empty Group is consistent)', async () => {
            const collection = makeFakeCollection();

            await compensate.call(chOnCtx, {
                collection,
                resourceType: 'Group',
                bulkInsertUpdateEntry: makeEntry({ contextData: strippedGroupContext([]) }),
                requestId: 'req-1',
                postSaveError
            });

            expect(collection.updateOne).not.toHaveBeenCalled();
        });

        test('no-op when ClickHouse is disabled (guard is self-contained)', async () => {
            const collection = makeFakeCollection();
            const members = [{ entity: { reference: 'Patient/1' } }];

            await compensate.call({ configManager: { enableClickHouse: false } }, {
                collection,
                resourceType: 'Group',
                bulkInsertUpdateEntry: makeEntry({ contextData: strippedGroupContext(members) }),
                requestId: 'req-1',
                postSaveError
            });

            expect(collection.updateOne).not.toHaveBeenCalled();
        });

        test('does NOT throw when the restore itself fails (original error must surface)', async () => {
            const collection = makeFakeCollection({ throwOnUpdate: true });
            const members = [{ entity: { reference: 'Patient/1' } }];

            // The compensation must resolve (swallow its own secondary error). The caller is the
            // one that re-throws postSaveError, so this method must never throw.
            await expect(
                compensate.call(chOnCtx, {
                    collection,
                    resourceType: 'Group',
                    bulkInsertUpdateEntry: makeEntry({ contextData: strippedGroupContext(members) }),
                    requestId: 'req-1',
                    postSaveError
                })
            ).resolves.toBeUndefined();

            expect(collection.updateOne).toHaveBeenCalledTimes(1);
        });
    });
});
