'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { FilterByAbove, FilterByBelow } = require('../../../../../operations/query/filters/aboveAndBelow');

describe('FilterByAbove', () => {
    const makeFilter = () => {
        return new FilterByAbove({
            propertyObj: { fields: ['date'] },
            parsedArg: {
                queryParameterValue: { values: ['2024-01-01'], operator: '$and' }
            },
            fieldMapper: { getFieldName: (field) => field },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
    };

    test('filterByItem produces $gt query', () => {
        const filter = makeFilter();
        const result = filter.filterByItem('date', '2024-01-01');
        expect(result).toEqual({ date: { $gt: '2024-01-01' } });
    });

    test('uses fieldMapper for field name', () => {
        const filter = new FilterByAbove({
            propertyObj: { fields: ['effectiveDateTime'] },
            parsedArg: { queryParameterValue: { values: ['2024-06-01'], operator: '$and' } },
            fieldMapper: { getFieldName: (field) => `meta.${field}` },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
        const result = filter.filterByItem('effectiveDateTime', '2024-06-01');
        expect(result).toEqual({ 'meta.effectiveDateTime': { $gt: '2024-06-01' } });
    });

    test('filter() produces $or wrapping $and with $gt queries', () => {
        const filter = makeFilter();
        const result = filter.filter();
        expect(result).toHaveLength(1);
        expect(result[0].$or).toBeDefined();
        expect(result[0].$or[0].$and[0]).toEqual({ date: { $gt: '2024-01-01' } });
    });
});

describe('FilterByBelow', () => {
    const makeFilter = () => {
        return new FilterByBelow({
            propertyObj: { fields: ['date'] },
            parsedArg: {
                queryParameterValue: { values: ['2024-12-31'], operator: '$and' }
            },
            fieldMapper: { getFieldName: (field) => field },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
    };

    test('filterByItem produces $lt query', () => {
        const filter = makeFilter();
        const result = filter.filterByItem('date', '2024-12-31');
        expect(result).toEqual({ date: { $lt: '2024-12-31' } });
    });

    test('uses fieldMapper for field name', () => {
        const filter = new FilterByBelow({
            propertyObj: { fields: ['value'] },
            parsedArg: { queryParameterValue: { values: ['100'], operator: '$and' } },
            fieldMapper: { getFieldName: (field) => `resource.${field}` },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
        const result = filter.filterByItem('value', '100');
        expect(result).toEqual({ 'resource.value': { $lt: '100' } });
    });

    test('filter() produces $or wrapping $and with $lt queries', () => {
        const filter = makeFilter();
        const result = filter.filter();
        expect(result).toHaveLength(1);
        expect(result[0].$or).toBeDefined();
        expect(result[0].$or[0].$and[0]).toEqual({ date: { $lt: '2024-12-31' } });
    });

    test('multiple values produce multiple filter items', () => {
        const filter = new FilterByBelow({
            propertyObj: { fields: ['date'] },
            parsedArg: {
                queryParameterValue: { values: ['2024-01-01', '2024-06-01'], operator: '$or' }
            },
            fieldMapper: { getFieldName: (field) => field },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
        const result = filter.filter();
        expect(result[0].$or[0].$or).toHaveLength(2);
    });
});
