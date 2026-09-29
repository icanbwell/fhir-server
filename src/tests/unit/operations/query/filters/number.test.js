'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { numberQueryBuilder } = require('../../../../../utils/querybuilder.util');
const { FilterByNumber } = require('../../../../../operations/query/filters/number');

describe('FilterByNumber', () => {
    const makeFieldMapper = () => ({
        getFieldName: jestObj.fn((f) => f)
    });

    const makeFilterParams = (overrides = {}) => ({
        propertyObj: { fields: ['valueQuantity.value'] },
        parsedArg: {
            queryParameterValue: {
                values: ['100'],
                operator: '$and'
            }
        },
        fieldMapper: makeFieldMapper(),
        fnUseAccessIndex: jestObj.fn(() => false),
        resourceType: 'Observation',
        ...overrides
    });

    describe('filterByItem', () => {
        test('delegates to numberQueryBuilder with target and field', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('valueQuantity.value', '100');
            const expected = numberQueryBuilder({ target: '100', field: 'valueQuantity.value' });
            expect(result).toEqual(expected);
        });

        test('handles plain number without prefix (implicit range)', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', '5');
            expect(result).toHaveProperty('count');
            expect(result.count).toHaveProperty('$gte');
            expect(result.count).toHaveProperty('$lt');
            // 5 with implicit range: [4.5, 5.5)
            expect(result.count.$gte).toBeLessThan(5);
            expect(result.count.$lt).toBeGreaterThan(5);
        });

        test('handles lt prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'lt100');
            expect(result).toEqual({ count: { $lt: 100 } });
        });

        test('handles le prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'le100');
            expect(result).toEqual({ count: { $lte: 100 } });
        });

        test('handles gt prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'gt50');
            expect(result).toEqual({ count: { $gt: 50 } });
        });

        test('handles ge prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'ge50');
            expect(result).toEqual({ count: { $gte: 50 } });
        });

        test('handles ne prefix (not equal range)', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'ne100');
            expect(result).toHaveProperty('count');
            expect(result.count).toHaveProperty('$exists', true);
            expect(result.count).toHaveProperty('$not');
            expect(result.count.$not).toHaveProperty('$gte');
            expect(result.count.$not).toHaveProperty('$lt');
        });

        test('handles ap prefix (approximately)', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'ap100');
            expect(result).toHaveProperty('count');
            expect(result.count).toHaveProperty('$gte');
            expect(result.count).toHaveProperty('$lt');
            // ap uses 10% tolerance: [90, 110)
            expect(result.count.$gte).toBeLessThan(100);
            expect(result.count.$lt).toBeGreaterThan(100);
        });

        test('returns empty string for non-string target', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 123);
            expect(result).toBe('');
        });

        test('returns empty object for invalid prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'xx100');
            expect(result).toEqual({});
        });

        test('returns empty object for non-numeric value after prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'ltabc');
            expect(result).toEqual({});
        });

        test('handles decimal numbers', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'lt5.5');
            expect(result).toEqual({ count: { $lt: 5.5 } });
        });

        test('handles negative numbers with prefix', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'gt-10');
            expect(result).toEqual({ count: { $gt: -10 } });
        });

        test('handles scientific notation', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', '1e2');
            expect(result).toHaveProperty('count');
            expect(result.count).toHaveProperty('$gte');
            expect(result.count).toHaveProperty('$lt');
        });

        test('handles zero value', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', '0');
            expect(result).toHaveProperty('count');
            expect(result.count).toHaveProperty('$gte');
            expect(result.count).toHaveProperty('$lt');
        });

        test('handles gt with zero', () => {
            const filter = new FilterByNumber(makeFilterParams());
            const result = filter.filterByItem('count', 'gt0');
            expect(result).toEqual({ count: { $gt: 0 } });
        });
    });

    describe('filter (inherited)', () => {
        test('builds filter using numberQueryBuilder for each value and field', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['count'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['gt10'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByNumber(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            expect(result[0].$or).toBeDefined();
            expect(result[0].$or[0].$and).toEqual([{ count: { $gt: 10 } }]);
        });

        test('handles multiple values', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['count'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['gt10', 'lt100'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByNumber(params);
            const result = filter.filter();
            expect(result[0].$or[0].$and).toHaveLength(2);
            expect(result[0].$or[0].$and[0]).toEqual({ count: { $gt: 10 } });
            expect(result[0].$or[0].$and[1]).toEqual({ count: { $lt: 100 } });
        });

        test('handles multiple fields', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['count', 'total'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['gt5'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByNumber(params);
            const result = filter.filter();
            expect(result[0].$or).toHaveLength(2);
        });

        test('returns empty array when no values', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: null, operator: '$and' } }
            });
            const filter = new FilterByNumber(params);
            expect(filter.filter()).toEqual([]);
        });
    });
});
