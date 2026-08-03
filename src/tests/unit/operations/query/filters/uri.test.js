'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

const { FilterByUri } = require('../../../../../operations/query/filters/uri');

describe('FilterByUri', () => {
    const createFilter = (fieldMapper) => {
        return new FilterByUri({
            propertyObj: { fields: ['url'] },
            parsedArg: { queryParameterValue: { values: ['http://example.com'], operator: '$or' } },
            fieldMapper: fieldMapper || { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'ValueSet'
        });
    };

    test('filterByItem returns exact match on field', () => {
        const filter = createFilter();
        const result = filter.filterByItem('url', 'http://example.com/fhir/ValueSet/1');
        expect(result).toEqual({ url: 'http://example.com/fhir/ValueSet/1' });
    });

    test('filterByItem uses fieldMapper to transform field name', () => {
        const fieldMapper = { getFieldName: (f) => `mapped_${f}` };
        const filter = createFilter(fieldMapper);
        const result = filter.filterByItem('url', 'http://test.com');
        expect(result).toEqual({ mapped_url: 'http://test.com' });
    });

    test('filter() produces $or with filterByItem results', () => {
        const filter = createFilter();
        const result = filter.filter();
        expect(result).toHaveLength(1);
        expect(result[0].$or).toBeDefined();
    });
});
