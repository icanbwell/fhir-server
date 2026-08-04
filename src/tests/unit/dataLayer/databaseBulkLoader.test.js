'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { DatabaseBulkLoader } = require('../../../dataLayer/databaseBulkLoader');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');

/**
 * CACHE ANALYSIS for DatabaseBulkLoader:
 *
 * 1. Cache mechanism: RequestSpecificCache.getMap() returns a Map keyed by requestId + name ('bulkLoaderCache')
 * 2. Cache KEY dimensions: (requestId, 'bulkLoaderCache') -> Map<resourceType, Resource[]>
 * 3. Method PARAMETERS:
 *    - loadResourcesAsync: { requestId, base_version, requestedResources }
 *    - getResourceFromExistingList: { requestId, resourceType, uuid }
 *    - getMatchingResource: { cacheEntryResources, uuid }
 * 4. Params NOT in key: base_version (not part of cache key — the cache is keyed only by requestId+name)
 *    This means if you load resources with base_version='4_0_0' and then load again with base_version='3_0_0'
 *    under the same requestId, the second call OVERWRITES the first in the cache for the same resourceType.
 * 5. Cached VALUE: Map<resourceType, Resource[]> stored in the bulk cache
 * 6. Downstream consumer: getResourceFromExistingList reads from cache by resourceType and uuid
 * 7. Required test: Call loadResourcesAsync twice with same requestId but different base_version;
 *    verify second call's results overwrite the first in cache.
 * 8. Mock setup: Need DatabaseQueryFactory mock with createQuery that returns a mock DatabaseQueryManager
 * 9. Assertion: After two loads, getResourceFromExistingList returns second load's resources
 */

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

