const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ObjectId } = require('mongodb');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../common');
const {
    MigrateBinaryDataToCloudStorageRunner
} = require('../../../../admin/runners/migrateBinaryDataToCloudStorageRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');

describe('MigrateBinaryDataToCloudStorageRunner query builder', () => {
    let collection;

    beforeEach(async () => {
        await commonBeforeEach();
        await createTestRequest();
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        collection = db.collection('Binary_4_0_0');
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const buildRunner = (overrides = {}) => {
        const container = getTestContainer();
        return new MigrateBinaryDataToCloudStorageRunner({
            mongoDatabaseManager: container.mongoDatabaseManager,
            adminLogger: new AdminLogger(),
            batchSize: 10,
            concurrency: 5,
            thresholdKB: 1,
            startId: undefined,
            count: undefined,
            fromDate: undefined,
            toDate: undefined,
            dryRun: true,
            base64FieldCloudStorageClient: container.base64FieldCloudStorageClient,
            configManager: container.configManager,
            ...overrides
        });
    };

    const seedBinary = ({ uuid, data, blobMeta, idOverride }) => {
        const doc = {
            _uuid: uuid,
            resourceType: 'Binary',
            meta: { versionId: '1', lastUpdated: new Date('2024-01-01T00:00:00Z') },
            ...(data !== undefined ? { data } : {}),
            ...(blobMeta ? { _blobMeta: blobMeta } : {})
        };
        if (idOverride) {
            doc._id = idOverride;
        }
        return collection.insertOne(doc);
    };

    const runQuery = async (runner) => collection.find(runner._buildQuery()).sort({ _id: 1 }).toArray();

    test('matches all inline-data documents without _blobMeta, regardless of size', async () => {
        await seedBinary({ uuid: 'above', data: 'a'.repeat(2000) });
        await seedBinary({ uuid: 'below', data: 'a'.repeat(10) });
        await seedBinary({
            uuid: 'already-migrated',
            blobMeta: { hash: 'h', rawSize: 5, lastUpdated: new Date('2024-01-01T00:00:00Z') }
        });
        const runner = buildRunner();

        const matched = await runQuery(runner);

        expect(matched.map((d) => d._uuid)).toEqual(['above', 'below']);
    });

    test('resumes strictly after startId', async () => {
        const first = await seedBinary({ uuid: 'first', data: 'a'.repeat(2000) });
        await seedBinary({ uuid: 'second', data: 'a'.repeat(2000) });
        const runner = buildRunner({ startId: first.insertedId.toHexString() });

        const matched = await runQuery(runner);

        expect(matched.map((d) => d._uuid)).toEqual(['second']);
    });

    test('throws on invalid startId', () => {
        expect(() => buildRunner({ startId: 'not-a-valid-object-id' })).toThrow(
            'Invalid startId: not-a-valid-object-id'
        );
    });

    test('excludes documents at or after toDate', async () => {
        const beforeId = ObjectId.createFromTime(Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000));
        const afterId = ObjectId.createFromTime(Math.floor(new Date('2024-12-01T00:00:00Z').getTime() / 1000));
        await seedBinary({ uuid: 'before-cutoff', data: 'a'.repeat(2000), idOverride: beforeId });
        await seedBinary({ uuid: 'after-cutoff', data: 'a'.repeat(2000), idOverride: afterId });
        const runner = buildRunner({ toDate: '2024-06-01' });

        const matched = await runQuery(runner);

        expect(matched.map((d) => d._uuid)).toEqual(['before-cutoff']);
    });

    test('throws on invalid toDate', () => {
        expect(() => buildRunner({ toDate: 'not-a-date' })).toThrow('Invalid toDate: not-a-date');
    });

    test('throws on invalid fromDate', () => {
        expect(() => buildRunner({ fromDate: 'not-a-date' })).toThrow('Invalid fromDate: not-a-date');
    });

    test('combined startId and fromDate use whichever lower bound is more restrictive', async () => {
        const early = ObjectId.createFromTime(Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000));
        const middle = ObjectId.createFromTime(Math.floor(new Date('2024-03-01T00:00:00Z').getTime() / 1000));
        const late = ObjectId.createFromTime(Math.floor(new Date('2024-06-01T00:00:00Z').getTime() / 1000));
        await seedBinary({ uuid: 'early', data: 'a'.repeat(2000), idOverride: early });
        await seedBinary({ uuid: 'middle', data: 'a'.repeat(2000), idOverride: middle });
        await seedBinary({ uuid: 'late', data: 'a'.repeat(2000), idOverride: late });

        const runnerStartIdWins = buildRunner({ startId: middle.toHexString(), fromDate: '2024-01-01' });
        expect((await runQuery(runnerStartIdWins)).map((d) => d._uuid)).toEqual(['late']);

        const runnerFromDateWins = buildRunner({ startId: early.toHexString(), fromDate: '2024-03-01' });
        expect((await runQuery(runnerFromDateWins)).map((d) => d._uuid)).toEqual(['late']);
    });

    test('_exceedsThreshold is true only above the KB threshold (pure function, nothing to integrate)', () => {
        const runner = buildRunner({ thresholdKB: 1 });
        expect(runner._exceedsThreshold('a'.repeat(2000))).toBe(true);
        expect(runner._exceedsThreshold('a'.repeat(10))).toBe(false);
        expect(runner._exceedsThreshold(undefined)).toBe(false);
    });

    test('_buildLiveKey matches the live write path scheme (pure function, nothing to integrate)', () => {
        const runner = buildRunner();
        expect(runner._buildLiveKey('uuid-123', 1700000000000)).toBe('Binary_4_0_0/uuid-123/1700000000000');
    });
});
