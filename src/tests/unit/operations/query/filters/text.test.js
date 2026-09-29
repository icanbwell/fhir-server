'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../utils/querybuilder.util', () => ({
    textQueryBuilder: jestObj.fn(({ field, text, ignoreCase }) => {
        const query = {};
        if (ignoreCase) {
            query[field] = { $regex: new RegExp(`^(${text})`), $options: 'i' };
        } else {
            query[field] = { $regex: new RegExp(`^(${text})`) };
        }
        return query;
    })
}));

const { FilterByText } = require('../../../../../operations/query/filters/text');

describe('FilterByText', () => {
    const createFilter = ({ fields = ['code'], values = ['headache'], operator = '$or', value = 'headache', fieldType = null } = {}) => {
        return new FilterByText({
            propertyObj: { fields, fieldType },
            parsedArg: {
                queryParameterValue: { values, operator, value }
            },
            fieldMapper: { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'Condition'
        });
    };

    test('filterText returns array of and_segments', () => {
        const filter = createFilter();
        const result = filter.filterText();
        expect(Array.isArray(result)).toBe(true);
    });

    test('filterText returns empty array when values is undefined', () => {
        const filter = new FilterByText({
            propertyObj: { fields: ['code'] },
            parsedArg: {
                queryParameterValue: { values: undefined, operator: '$or', value: 'test' }
            },
            fieldMapper: { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'Condition'
        });
        const result = filter.filterText();
        expect(result).toEqual([]);
    });

    test('filterText produces $or segment for non-identifier fields', () => {
        const filter = createFilter({ fields: ['code'], values: ['headache'], value: 'headache' });
        const result = filter.filterText();

        expect(result).toHaveLength(1);
        expect(result[0].$or).toBeDefined();
    });

    test('filterText searches in .text and .coding.display for non-identifier fields', () => {
        const { textQueryBuilder } = require('../../../../../utils/querybuilder.util');
        textQueryBuilder.mockClear();

        const filter = createFilter({ fields: ['code'], values: ['headache'], value: 'headache' });
        filter.filterText();

        // For each non-identifier field, textQueryBuilder is called for .text and .coding.display
        const calls = textQueryBuilder.mock.calls;
        const fieldArgs = calls.map(c => c[0].field);
        expect(fieldArgs).toContain('code.text');
        expect(fieldArgs).toContain('code.coding.display');
    });

    test('filterText searches in identifier.type.text for identifier fields', () => {
        const { textQueryBuilder } = require('../../../../../utils/querybuilder.util');
        textQueryBuilder.mockClear();

        const filter = createFilter({ fields: ['identifier'], values: ['MRN'], value: 'MRN' });
        filter.filterText();

        const calls = textQueryBuilder.mock.calls;
        const fieldArgs = calls.map(c => c[0].field);
        expect(fieldArgs).toContain('identifier.type.text');
    });

    test('filterText uses ignoreCase: true', () => {
        const { textQueryBuilder } = require('../../../../../utils/querybuilder.util');
        textQueryBuilder.mockClear();

        const filter = createFilter();
        filter.filterText();

        textQueryBuilder.mock.calls.forEach(call => {
            expect(call[0].ignoreCase).toBe(true);
        });
    });

    test('filterText uses the value property for text search', () => {
        const { textQueryBuilder } = require('../../../../../utils/querybuilder.util');
        textQueryBuilder.mockClear();

        const filter = createFilter({ value: 'migraine' });
        filter.filterText();

        textQueryBuilder.mock.calls.forEach(call => {
            expect(call[0].text).toBe('migraine');
        });
    });

    test('filterText uses fieldMapper.getFieldName for field paths', () => {
        const mockFieldMapper = { getFieldName: jestObj.fn((f) => `mapped.${f}`) };
        const filter = new FilterByText({
            propertyObj: { fields: ['code'] },
            parsedArg: {
                queryParameterValue: { values: ['test'], operator: '$or', value: 'test' }
            },
            fieldMapper: mockFieldMapper,
            fnUseAccessIndex: () => false,
            resourceType: 'Condition'
        });

        filter.filterText();

        expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('code.text');
        expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('code.coding.display');
    });

    test('filterText handles multiple fields', () => {
        const filter = createFilter({ fields: ['code', 'category'], values: ['headache'], value: 'headache' });
        const result = filter.filterText();

        // The $or should contain entries for both fields
        expect(result[0].$or.length).toBe(2);
    });

    test('filterText handles multiple values', () => {
        const { textQueryBuilder } = require('../../../../../utils/querybuilder.util');
        textQueryBuilder.mockClear();

        const filter = createFilter({ fields: ['code'], values: ['headache', 'migraine'], value: 'headache' });
        const result = filter.filterText();

        // Should produce results for each value
        expect(result).toHaveLength(1);
        expect(result[0].$or).toBeDefined();
    });

    test('filterText uses operator from parsedArg', () => {
        const filter = createFilter({ operator: '$and' });
        const result = filter.filterText();

        // The operator is used as the key in the result object
        const firstOrEntry = result[0].$or[0];
        expect(firstOrEntry.$and).toBeDefined();
    });
});
