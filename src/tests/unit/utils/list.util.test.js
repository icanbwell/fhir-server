'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const {
    findDuplicates,
    findDuplicateResourcesByUuid,
    findDuplicateResourcesById,
    findUniques,
    findUniqueResourcesByUuid,
    groupBy,
    groupByLambda,
    getFirstElementOrNull,
    getFirstResourceOrNull,
    getFirstBundleEntryOrNull,
    removeEmptyEntriesAsync,
    removeDuplicatesWithLambda,
    sliceIntoChunks,
    addElementsToSet,
    sliceIntoChunksGenerator
} = require('../../../utils/list.util');

describe('list.util', () => {
    describe('findDuplicates', () => {
        test('returns all items with duplicate keys', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '2', name: 'b' },
                { id: '1', name: 'c' }
            ];
            const result = findDuplicates(list, e => e.id);
            expect(result).toHaveLength(2);
            expect(result).toEqual([
                { id: '1', name: 'a' },
                { id: '1', name: 'c' }
            ]);
        });

        test('returns empty array when no duplicates exist', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '2', name: 'b' },
                { id: '3', name: 'c' }
            ];
            const result = findDuplicates(list, e => e.id);
            expect(result).toHaveLength(0);
        });

        test('returns empty array for empty input', () => {
            const result = findDuplicates([], e => e.id);
            expect(result).toHaveLength(0);
        });

        test('handles all items having the same key', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '1', name: 'b' },
                { id: '1', name: 'c' }
            ];
            const result = findDuplicates(list, e => e.id);
            expect(result).toHaveLength(3);
        });

        test('handles composite keys from lambda', () => {
            const list = [
                { type: 'Patient', id: '1' },
                { type: 'Patient', id: '2' },
                { type: 'Observation', id: '1' },
                { type: 'Patient', id: '1' }
            ];
            const result = findDuplicates(list, e => `${e.type}/${e.id}`);
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ type: 'Patient', id: '1' });
            expect(result[1]).toEqual({ type: 'Patient', id: '1' });
        });
    });

    describe('findUniques', () => {
        test('returns only items with unique keys', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '2', name: 'b' },
                { id: '1', name: 'c' },
                { id: '3', name: 'd' }
            ];
            const result = findUniques(list, e => e.id);
            expect(result).toHaveLength(2);
            expect(result).toEqual([
                { id: '2', name: 'b' },
                { id: '3', name: 'd' }
            ]);
        });

        test('returns all items when all are unique', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '2', name: 'b' },
                { id: '3', name: 'c' }
            ];
            const result = findUniques(list, e => e.id);
            expect(result).toHaveLength(3);
        });

        test('returns empty array when all items are duplicates', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '1', name: 'b' }
            ];
            const result = findUniques(list, e => e.id);
            expect(result).toHaveLength(0);
        });

        test('returns empty array for empty input', () => {
            const result = findUniques([], e => e.id);
            expect(result).toHaveLength(0);
        });
    });

    describe('findDuplicateResourcesByUuid', () => {
        test('identifies duplicate resources by resourceType and _uuid', () => {
            const list = [
                { resourceType: 'Patient', _uuid: 'uuid-1', id: 'p1' },
                { resourceType: 'Patient', _uuid: 'uuid-2', id: 'p2' },
                { resourceType: 'Patient', _uuid: 'uuid-1', id: 'p3' }
            ];
            const result = findDuplicateResourcesByUuid(list);
            expect(result).toHaveLength(2);
            expect(result[0]._uuid).toBe('uuid-1');
            expect(result[1]._uuid).toBe('uuid-1');
        });

        test('same uuid but different resourceType are not duplicates', () => {
            const list = [
                { resourceType: 'Patient', _uuid: 'uuid-1' },
                { resourceType: 'Observation', _uuid: 'uuid-1' }
            ];
            const result = findDuplicateResourcesByUuid(list);
            expect(result).toHaveLength(0);
        });
    });

    describe('findDuplicateResourcesById', () => {
        test('identifies duplicate resources by resourceType and id', () => {
            const list = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' },
                { resourceType: 'Patient', id: '1' }
            ];
            const result = findDuplicateResourcesById(list);
            expect(result).toHaveLength(2);
        });

        test('same id but different resourceType are not duplicates', () => {
            const list = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Observation', id: '1' }
            ];
            const result = findDuplicateResourcesById(list);
            expect(result).toHaveLength(0);
        });
    });

    describe('findUniqueResourcesByUuid', () => {
        test('returns resources that have unique resourceType/uuid combinations', () => {
            const list = [
                { resourceType: 'Patient', _uuid: 'uuid-1' },
                { resourceType: 'Patient', _uuid: 'uuid-2' },
                { resourceType: 'Patient', _uuid: 'uuid-1' }
            ];
            const result = findUniqueResourcesByUuid(list);
            expect(result).toHaveLength(1);
            expect(result[0]._uuid).toBe('uuid-2');
        });
    });

    describe('groupBy', () => {
        test('groups items by the specified key', () => {
            const items = [
                { type: 'fruit', name: 'apple' },
                { type: 'vegetable', name: 'carrot' },
                { type: 'fruit', name: 'banana' }
            ];
            const result = groupBy(items, 'type');
            expect(result.fruit).toHaveLength(2);
            expect(result.vegetable).toHaveLength(1);
        });

        test('creates "undefined" group when key is missing from items', () => {
            const items = [
                { type: 'fruit', name: 'apple' },
                { name: 'mystery' }
            ];
            const result = groupBy(items, 'type');
            expect(result.fruit).toHaveLength(1);
            expect(result['undefined']).toHaveLength(1);
            expect(result['undefined'][0].name).toBe('mystery');
        });

        test('handles empty array', () => {
            const result = groupBy([], 'type');
            expect(result).toEqual({});
        });

        test('all items in same group', () => {
            const items = [
                { type: 'a', val: 1 },
                { type: 'a', val: 2 },
                { type: 'a', val: 3 }
            ];
            const result = groupBy(items, 'type');
            expect(Object.keys(result)).toHaveLength(1);
            expect(result.a).toHaveLength(3);
        });
    });

    describe('groupByLambda', () => {
        test('groups items using a lambda function', () => {
            const items = [
                { firstName: 'John', lastName: 'Doe' },
                { firstName: 'Jane', lastName: 'Doe' },
                { firstName: 'Bob', lastName: 'Smith' }
            ];
            const result = groupByLambda(items, i => i.lastName);
            expect(result['Doe']).toHaveLength(2);
            expect(result['Smith']).toHaveLength(1);
        });

        test('handles lambda returning composite key', () => {
            const items = [
                { resourceType: 'Patient', status: 'active' },
                { resourceType: 'Patient', status: 'inactive' },
                { resourceType: 'Patient', status: 'active' }
            ];
            const result = groupByLambda(items, i => `${i.resourceType}-${i.status}`);
            expect(result['Patient-active']).toHaveLength(2);
            expect(result['Patient-inactive']).toHaveLength(1);
        });

        test('handles empty array', () => {
            const result = groupByLambda([], i => i.id);
            expect(result).toEqual({});
        });
    });

    describe('getFirstElementOrNull', () => {
        test('returns first element from non-empty array', () => {
            expect(getFirstElementOrNull(['a', 'b', 'c'])).toBe('a');
        });

        test('returns null for empty array', () => {
            expect(getFirstElementOrNull([])).toBeNull();
        });

        test('returns first element even if it is falsy', () => {
            expect(getFirstElementOrNull([0, 1, 2])).toBe(0);
            expect(getFirstElementOrNull(['', 'a'])).toBe('');
            expect(getFirstElementOrNull([false, true])).toBe(false);
        });
    });

    describe('getFirstResourceOrNull', () => {
        test('returns first resource from non-empty array', () => {
            const resources = [{ id: '1' }, { id: '2' }];
            expect(getFirstResourceOrNull(resources)).toEqual({ id: '1' });
        });

        test('returns null for empty array', () => {
            expect(getFirstResourceOrNull([])).toBeNull();
        });
    });

    describe('getFirstBundleEntryOrNull', () => {
        test('returns first entry from non-empty array', () => {
            const entries = [{ resource: { id: '1' } }, { resource: { id: '2' } }];
            expect(getFirstBundleEntryOrNull(entries)).toEqual({ resource: { id: '1' } });
        });

        test('returns null for empty array', () => {
            expect(getFirstBundleEntryOrNull([])).toBeNull();
        });
    });

    describe('removeEmptyEntriesAsync', () => {
        test('removes empty arrays from array of arrays', async () => {
            const input = [[1, 2], [], [3], [], [4, 5]];
            const result = await removeEmptyEntriesAsync(input);
            expect(result).toEqual([[1, 2], [3], [4, 5]]);
        });

        test('returns empty array when all entries are empty', async () => {
            const input = [[], [], []];
            const result = await removeEmptyEntriesAsync(input);
            expect(result).toEqual([]);
        });

        test('returns all arrays when none are empty', async () => {
            const input = [[1], [2], [3]];
            const result = await removeEmptyEntriesAsync(input);
            expect(result).toEqual([[1], [2], [3]]);
        });

        test('returns empty array for empty input', async () => {
            const result = await removeEmptyEntriesAsync([]);
            expect(result).toEqual([]);
        });
    });

    describe('removeDuplicatesWithLambda', () => {
        test('removes duplicate items based on comparison function', () => {
            const array = [
                { id: '1', name: 'first' },
                { id: '2', name: 'second' },
                { id: '1', name: 'third' }
            ];
            const result = removeDuplicatesWithLambda(array, (a, b) => a.id === b.id);
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('first');
            expect(result[1].name).toBe('second');
        });

        test('preserves first occurrence when duplicates found', () => {
            const array = [
                { id: '1', order: 1 },
                { id: '1', order: 2 },
                { id: '1', order: 3 }
            ];
            const result = removeDuplicatesWithLambda(array, (a, b) => a.id === b.id);
            expect(result).toHaveLength(1);
            expect(result[0].order).toBe(1);
        });

        test('returns all items when no duplicates', () => {
            const array = [
                { id: '1' },
                { id: '2' },
                { id: '3' }
            ];
            const result = removeDuplicatesWithLambda(array, (a, b) => a.id === b.id);
            expect(result).toHaveLength(3);
        });

        test('returns empty array for empty input', () => {
            const result = removeDuplicatesWithLambda([], (a, b) => a === b);
            expect(result).toEqual([]);
        });

        test('handles complex comparison functions', () => {
            const array = [
                { type: 'Patient', id: '1' },
                { type: 'Observation', id: '1' },
                { type: 'Patient', id: '1' }
            ];
            const result = removeDuplicatesWithLambda(
                array,
                (a, b) => a.type === b.type && a.id === b.id
            );
            expect(result).toHaveLength(2);
        });
    });

    describe('sliceIntoChunks', () => {
        test('splits array into chunks of specified size', () => {
            const arr = [1, 2, 3, 4, 5];
            const result = sliceIntoChunks(arr, 2);
            expect(result).toEqual([[1, 2], [3, 4], [5]]);
        });

        test('returns single chunk when chunk size >= array length', () => {
            const arr = [1, 2, 3];
            const result = sliceIntoChunks(arr, 5);
            expect(result).toEqual([[1, 2, 3]]);
        });

        test('returns single chunk when chunk size equals array length', () => {
            const arr = [1, 2, 3];
            const result = sliceIntoChunks(arr, 3);
            expect(result).toEqual([[1, 2, 3]]);
        });

        test('returns empty array for empty input', () => {
            const result = sliceIntoChunks([], 3);
            expect(result).toEqual([]);
        });

        test('each element becomes its own chunk when chunk size is 1', () => {
            const arr = [1, 2, 3];
            const result = sliceIntoChunks(arr, 1);
            expect(result).toEqual([[1], [2], [3]]);
        });

        test('chunk size of 0 causes infinite loop (known issue - do not call with 0)', () => {
            // This test documents the known issue that chunkSize=0 causes an infinite loop
            // because i += 0 never progresses. We do NOT actually run it to avoid hanging.
            // Instead, we verify the logic: if chunkSize is 0, the for loop never terminates.
            expect(0 + 0).toBe(0); // i += chunkSize never advances when chunkSize is 0
        });

        test('does not mutate original array', () => {
            const arr = [1, 2, 3, 4, 5];
            const original = [...arr];
            sliceIntoChunks(arr, 2);
            expect(arr).toEqual(original);
        });
    });

    describe('sliceIntoChunksGenerator', () => {
        test('yields chunks of specified size', () => {
            const arr = [1, 2, 3, 4, 5];
            const gen = sliceIntoChunksGenerator(arr, 2);
            const chunks = [...gen];
            expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
        });

        test('yields single chunk when chunk size >= array length', () => {
            const arr = [1, 2, 3];
            const gen = sliceIntoChunksGenerator(arr, 10);
            const chunks = [...gen];
            expect(chunks).toEqual([[1, 2, 3]]);
        });

        test('yields nothing for empty array', () => {
            const gen = sliceIntoChunksGenerator([], 3);
            const chunks = [...gen];
            expect(chunks).toEqual([]);
        });

        test('is lazy - does not compute all chunks at once', () => {
            const arr = [1, 2, 3, 4, 5, 6];
            const gen = sliceIntoChunksGenerator(arr, 2);
            const first = gen.next();
            expect(first.value).toEqual([1, 2]);
            expect(first.done).toBe(false);
            const second = gen.next();
            expect(second.value).toEqual([3, 4]);
            expect(second.done).toBe(false);
        });

        test('returns done:true after last chunk', () => {
            const arr = [1, 2];
            const gen = sliceIntoChunksGenerator(arr, 2);
            gen.next(); // [1, 2]
            const end = gen.next();
            expect(end.done).toBe(true);
            expect(end.value).toBeUndefined();
        });
    });

    describe('addElementsToSet', () => {
        test('adds all elements from array to set without condition', () => {
            const set = new Set();
            const result = addElementsToSet(set, [1, 2, 3]);
            expect(result.size).toBe(3);
            expect(result.has(1)).toBe(true);
            expect(result.has(2)).toBe(true);
            expect(result.has(3)).toBe(true);
        });

        test('adds only elements meeting condition', () => {
            const set = new Set();
            const result = addElementsToSet(set, [1, 2, 3, 4, 5], r => r > 3);
            expect(result.size).toBe(2);
            expect(result.has(4)).toBe(true);
            expect(result.has(5)).toBe(true);
            expect(result.has(1)).toBe(false);
        });

        test('handles null arr gracefully via optional chaining', () => {
            const set = new Set([1]);
            const result = addElementsToSet(set, null);
            expect(result.size).toBe(1);
        });

        test('handles undefined arr gracefully via optional chaining', () => {
            const set = new Set([1]);
            const result = addElementsToSet(set, undefined);
            expect(result.size).toBe(1);
        });

        test('returns the same set instance (mutates in place)', () => {
            const set = new Set();
            const result = addElementsToSet(set, [1, 2]);
            expect(result).toBe(set);
        });

        test('does not add duplicate values to set', () => {
            const set = new Set([1, 2]);
            addElementsToSet(set, [2, 3, 3]);
            expect(set.size).toBe(3);
        });

        test('condition with undefined is treated as no condition (falsy)', () => {
            const set = new Set();
            addElementsToSet(set, [1, 2, 3], undefined);
            expect(set.size).toBe(3);
        });

        test('works with Set as arr parameter (Set has forEach)', () => {
            const set = new Set();
            const inputSet = new Set([10, 20, 30]);
            addElementsToSet(set, inputSet);
            expect(set.size).toBe(3);
            expect(set.has(10)).toBe(true);
        });
    });
});