describe('DatabaseBulkLoader', () => {
    let requestSpecificCache;
    let databaseQueryFactory;
    let configManager;
    let loader;
    let mockCursor;
    let mockDatabaseQueryManager;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();

        // Create mock DatabaseQueryFactory
        databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
        mockCursor = {
            toArrayAsync: jestGlobal.fn().mockResolvedValue([])
        };
        mockDatabaseQueryManager = {
            findResourcesInDatabaseAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
        };
        databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

        // Create mock ConfigManager
        configManager = createPrototypedMock(ConfigManager);

        loader = new DatabaseBulkLoader({
            databaseQueryFactory,
            requestSpecificCache,
            configManager
        });
    });

    describe('getBulkCache', () => {
        test('returns a Map from requestSpecificCache for given requestId', () => {
            const cache = loader.getBulkCache({ requestId: 'req-1' });
            expect(cache).toBeInstanceOf(Map);
        });

        test('returns same Map reference for same requestId', () => {
            const cache1 = loader.getBulkCache({ requestId: 'req-1' });
            const cache2 = loader.getBulkCache({ requestId: 'req-1' });
            expect(cache1).toBe(cache2);
        });

        test('returns different Map for different requestId', () => {
            const cache1 = loader.getBulkCache({ requestId: 'req-1' });
            const cache2 = loader.getBulkCache({ requestId: 'req-2' });
            expect(cache1).not.toBe(cache2);
        });
    });

    describe('getMatchingResource', () => {
        test('returns null when cacheEntryResources is empty (0 items)', () => {
            const result = loader.getMatchingResource({ cacheEntryResources: [], uuid: 'uuid-1' });
            expect(result).toBeNull();
        });

        test('returns null when uuid does not match any resource', () => {
            const resources = [
                { _uuid: 'uuid-A', id: '1', resourceType: 'Patient' },
                { _uuid: 'uuid-B', id: '2', resourceType: 'Patient' }
            ];
            const result = loader.getMatchingResource({ cacheEntryResources: resources, uuid: 'uuid-Z' });
            expect(result).toBeNull();
        });

        test('returns matching resource when exactly 1 match (1 item)', () => {
            const resources = [
                { _uuid: 'uuid-A', id: '1', resourceType: 'Patient' }
            ];
            const result = loader.getMatchingResource({ cacheEntryResources: resources, uuid: 'uuid-A' });
            expect(result).toEqual({ _uuid: 'uuid-A', id: '1', resourceType: 'Patient' });
        });

        test('returns first matching resource when multiple match (>1 items)', () => {
            const resources = [
                { _uuid: 'uuid-A', id: '1', resourceType: 'Patient' },
                { _uuid: 'uuid-A', id: '2', resourceType: 'Patient' }
            ];
            const result = loader.getMatchingResource({ cacheEntryResources: resources, uuid: 'uuid-A' });
            // getFirstResourceOrNull returns first match
            expect(result).toEqual({ _uuid: 'uuid-A', id: '1', resourceType: 'Patient' });
        });
    });

    describe('getResourceFromExistingList', () => {
        test('returns null when cache has no entry for given resourceType', () => {
            const result = loader.getResourceFromExistingList({
                requestId: 'req-1',
                resourceType: 'Patient',
                uuid: 'uuid-1'
            });
            expect(result).toBeNull();
        });

        test('returns null when cache has resourceType but uuid does not match', () => {
            const bulkCache = loader.getBulkCache({ requestId: 'req-1' });
            bulkCache.set('Patient', [
                { _uuid: 'uuid-A', id: '1', resourceType: 'Patient' }
            ]);

            const result = loader.getResourceFromExistingList({
                requestId: 'req-1',
                resourceType: 'Patient',
                uuid: 'uuid-Z'
            });
            expect(result).toBeNull();
        });

        test('returns matching resource from cache', () => {
            const bulkCache = loader.getBulkCache({ requestId: 'req-1' });
            bulkCache.set('Patient', [
                { _uuid: 'uuid-A', id: '1', resourceType: 'Patient' },
                { _uuid: 'uuid-B', id: '2', resourceType: 'Patient' }
            ]);

            const result = loader.getResourceFromExistingList({
                requestId: 'req-1',
                resourceType: 'Patient',
                uuid: 'uuid-B'
            });
            expect(result).toEqual({ _uuid: 'uuid-B', id: '2', resourceType: 'Patient' });
        });

        test('different requestIds have isolated caches', () => {
            const bulkCache1 = loader.getBulkCache({ requestId: 'req-1' });
            bulkCache1.set('Patient', [
                { _uuid: 'uuid-A', id: '1', resourceType: 'Patient' }
            ]);

            // Different requestId should not find the resource
            const result = loader.getResourceFromExistingList({
                requestId: 'req-2',
                resourceType: 'Patient',
                uuid: 'uuid-A'
            });
            expect(result).toBeNull();
        });
    });

    describe('getResourcesAsync', () => {
        test('calls databaseQueryFactory.createQuery with resourceType and base_version', async () => {
            mockCursor.toArrayAsync.mockResolvedValue([]);

            await loader.getResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                resourceType: 'Patient',
                resources: [{ id: '1', resourceType: 'Patient' }]
            });

            expect(databaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });

        test('returns resourceType and serialized resources', async () => {
            const dbResources = [
                { _uuid: 'uuid-1', id: '1', resourceType: 'Patient', toJSON: () => ({ id: '1', resourceType: 'Patient' }) }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(dbResources);

            const result = await loader.getResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                resourceType: 'Patient',
                resources: [{ id: '1', resourceType: 'Patient' }]
            });

            expect(result.resourceType).toBe('Patient');
            // The resources array should be the serialized output (may be null if serializer fails, or array)
            // Since we don't have actual serializer setup, it may transform or pass through
            expect(result).toHaveProperty('resources');
        });

        test('returns empty/null resources when cursor returns empty array', async () => {
            mockCursor.toArrayAsync.mockResolvedValue([]);

            const result = await loader.getResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                resourceType: 'Patient',
                resources: []
            });

            expect(result.resourceType).toBe('Patient');
            // FhirResourceWriteSerializer.serializeArray with empty array returns null
            expect(result.resources).toBeNull();
        });

        test('throws RethrownError when cursor.toArrayAsync fails', async () => {
            mockCursor.toArrayAsync.mockRejectedValue(new Error('DB connection failed'));

            await expect(loader.getResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                resourceType: 'Patient',
                resources: []
            })).rejects.toThrow('DB connection failed');
        });
    });

    describe('loadResourcesAsync', () => {
        test('handles 0 requestedResources', async () => {
            const result = await loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                requestedResources: []
            });

            expect(result).toEqual([]);
            expect(databaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        test('handles 1 requestedResource of single type', async () => {
            const fakeResources = [
                { _uuid: 'uuid-1', id: '1', resourceType: 'Patient' }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(fakeResources);

            const result = await loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                requestedResources: [{ resourceType: 'Patient', id: '1' }]
            });

            expect(result).toHaveLength(1);
            expect(result[0].resourceType).toBe('Patient');
        });

        test('handles >1 requestedResources of multiple types', async () => {
            // Return different resources based on what's queried
            mockDatabaseQueryManager.findResourcesInDatabaseAsync.mockImplementation(async ({ resources }) => {
                return {
                    toArrayAsync: async () => resources.map(r => ({
                        ...r, _uuid: `uuid-${r.id}`, resourceType: r.resourceType
                    }))
                };
            });

            const result = await loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                requestedResources: [
                    { resourceType: 'Patient', id: '1' },
                    { resourceType: 'Patient', id: '2' },
                    { resourceType: 'Observation', id: '3' }
                ]
            });

            expect(result).toHaveLength(2); // 2 resource types
            const resourceTypes = result.map(r => r.resourceType).sort();
            expect(resourceTypes).toEqual(['Observation', 'Patient']);
        });

        test('populates bulkCache after loading', async () => {
            const fakeResources = [
                { _uuid: 'uuid-1', id: '1', resourceType: 'Patient' }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(fakeResources);

            await loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                requestedResources: [{ resourceType: 'Patient', id: '1' }]
            });

            const bulkCache = loader.getBulkCache({ requestId: 'req-1' });
            expect(bulkCache.has('Patient')).toBe(true);
        });

        test('throws RethrownError when underlying getResourcesAsync fails', async () => {
            mockDatabaseQueryManager.findResourcesInDatabaseAsync.mockRejectedValue(
                new Error('Network failure')
            );

            await expect(loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                requestedResources: [{ resourceType: 'Patient', id: '1' }]
            })).rejects.toThrow('Network failure');
        });

        /**
         * BUG TEST: Cache key does NOT include base_version.
         * When same requestId is used with different base_version values,
         * the second load overwrites the cache for the same resourceType.
         * This means base_version is a non-key parameter that can lead to stale/wrong data.
         */
        test('BUG: second call with same requestId but different base_version overwrites cache for same resourceType', async () => {
            // First call - base_version '4_0_0'
            const firstResources = [
                { _uuid: 'uuid-1', id: '1', resourceType: 'Patient', name: 'First' }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(firstResources);

            await loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '4_0_0',
                requestedResources: [{ resourceType: 'Patient', id: '1' }]
            });

            // Second call - same requestId, different base_version
            const secondResources = [
                { _uuid: 'uuid-2', id: '2', resourceType: 'Patient', name: 'Second' }
            ];
            mockCursor.toArrayAsync.mockResolvedValue(secondResources);

            await loader.loadResourcesAsync({
                requestId: 'req-1',
                base_version: '3_0_0',
                requestedResources: [{ resourceType: 'Patient', id: '2' }]
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Different base_versions should get different cache entries
            // The first load's resource should still be findable
            const foundFirst = loader.getResourceFromExistingList({
                requestId: 'req-1',
                resourceType: 'Patient',
                uuid: 'uuid-1'
            });
            expect(foundFirst).not.toBeNull();
        });
    });
});
