'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../utils/querybuilder.util', () => ({
    quantityQueryBuilder: jestObj.fn(({ target, field }) => ({
        [`${field}.value`]: parseFloat(target.split('|')[0]),
        ...(target.includes('|') ? { [`${field}.system`]: target.split('|')[1] } : {})
    }))
}));

const { FilterByQuantity } = require('../../../../../operations/query/filters/quantity');
const { quantityQueryBuilder } = require('../../../../../utils/querybuilder.util');

describe('FilterByQuantity', () => {
    test('filterByItem delegates to quantityQueryBuilder', () => {
        const filter = new FilterByQuantity({
            propertyObj: { fields: ['valueQuantity'] },
            parsedArg: { queryParameterValue: { values: ['5.4|http://unitsofmeasure.org|mg'], operator: '$or' } },
            fieldMapper: { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
        filter.filterByItem('valueQuantity', '5.4|http://unitsofmeasure.org|mg');
        expect(quantityQueryBuilder).toHaveBeenCalledWith({
            target: '5.4|http://unitsofmeasure.org|mg',
            field: 'valueQuantity'
        });
    });

    test('filterByItem returns query from quantityQueryBuilder', () => {
        const filter = new FilterByQuantity({
            propertyObj: { fields: ['valueQuantity'] },
            parsedArg: { queryParameterValue: { values: ['10'], operator: '$or' } },
            fieldMapper: { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        });
        const result = filter.filterByItem('valueQuantity', '10');
        expect(result['valueQuantity.value']).toBe(10);
    });
});
