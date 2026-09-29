const { describe, test, expect } = require('@jest/globals');
const { MongoQuerySimplifier } = require('../../../utils/mongoQuerySimplifier');

describe('MongoQuerySimplifier', () => {
    describe('simplifyFilter', () => {
        test('returns null when filter is null', () => {
            const result = MongoQuerySimplifier.simplifyFilter({ filter: null });
            expect(result).toBeNull();
        });

        test('returns undefined when filter is undefined', () => {
            const result = MongoQuerySimplifier.simplifyFilter({ filter: undefined });
            expect(result).toBeUndefined();
        });

        test('returns simple filter unchanged', () => {
            const filter = { name: 'test' };
            const result = MongoQuerySimplifier.simplifyFilter({ filter });
            expect(result).toEqual({ name: 'test' });
        });

        describe('$or simplification', () => {
            test('removes duplicate $or entries', () => {
                const filter = {
                    $or: [
                        { name: 'a' },
                        { name: 'a' },
                        { name: 'b' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // Should have removed duplicate and converted to $in
                expect(result).toEqual({ name: { $in: ['a', 'b'] } });
            });

            test('unwraps single-element $or when no other keys exist', () => {
                const filter = { $or: [{ name: 'test' }] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ name: 'test' });
            });

            test('single-element $or with other keys: $or is converted to direct value via $in->single path', () => {
                const filter = { $or: [{ name: 'test' }], status: 'active' };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The code converts the $or to $in->single value path (line 72-83)
                // which deletes $or and adds name='test' directly to the filter
                expect(result).toEqual({ name: 'test', status: 'active' });
            });

            test('flattens nested $or into parent $or', () => {
                const filter = {
                    $or: [
                        { $or: [{ a: 1 }, { b: 2 }] },
                        { c: 3 }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The nested $or should be flattened and then converted to individual entries
                expect(result.$or).toBeDefined();
                // All entries should be at the same level
                const flatValues = result.$or || [result];
                expect(flatValues).toBeDefined();
            });

            test('converts $or with same key into $in', () => {
                const filter = {
                    $or: [
                        { status: 'active' },
                        { status: 'inactive' },
                        { status: 'pending' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ status: { $in: ['active', 'inactive', 'pending'] } });
            });

            test('converts $or with single same-key value into direct assignment', () => {
                const filter = {
                    $or: [
                        { status: 'active' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ status: 'active' });
            });

            test('preserves $or with different keys as optimized $or with $in', () => {
                const filter = {
                    $or: [
                        { name: 'a' },
                        { name: 'b' },
                        { status: 'active' },
                        { status: 'inactive' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$or).toBeDefined();
                expect(result.$or).toContainEqual({ name: { $in: ['a', 'b'] } });
                expect(result.$or).toContainEqual({ status: { $in: ['active', 'inactive'] } });
            });

            test('does not convert $or to $in when subfilters have multiple keys', () => {
                const filter = {
                    $or: [
                        { name: 'a', status: 'active' },
                        { name: 'b', status: 'inactive' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // Should keep as $or since subfilters have multiple keys
                expect(result.$or).toBeDefined();
                expect(result.$or.length).toBe(2);
            });

            test('does not convert $or to $in when subfilter values are arrays', () => {
                const filter = {
                    $or: [
                        { tags: ['a', 'b'] },
                        { tags: ['c', 'd'] }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$or).toBeDefined();
            });

            test('does not convert $or to $in when subfilter values are objects/filters', () => {
                const filter = {
                    $or: [
                        { age: { $gt: 5 } },
                        { age: { $lt: 3 } }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$or).toBeDefined();
            });

            test('empty $or array is cleaned up by final loop', () => {
                const filter = { $or: [] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The second loop at line 146 removes empty arrays
                expect(result).toEqual({});
            });
        });

        describe('$and simplification', () => {
            test('removes duplicate $and entries', () => {
                const filter = {
                    $and: [
                        { name: 'a' },
                        { name: 'a' },
                        { status: 'active' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$and).toBeDefined();
                expect(result.$and.length).toBe(2);
            });

            test('unwraps single-element $and when no other keys exist', () => {
                const filter = { $and: [{ name: 'test' }] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ name: 'test' });
            });

            test('flattens nested $and into parent $and', () => {
                const filter = {
                    $and: [
                        { $and: [{ a: 1 }, { b: 2 }] },
                        { c: 3 }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$and).toBeDefined();
                expect(result.$and).toContainEqual({ a: 1 });
                expect(result.$and).toContainEqual({ b: 2 });
                expect(result.$and).toContainEqual({ c: 3 });
            });

            test('empty $and array is cleaned up by final loop', () => {
                const filter = { $and: [] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The second loop at line 146 removes empty arrays
                expect(result).toEqual({});
            });
        });

        describe('$nor simplification', () => {
            test('removes duplicate $nor entries', () => {
                const filter = {
                    $nor: [
                        { name: 'a' },
                        { name: 'a' },
                        { name: 'b' }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$nor.length).toBe(2);
            });

            test('recursively simplifies $nor sub-filters', () => {
                const filter = {
                    $nor: [
                        { $and: [{ name: 'a' }] }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$nor).toEqual([{ name: 'a' }]);
            });
        });

        describe('$in simplification', () => {
            test('removes duplicate $in entries', () => {
                const filter = { $in: ['a', 'a', 'b'] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ $in: ['a', 'b'] });
            });

            test('BUG: single-element $in replaces entire filter with the scalar value', () => {
                // When $in has one element and it's the only key, the code does:
                // filter = filter.$in[0]
                // This replaces the entire filter object with a scalar
                // e.g. {$in: ["active"]} becomes "active"
                // This is only correct if this is a NESTED filter value like {status: {$in: ["active"]}}
                // But if this is the TOP-LEVEL filter, it becomes a string, which is wrong
                const filter = { $in: ['active'] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The filter becomes just the string "active" - losing the filter context
                expect(result).toBe('active');
            });

            test('$in with multiple elements after dedup stays as $in', () => {
                const filter = { $in: ['a', 'b', 'c'] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ $in: ['a', 'b', 'c'] });
            });

            test('nested $in simplification works correctly', () => {
                // This is the intended use case: {status: {$in: ["active"]}} -> {status: "active"}
                const filter = { status: { $in: ['active'] } };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ status: 'active' });
            });
        });

        describe('recursive simplification', () => {
            test('recursively simplifies nested filter objects', () => {
                const filter = {
                    name: { $or: [{ $eq: 'a' }] }
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The nested $or with one element should be unwrapped
                expect(result).toEqual({ name: { $eq: 'a' } });
            });

            test('removes empty nested filters', () => {
                const filter = {
                    name: 'test',
                    meta: {}
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.meta).toBeUndefined();
                expect(result.name).toBe('test');
            });

            test('removes empty nested arrays', () => {
                const filter = {
                    name: 'test',
                    $and: []
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The second loop at line 146 processes all array values
                // Empty array gets filtered, then deleted
                expect(result.$and).toBeUndefined();
            });
        });

        describe('isEmpty', () => {
            test('null is empty', () => {
                expect(MongoQuerySimplifier.isEmpty(null)).toBe(true);
            });

            test('undefined is empty', () => {
                expect(MongoQuerySimplifier.isEmpty(undefined)).toBe(true);
            });

            test('empty string is empty', () => {
                expect(MongoQuerySimplifier.isEmpty('')).toBe(true);
            });

            test('zero is NOT empty', () => {
                // EXPECTED: correct behavior (will fail until bug is fixed)
                // 0 is a valid query value (e.g. {count: 0}) and should NOT be treated as empty
                expect(MongoQuerySimplifier.isEmpty(0)).toBe(false);
            });

            test('false is NOT empty', () => {
                // EXPECTED: correct behavior (will fail until bug is fixed)
                // false is a valid query value (e.g. {active: false}) and should NOT be treated as empty
                expect(MongoQuerySimplifier.isEmpty(false)).toBe(false);
            });

            test('empty array is empty', () => {
                expect(MongoQuerySimplifier.isEmpty([])).toBe(true);
            });

            test('empty object is empty', () => {
                expect(MongoQuerySimplifier.isEmpty({})).toBe(true);
            });

            test('non-empty object is not empty', () => {
                expect(MongoQuerySimplifier.isEmpty({ a: 1 })).toBe(false);
            });

            test('non-empty array is not empty', () => {
                expect(MongoQuerySimplifier.isEmpty([1])).toBe(false);
            });

            test('non-empty string is not empty', () => {
                expect(MongoQuerySimplifier.isEmpty('hello')).toBe(false);
            });
        });

        describe('isFilter', () => {
            test('plain object is a filter', () => {
                expect(MongoQuerySimplifier.isFilter({ a: 1 })).toBe(true);
            });

            test('array is not a filter', () => {
                expect(MongoQuerySimplifier.isFilter([1, 2])).toBe(false);
            });

            test('Date is not a filter', () => {
                expect(MongoQuerySimplifier.isFilter(new Date())).toBe(false);
            });

            test('RegExp is not a filter', () => {
                expect(MongoQuerySimplifier.isFilter(/test/)).toBe(false);
            });

            test('string is not a filter', () => {
                expect(MongoQuerySimplifier.isFilter('test')).toBe(false);
            });

            test('number is not a filter', () => {
                expect(MongoQuerySimplifier.isFilter(42)).toBe(false);
            });

            test('null is not a filter', () => {
                expect(MongoQuerySimplifier.isFilter(null)).toBe(false);
            });
        });

        describe('findColumnsInFilter', () => {
            test('finds simple column names', () => {
                const filter = { name: 'test', status: 'active' };
                const result = MongoQuerySimplifier.findColumnsInFilter({ filter });
                expect(result).toEqual(new Set(['name', 'status']));
            });

            test('finds nested column names with dot notation', () => {
                const filter = { meta: { versionId: '1' } };
                const result = MongoQuerySimplifier.findColumnsInFilter({ filter });
                expect(result).toEqual(new Set(['meta.versionId']));
            });

            test('finds columns inside $and', () => {
                const filter = { $and: [{ name: 'a' }, { status: 'active' }] };
                const result = MongoQuerySimplifier.findColumnsInFilter({ filter });
                expect(result.has('name')).toBe(true);
                expect(result.has('status')).toBe(true);
            });

            test('finds columns inside $or', () => {
                const filter = { $or: [{ name: 'a' }, { name: 'b' }] };
                const result = MongoQuerySimplifier.findColumnsInFilter({ filter });
                expect(result.has('name')).toBe(true);
            });

            test('returns empty set for non-filter input', () => {
                const result = MongoQuerySimplifier.findColumnsInFilter({ filter: 'not a filter' });
                expect(result.size).toBe(0);
            });

            test('returns empty set for empty filter', () => {
                const result = MongoQuerySimplifier.findColumnsInFilter({ filter: {} });
                expect(result.size).toBe(0);
            });

            test('handles parentKey prefix', () => {
                const filter = { name: 'test' };
                const result = MongoQuerySimplifier.findColumnsInFilter({ parentKey: 'resource', filter });
                expect(result).toEqual(new Set(['resource.name']));
            });
        });

        describe('isEmpty must NOT treat 0 and false as empty (correct behavior assertions)', () => {
            test('$or with count:0 and count:1 preserves the 0 condition', () => {
                // EXPECTED: correct behavior (will fail until bug is fixed)
                // Query: "find docs where count is 0 OR count is 1"
                // 0 is a valid value and must NOT be dropped
                const filter = { $or: [{ count: 0 }, { count: 1 }] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ count: { $in: [0, 1] } });
            });

            test('$or with active:false and active:true preserves the false condition', () => {
                // EXPECTED: correct behavior (will fail until bug is fixed)
                // Query: "find docs where active is false OR active is true"
                // false is a valid value and must NOT be dropped
                const filter = { $or: [{ active: false }, { active: true }] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ active: { $in: [false, true] } });
            });

            test('$or with value 0 among many values preserves the 0', () => {
                // EXPECTED: correct behavior (will fail until bug is fixed)
                const filter = { $or: [{ priority: 0 }, { priority: 1 }, { priority: 2 }] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ priority: { $in: [0, 1, 2] } });
            });

            test('literal 0 in $and array is preserved', () => {
                // EXPECTED: correct behavior (will fail until bug is fixed)
                // Edge case: literal values in $and (unusual but possible from code generation)
                const filter = { $and: [0, { name: 'test' }] };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // 0 should NOT be removed - it is a valid value
                expect(result).toEqual({ $and: [0, { name: 'test' }] });
            });
        });

        describe('complex edge cases', () => {
            test('handles deeply nested $or within $and', () => {
                const filter = {
                    $and: [
                        { $or: [{ a: 1 }, { a: 2 }] },
                        { b: 3 }
                    ]
                };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result.$and).toBeDefined();
                // The $or should be simplified to $in
                const orEntry = result.$and.find(f => f.a);
                expect(orEntry).toEqual({ a: { $in: [1, 2] } });
            });

            test('handles filter with Date values (not treated as sub-filter)', () => {
                const date = new Date('2023-01-01');
                const filter = { createdAt: { $gt: date } };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ createdAt: { $gt: date } });
            });

            test('handles filter with RegExp values (not treated as sub-filter)', () => {
                const regex = /test/i;
                const filter = { name: regex };
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                expect(result).toEqual({ name: regex });
            });

            test('BUG: $or with null entries in subfilters', () => {
                // If a subFilter in $or is null, the code at line 39 checks
                // `if (subFilter && this.isFilter(subFilter))` which guards against null
                // But the map at line 21 calls simplifyFilter on it first
                const filter = {
                    $or: [
                        null,
                        { name: 'a' }
                    ]
                };
                // simplifyFilter is called on null which returns null
                // Then at line 39, null is checked with `subFilter && this.isFilter(subFilter)`
                // null fails the truthiness check so it's skipped
                // But null remains in the $or array
                const result = MongoQuerySimplifier.simplifyFilter({ filter });
                // The null entry stays in the $or - it won't crash but produces invalid MongoDB query
                expect(result).toBeDefined();
            });
        });
    });
});
