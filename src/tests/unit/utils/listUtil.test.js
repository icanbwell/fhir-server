'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    findDuplicates,
    findUniques,
    findDuplicateResourcesByUuid,
    findDuplicateResourcesById,
    findUniqueResourcesByUuid,
    groupBy,
    groupByLambda,
    getFirstElementOrNull,
    removeEmptyEntriesAsync,
    removeDuplicatesWithLambda,
    sliceIntoChunks,
    sliceIntoChunksGenerator,
    addElementsToSet
} = require('../../../utils/list.util');

describe('list.util', () => {
    describe('findDuplicates', () => {
        test('finds items that appear more than once', () => {
            const list = [
                { id: '1', name: 'a' },
                { id: '2', name: 'b' },
                { id: '1', name: 'c' }
            ];
            const dupes = findDuplicates(list, x => x.id);
            expect(dupes).toHaveLength(2);
            expect(dupes.map(d => d.id)).toEqual(['1', '1']);
        });

        test('returns empty array when no duplicates', () => {
            const list = [{ id: '1' }, { id: '2' }, { id: '3' }];
            expect(findDuplicates(list, x => x.id)).toHaveLength(0);
        });
    });

    describe('findUniques', () => {
        test('finds items that appear only once', () => {
            const list = [
                { id: '1' },
                { id: '2' },
                { id: '1' }
            ];
            const uniques = findUniques(list, x => x.id);
            expect(uniques).toHaveLength(1);
            expect(uniques[0].id).toBe('2');
        });
    });

    describe('findDuplicateResourcesByUuid', () => {
        test('identifies duplicate resources by resourceType/_uuid', () => {
            const list = [
                { resourceType: 'Patient', _uuid: 'u1' },
                { resourceType: 'Patient', _uuid: 'u1' },
                { resourceType: 'Patient', _uuid: 'u2' }
            ];
            const dupes = findDuplicateResourcesByUuid(list);
            expect(dupes).toHaveLength(2);
        });

        test('same uuid different resourceType is not a duplicate', () => {
            const list = [
                { resourceType: 'Patient', _uuid: 'u1' },
                { resourceType: 'Observation', _uuid: 'u1' }
            ];
            expect(findDuplicateResourcesByUuid(list)).toHaveLength(0);
        });
    });

    describe('findDuplicateResourcesById', () => {
        test('identifies duplicate resources by resourceType/id', () => {
            const list = [
                { resourceType: 'Patient', id: 'p1' },
                { resourceType: 'Patient', id: 'p1' }
            ];
            expect(findDuplicateResourcesById(list)).toHaveLength(2);
        });
    });

    describe('findUniqueResourcesByUuid', () => {
        test('finds resources that appear only once by uuid', () => {
            const list = [
                { resourceType: 'Patient', _uuid: 'u1' },
                { resourceType: 'Patient', _uuid: 'u1' },
                { resourceType: 'Patient', _uuid: 'u2' }
            ];
            const uniques = findUniqueResourcesByUuid(list);
            expect(uniques).toHaveLength(1);
            expect(uniques[0]._uuid).toBe('u2');
        });
    });

    describe('groupBy', () => {
        test('groups objects by key', () => {
            const items = [
                { type: 'A', val: 1 },
                { type: 'B', val: 2 },
                { type: 'A', val: 3 }
            ];
            const result = groupBy(items, 'type');
            expect(result.A).toHaveLength(2);
            expect(result.B).toHaveLength(1);
        });
    });

    describe('groupByLambda', () => {
        test('groups by lambda function result', () => {
            const items = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Observation', id: '2' },
                { resourceType: 'Patient', id: '3' }
            ];
            const result = groupByLambda(items, x => x.resourceType);
            expect(result.Patient).toHaveLength(2);
            expect(result.Observation).toHaveLength(1);
        });
    });

    describe('getFirstElementOrNull', () => {
        test('returns first element', () => {
            expect(getFirstElementOrNull([10, 20, 30])).toBe(10);
        });

        test('returns null for empty array', () => {
            expect(getFirstElementOrNull([])).toBeNull();
        });
    });

    describe('removeEmptyEntriesAsync', () => {
        test('removes empty sub-arrays', async () => {
            const result = await removeEmptyEntriesAsync([[1, 2], [], [3], []]);
            expect(result).toEqual([[1, 2], [3]]);
        });

        test('returns empty array when all are empty', async () => {
            const result = await removeEmptyEntriesAsync([[], [], []]);
            expect(result).toEqual([]);
        });
    });

    describe('removeDuplicatesWithLambda', () => {
        test('removes duplicates based on comparison function', () => {
            const arr = [{ id: 1 }, { id: 2 }, { id: 1 }];
            const result = removeDuplicatesWithLambda(arr, (a, b) => a.id === b.id);
            expect(result).toHaveLength(2);
        });

        test('preserves first occurrence', () => {
            const arr = [{ id: 1, name: 'first' }, { id: 1, name: 'second' }];
            const result = removeDuplicatesWithLambda(arr, (a, b) => a.id === b.id);
            expect(result[0].name).toBe('first');
        });
    });

    describe('sliceIntoChunks', () => {
        test('slices array into chunks of specified size', () => {
            const result = sliceIntoChunks([1, 2, 3, 4, 5], 2);
            expect(result).toEqual([[1, 2], [3, 4], [5]]);
        });

        test('returns single chunk when array is smaller than chunk size', () => {
            const result = sliceIntoChunks([1, 2], 5);
            expect(result).toEqual([[1, 2]]);
        });

        test('returns empty array for empty input', () => {
            expect(sliceIntoChunks([], 3)).toEqual([]);
        });
    });

    describe('sliceIntoChunksGenerator', () => {
        test('yields chunks of specified size', () => {
            const chunks = [...sliceIntoChunksGenerator([1, 2, 3, 4, 5], 2)];
            expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
        });

        test('is lazy - does not process until iterated', () => {
            const gen = sliceIntoChunksGenerator([1, 2, 3], 1);
            expect(gen.next().value).toEqual([1]);
            expect(gen.next().value).toEqual([2]);
        });
    });

    describe('addElementsToSet', () => {
        test('adds all elements from array to set', () => {
            const set = new Set([1]);
            addElementsToSet(set, [2, 3]);
            expect(set.size).toBe(3);
        });

        test('adds elements conditionally', () => {
            const set = new Set();
            addElementsToSet(set, [1, 2, 3, 4], x => x > 2);
            expect(set.size).toBe(2);
            expect(set.has(3)).toBe(true);
            expect(set.has(4)).toBe(true);
        });

        test('handles null/undefined input array', () => {
            const set = new Set([1]);
            addElementsToSet(set, null);
            expect(set.size).toBe(1);
        });

        test('returns the set', () => {
            const set = new Set();
            const result = addElementsToSet(set, [1]);
            expect(result).toBe(set);
        });
    });
});
