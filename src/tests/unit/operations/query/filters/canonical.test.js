'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

const { FilterByCanonical } = require('../../../../../operations/query/filters/canonical');

describe('FilterByCanonical', () => {
    const createFilter = () => {
        return new FilterByCanonical({
            propertyObj: { fields: ['instantiatesCanonical'] },
            parsedArg: {
                queryParameterValue: {
                    values: ['http://example.com/PlanDefinition/1'],
                    operator: '$or'
                }
            },
            fieldMapper: { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'CarePlan'
        });
    };

    test('filterByItem returns exact match on canonical field', () => {
        const filter = createFilter();
        const result = filter.filterByItem('instantiatesCanonical', 'http://example.com/PlanDefinition/1');
        expect(result).toEqual({ instantiatesCanonical: 'http://example.com/PlanDefinition/1' });
    });

    test('filterByItem uses fieldMapper', () => {
        const filter = new FilterByCanonical({
            propertyObj: { fields: ['url'] },
            parsedArg: { queryParameterValue: { values: ['val'], operator: '$or' } },
            fieldMapper: { getFieldName: (f) => `prefix.${f}` },
            fnUseAccessIndex: () => false,
            resourceType: 'Measure'
        });
        const result = filter.filterByItem('url', 'http://measure.com/1');
        expect(result).toEqual({ 'prefix.url': 'http://measure.com/1' });
    });

    test('filter produces correct structure', () => {
        const filter = createFilter();
        const result = filter.filter();
        expect(result).toHaveLength(1);
        expect(result[0].$or).toBeDefined();
    });
});
