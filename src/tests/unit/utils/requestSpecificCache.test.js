'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jestObj.fn().mockResolvedValue(undefined)
}));

const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

describe('RequestSpecificCache', () => {
    let cache;

    beforeEach(() => {
        cache = new RequestSpecificCache();
    });

    describe('getMap', () => {
        test('returns a Map for a given requestId and name', () => {
            const map = cache.getMap({ requestId: 'req1', name: 'patients' });
            expect(map).toBeInstanceOf(Map);
        });

        test('returns the same Map on subsequent calls with same params', () => {
            const map1 = cache.getMap({ requestId: 'req1', name: 'patients' });
            map1.set('key', 'value');
            const map2 = cache.getMap({ requestId: 'req1', name: 'patients' });
            expect(map2.get('key')).toBe('value');
        });

        test('returns different Maps for different names', () => {
            const map1 = cache.getMap({ requestId: 'req1', name: 'a' });
            const map2 = cache.getMap({ requestId: 'req1', name: 'b' });
            map1.set('x', 1);
            expect(map2.has('x')).toBe(false);
        });

        test('returns different Maps for different requestIds', () => {
            const map1 = cache.getMap({ requestId: 'req1', name: 'cache' });
            const map2 = cache.getMap({ requestId: 'req2', name: 'cache' });
            map1.set('y', 2);
            expect(map2.has('y')).toBe(false);
        });
    });

    describe('getList', () => {
        test('returns an array for a given requestId and name', () => {
            const list = cache.getList({ requestId: 'req1', name: 'items' });
            expect(Array.isArray(list)).toBe(true);
        });

        test('returns the same array on subsequent calls', () => {
            const list1 = cache.getList({ requestId: 'req1', name: 'items' });
            list1.push('a');
            const list2 = cache.getList({ requestId: 'req1', name: 'items' });
            expect(list2).toContain('a');
        });

        test('returns different arrays for different names', () => {
            const list1 = cache.getList({ requestId: 'req1', name: 'x' });
            const list2 = cache.getList({ requestId: 'req1', name: 'y' });
            list1.push('item');
            expect(list2).toHaveLength(0);
        });
    });

    describe('getRequestIds', () => {
        test('returns empty array when no caches exist', () => {
            expect(cache.getRequestIds()).toEqual([]);
        });

        test('returns requestIds from mapCache', () => {
            cache.getMap({ requestId: 'req1', name: 'test' });
            expect(cache.getRequestIds()).toContain('req1');
        });

        test('returns requestIds from listCache', () => {
            cache.getList({ requestId: 'req2', name: 'test' });
            expect(cache.getRequestIds()).toContain('req2');
        });

        test('deduplicates when same requestId in both caches', () => {
            cache.getMap({ requestId: 'req1', name: 'map' });
            cache.getList({ requestId: 'req1', name: 'list' });
            const ids = cache.getRequestIds();
            expect(ids.filter(id => id === 'req1')).toHaveLength(1);
        });
    });

    describe('clearAsync', () => {
        test('removes map cache for requestId', async () => {
            const map = cache.getMap({ requestId: 'req1', name: 'data' });
            map.set('k', 'v');
            await cache.clearAsync({ requestId: 'req1' });
            const newMap = cache.getMap({ requestId: 'req1', name: 'data' });
            expect(newMap.has('k')).toBe(false);
        });

        test('removes list cache for requestId', async () => {
            const list = cache.getList({ requestId: 'req1', name: 'items' });
            list.push('x');
            await cache.clearAsync({ requestId: 'req1' });
            const newList = cache.getList({ requestId: 'req1', name: 'items' });
            expect(newList).toHaveLength(0);
        });

        test('does not throw when requestId does not exist', async () => {
            await expect(cache.clearAsync({ requestId: 'nonexistent' })).resolves.toBeUndefined();
        });
    });

    describe('clearAllAsync', () => {
        test('clears all request ids', async () => {
            cache.getMap({ requestId: 'req1', name: 'a' });
            cache.getMap({ requestId: 'req2', name: 'b' });
            cache.getList({ requestId: 'req3', name: 'c' });
            await cache.clearAllAsync();
            expect(cache.getRequestIds()).toEqual([]);
        });
    });
});
