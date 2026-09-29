const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixDuplicateUuidRunner } = require('../../../../admin/runners/fixDuplicateUuidRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

// Create mock instances that pass assertTypeEquals checks
function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixDuplicateUuidRunner', () => {
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

        runner = new FixDuplicateUuidRunner({
            collections: ['Patient_4_0_0'],
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            startFromCollection: undefined,
            limit: undefined,
            skip: undefined,
            startFromId: undefined,
            useTransaction: undefined,
            properties: undefined,
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined
        });
    });

    // =====================================================
    // Tests for getProjection
    // =====================================================
    describe('getProjection', () => {
        test('should include both custom properties and required properties', () => {
            runner.properties = ['status', 'name'];
            const projection = runner.getProjection();
            expect(projection).toEqual({
                status: 1,
                name: 1,
                resourceType: 1,
                meta: 1,
                identifier: 1,
                _uuid: 1,
                _sourceId: 1,
                _sourceAssigningAuthority: 1
            });
        });

        test('should throw when properties is null/undefined', () => {
            runner.properties = null;
            expect(() => runner.getProjection()).toThrow();
        });
    });

    // =====================================================
    // Tests for getQueryForDuplicateUuidResources
    // =====================================================
    describe('getQueryForDuplicateUuidResources', () => {
        test('should use $in when multiple uuids', () => {
            const query = runner.getQueryForDuplicateUuidResources({
                duplicateUuidArray: ['uuid-1', 'uuid-2']
            });
            expect(query).toEqual({ _uuid: { $in: ['uuid-1', 'uuid-2'] } });
        });

        test('should use direct match for single uuid', () => {
            const query = runner.getQueryForDuplicateUuidResources({
                duplicateUuidArray: ['uuid-1']
            });
            expect(query).toEqual({ _uuid: 'uuid-1' });
        });

        test('should add afterLastUpdatedDate filter', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            const query = runner.getQueryForDuplicateUuidResources({
                duplicateUuidArray: ['uuid-1']
            });
            expect(query.$and).toHaveLength(2);
            expect(query.$and[1]).toEqual({ 'meta.lastUpdated': { $gt: '2023-01-01' } });
        });

        test('should add beforeLastUpdatedDate filter', () => {
            runner.beforeLastUpdatedDate = '2023-12-31';
            const query = runner.getQueryForDuplicateUuidResources({
                duplicateUuidArray: ['uuid-1']
            });
            expect(query.$and).toHaveLength(2);
            expect(query.$and[1]).toEqual({ 'meta.lastUpdated': { $lt: '2023-12-31' } });
        });

        test('should add both date filters', () => {
            runner.afterLastUpdatedDate = '2023-01-01';
            runner.beforeLastUpdatedDate = '2023-12-31';
            const query = runner.getQueryForDuplicateUuidResources({
                duplicateUuidArray: ['uuid-1']
            });
            expect(query.$and).toHaveLength(3);
        });
    });

    // =====================================================
    // Tests for getDuplicateUuidArrayAsync
    // =====================================================
    describe('getDuplicateUuidArrayAsync', () => {
        test('should populate metaIdCache from aggregation results', async () => {
            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue({
                    toArray: jestGlobal.fn().mockResolvedValue([
                        {
                            _id: 'uuid-1',
                            count: 2,
                            meta: [{ versionId: '1', lastUpdated: '2023-01-01' }, { versionId: '2', lastUpdated: '2023-01-02' }],
                            id: ['id-a', 'id-b']
                        }
                    ])
                })
            };

            const result = await runner.getDuplicateUuidArrayAsync({ collection: mockCollection });
            expect(result).toEqual(['uuid-1']);
            expect(runner.metaIdCache.has('uuid-1')).toBe(true);
            const cached = runner.metaIdCache.get('uuid-1');
            expect(cached).toHaveLength(2);
            expect(cached[0]).toEqual({ meta: { versionId: '1', lastUpdated: '2023-01-01' }, _id: 'id-a' });
            expect(cached[1]).toEqual({ meta: { versionId: '2', lastUpdated: '2023-01-02' }, _id: 'id-b' });
        });

        test('should return empty array when no duplicates', async () => {
            const mockCollection = {
                aggregate: jestGlobal.fn().mockReturnValue({
                    toArray: jestGlobal.fn().mockResolvedValue([])
                })
            };

            const result = await runner.getDuplicateUuidArrayAsync({ collection: mockCollection });
            expect(result).toEqual([]);
        });
    });

    // =====================================================
    // Tests for processResourceAsync
    // =====================================================
    describe('processResourceAsync', () => {
        test('should skip already processed uuids', async () => {
            runner.processedUuids.set('Patient_4_0_0', new Set(['uuid-1']));
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toEqual([]);
        });

        test('should return empty when uuid not in cache', async () => {
            const result = await runner.processResourceAsync({
                uuid: 'uuid-missing',
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toEqual([]);
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                expect.stringContaining('uuid-missing')
            );
        });

        test('should return empty when resources have no versionId', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: {}, _id: 'id-a' },
                { meta: { versionId: '1' }, _id: 'id-b' }
            ]);
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toEqual([]);
            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                expect.stringContaining('without versionId')
            );
        });

        test('should return empty when resources have null meta', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: null, _id: 'id-a' },
                { meta: { versionId: '2' }, _id: 'id-b' }
            ]);
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toEqual([]);
        });

        test('should keep resource with highest versionId and delete others', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: '1', lastUpdated: '2023-01-01' }, _id: 'id-a' },
                { meta: { versionId: '3', lastUpdated: '2023-01-03' }, _id: 'id-b' },
                { meta: { versionId: '2', lastUpdated: '2023-01-02' }, _id: 'id-c' }
            ]);
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toHaveLength(1);
            expect(result[0].deleteMany.filter._id.$in).toContain('id-a');
            expect(result[0].deleteMany.filter._id.$in).toContain('id-c');
            expect(result[0].deleteMany.filter._id.$in).not.toContain('id-b');
        });

        test('should keep the most recently updated resource when multiple have same max versionId', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: '2', lastUpdated: '2023-01-01T00:00:00Z' }, _id: 'id-a' },
                { meta: { versionId: '2', lastUpdated: '2023-01-03T00:00:00Z' }, _id: 'id-b' },
                { meta: { versionId: '1', lastUpdated: '2023-01-02T00:00:00Z' }, _id: 'id-c' }
            ]);
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            expect(result).toHaveLength(1);
            // id-b has the most recent lastUpdated among version 2 resources
            expect(result[0].deleteMany.filter._id.$in).toContain('id-a');
            expect(result[0].deleteMany.filter._id.$in).toContain('id-c');
            expect(result[0].deleteMany.filter._id.$in).not.toContain('id-b');
        });

        test('should mark uuid as processed after successful operation', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: '1', lastUpdated: '2023-01-01' }, _id: 'id-a' },
                { meta: { versionId: '2', lastUpdated: '2023-01-02' }, _id: 'id-b' }
            ]);
            await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            expect(runner.processedUuids.get('Patient_4_0_0').has('uuid-1')).toBe(true);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should gracefully handle non-numeric versionId', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: 'abc', lastUpdated: '2023-01-01' }, _id: 'id-a' },
                { meta: { versionId: 'def', lastUpdated: '2023-01-02' }, _id: 'id-b' }
            ]);

            // When all versionIds are non-numeric, the function should gracefully
            // handle this case (e.g., fall back to lastUpdated comparison or return empty)
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            // Should return a valid result without crashing
            expect(Array.isArray(result)).toBe(true);
        });

        // BUG TEST: When lastUpdated is null/undefined in resources with same max versionId
        test('BUG: null lastUpdated causes NaN in sort comparison', async () => {
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: '2', lastUpdated: null }, _id: 'id-a' },
                { meta: { versionId: '2', lastUpdated: null }, _id: 'id-b' },
                { meta: { versionId: '1', lastUpdated: '2023-01-01' }, _id: 'id-c' }
            ]);

            // new Date(null).getTime() = 0, so the sort won't crash but
            // will produce deterministic (both = 0) => 0 diff.
            // The function should still return a result without crashing.
            const result = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });
            // Should still work - one of the version 2 resources is kept
            expect(result).toHaveLength(1);
            expect(result[0].deleteMany.filter._id.$in).toHaveLength(2);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('should produce same result regardless of input order when lastUpdated is undefined (non-deterministic sort bug)', async () => {
            // When lastUpdated is undefined, new Date(undefined).getTime() = NaN
            // NaN - NaN = NaN, so sort comparison is meaningless.
            // The code should use a fallback tiebreaker (e.g., _id) to ensure determinism.
            // With the bug, the "winner" depends on insertion order in the array,
            // which is non-deterministic when data comes from MongoDB.

            // Order 1: id-a comes first
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: '2' }, _id: 'id-a' },
                { meta: { versionId: '2' }, _id: 'id-b' },
                { meta: { versionId: '1', lastUpdated: '2023-01-01' }, _id: 'id-c' }
            ]);

            const result1 = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });

            // Order 2: id-b comes first (simulating different MongoDB cursor order)
            runner.processedUuids.get('Patient_4_0_0').delete('uuid-1');
            runner.metaIdCache.set('uuid-1', [
                { meta: { versionId: '2' }, _id: 'id-b' },
                { meta: { versionId: '2' }, _id: 'id-a' },
                { meta: { versionId: '1', lastUpdated: '2023-01-01' }, _id: 'id-c' }
            ]);

            const result2 = await runner.processResourceAsync({
                uuid: 'uuid-1',
                collectionName: 'Patient_4_0_0'
            });

            expect(result1).toHaveLength(1);
            expect(result2).toHaveLength(1);
            // Both orderings should produce the same delete set (deterministic behavior)
            const deleteSet1 = result1[0].deleteMany.filter._id.$in.sort();
            const deleteSet2 = result2[0].deleteMany.filter._id.$in.sort();
            expect(deleteSet1).toEqual(deleteSet2);
        });
    });
});
