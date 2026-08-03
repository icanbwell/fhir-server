'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../utils/querybuilder.util', () => ({
    nameQueryBuilder: jestObj.fn(({ target, useExactSearch }) => [
        { 'name.family': useExactSearch ? target : new RegExp(target, 'i') },
        { 'name.given': useExactSearch ? target : new RegExp(target, 'i') }
    ]),
    addressQueryBuilder: jestObj.fn(({ target, useExactSearch }) => [
        { 'address.line': useExactSearch ? target : new RegExp(target, 'i') },
        { 'address.city': useExactSearch ? target : new RegExp(target, 'i') }
    ]),
    stringQueryBuilder: jestObj.fn(({ target }) => new RegExp(`^${target}`, 'i'))
}));

const { FilterByString } = require('../../../../../operations/query/filters/string');

describe('FilterByString', () => {
    const createFilter = (fieldType, modifiers = []) => {
        return new FilterByString({
            propertyObj: { fields: ['name'], fieldType },
            parsedArg: {
                queryParameterValue: { values: ['Smith'], operator: '$or' },
                modifiers
            },
            fieldMapper: { getFieldName: (f) => f },
            fnUseAccessIndex: () => false,
            resourceType: 'Patient'
        });
    };

    test('uses stringQueryBuilder for regular string fields', () => {
        const filter = createFilter(null);
        const result = filter.filterByItem('name', 'Smith');
        expect(result.name).toBeInstanceOf(RegExp);
    });

    test('exact modifier returns exact match', () => {
        const filter = createFilter(null, ['exact']);
        const result = filter.filterByItem('name', 'Smith');
        expect(result.name).toBe('Smith');
    });

    test('HumanName field uses nameQueryBuilder with $or', () => {
        const filter = createFilter('HumanName');
        const result = filter.filterByItem('name', 'Smith');
        expect(result.$or).toBeDefined();
        expect(result.$or).toHaveLength(2);
    });

    test('Address field uses addressQueryBuilder with $or', () => {
        const filter = createFilter('Address');
        const result = filter.filterByItem('address', 'Main St');
        expect(result.$or).toBeDefined();
    });

    test('fieldType matching is case-insensitive', () => {
        const filter = createFilter('HUMANNAME');
        const result = filter.filterByItem('name', 'Smith');
        expect(result.$or).toBeDefined();
    });

    test('uses fieldMapper for regular string fields', () => {
        const filter = new FilterByString({
            propertyObj: { fields: ['name'] },
            parsedArg: {
                queryParameterValue: { values: ['test'], operator: '$or' },
                modifiers: []
            },
            fieldMapper: { getFieldName: (f) => `mapped.${f}` },
            fnUseAccessIndex: () => false,
            resourceType: 'Patient'
        });
        const result = filter.filterByItem('family', 'Jones');
        expect(Object.keys(result)[0]).toBe('mapped.family');
    });
});
