'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { FilterByContains } = require('../../../../../operations/query/filters/contains');
const { tokenQueryContainsBuilder } = require('../../../../../utils/querybuilder.util');
const { escapeRegExp } = require('../../../../../utils/regexEscaper');

describe('FilterByContains', () => {
    const makeFieldMapper = () => ({
        getFieldName: jestObj.fn((f) => f)
    });

    const makeFilterParams = (overrides = {}) => ({
        propertyObj: { type: 'string', fieldType: null, fields: ['name'] },
        parsedArg: {
            queryParameterValue: {
                values: ['smith'],
                operator: '$and'
            }
        },
        fieldMapper: makeFieldMapper(),
        fnUseAccessIndex: jestObj.fn(() => false),
        resourceType: 'Patient',
        ...overrides
    });

    describe('filterByItem - string type (default path)', () => {
        test('returns regex filter with case-insensitive search', () => {
            const filter = new FilterByContains(makeFilterParams());
            const result = filter.filterByItem('name', 'smith');
            expect(result).toEqual({
                name: {
                    $regex: escapeRegExp('smith'),
                    $options: 'i'
                }
            });
        });

        test('escapes special regex characters in value', () => {
            const filter = new FilterByContains(makeFilterParams());
            const result = filter.filterByItem('name', 'a.b*c+d');
            expect(result).toEqual({
                name: {
                    $regex: escapeRegExp('a.b*c+d'),
                    $options: 'i'
                }
            });
            // Verify that regex special chars are escaped
            expect(result.name.$regex).toBe('a\\.b\\*c\\+d');
        });

        test('uses fieldMapper to translate field names', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => `mapped.${f}`)
            };
            const filter = new FilterByContains(makeFilterParams({ fieldMapper }));
            const result = filter.filterByItem('name', 'test');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('name', 'test');
            expect(Object.keys(result)).toContain('mapped.name');
        });

        test('handles empty string value', () => {
            const filter = new FilterByContains(makeFilterParams());
            const result = filter.filterByItem('name', '');
            expect(result).toEqual({
                name: {
                    $regex: '',
                    $options: 'i'
                }
            });
        });

        test('works for non-token types other than string', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'reference', fieldType: null, fields: ['subject'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('subject', 'Patient/123');
            expect(result.subject.$regex).toBeDefined();
            expect(result.subject.$options).toBe('i');
        });
    });

    describe('filterByItem - token type with Coding fieldType', () => {
        test('delegates to tokenQueryContainsBuilder with type=code', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Coding', fields: ['code'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('code', 'abc');
            const expected = tokenQueryContainsBuilder({
                target: 'abc',
                type: 'code',
                field: 'code'
            });
            expect(result).toEqual(expected);
        });

        test('handles system|code format for Coding', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Coding', fields: ['code'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('code', 'http://loinc.org|1234');
            const expected = tokenQueryContainsBuilder({
                target: 'http://loinc.org|1234',
                type: 'code',
                field: 'code'
            });
            expect(result).toEqual(expected);
        });

        test('uses fieldMapper for Coding field', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => `resource.${f}`)
            };
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Coding', fields: ['code'] },
                fieldMapper
            });
            const filter = new FilterByContains(params);
            filter.filterByItem('code', 'abc');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('code');
        });
    });

    describe('filterByItem - token type with CodeableConcept fieldType', () => {
        test('delegates to tokenQueryContainsBuilder with .coding suffix', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'CodeableConcept', fields: ['type'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('type', 'abc');
            const expected = tokenQueryContainsBuilder({
                target: 'abc',
                type: 'code',
                field: 'type.coding'
            });
            expect(result).toEqual(expected);
        });

        test('uses fieldMapper with field.coding for CodeableConcept', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => f)
            };
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'CodeableConcept', fields: ['type'] },
                fieldMapper
            });
            const filter = new FilterByContains(params);
            filter.filterByItem('type', 'test');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('type.coding');
        });

        test('handles system|code for CodeableConcept', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'CodeableConcept', fields: ['category'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('category', 'http://example.org|vital');
            expect(Object.keys(result)).toContain('category.coding');
        });
    });

    describe('filterByItem - token type with Identifier fieldType', () => {
        test('delegates to tokenQueryContainsBuilder with type=value', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Identifier', fields: ['identifier'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('identifier', '12345');
            const expected = tokenQueryContainsBuilder({
                target: '12345',
                type: 'value',
                field: 'identifier'
            });
            expect(result).toEqual(expected);
        });

        test('handles system|value for Identifier', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Identifier', fields: ['identifier'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('identifier', 'http://hl7.org|ABC');
            const expected = tokenQueryContainsBuilder({
                target: 'http://hl7.org|ABC',
                type: 'value',
                field: 'identifier'
            });
            expect(result).toEqual(expected);
        });

        test('uses fieldMapper for Identifier field', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => `prefix.${f}`)
            };
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Identifier', fields: ['identifier'] },
                fieldMapper
            });
            const filter = new FilterByContains(params);
            filter.filterByItem('identifier', 'val');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('identifier');
        });
    });

    describe('filterByItem - token type with unknown fieldType', () => {
        test('falls through to string path when fieldType is not Coding/CodeableConcept/Identifier', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'UnknownType', fields: ['code'] }
            });
            const filter = new FilterByContains(params);
            const result = filter.filterByItem('code', 'test');
            // Falls through the switch and reaches the string path
            expect(result).toEqual({
                code: {
                    $regex: escapeRegExp('test'),
                    $options: 'i'
                }
            });
        });
    });

    describe('filter (inherited)', () => {
        test('builds filter with string contains for single field and value', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'string', fieldType: null, fields: ['name'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['john'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByContains(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            expect(result[0].$or).toBeDefined();
        });

        test('returns empty array when values is null', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: null, operator: '$and' } }
            });
            const filter = new FilterByContains(params);
            expect(filter.filter()).toEqual([]);
        });
    });
});
