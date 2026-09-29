'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { FilterByOfType } = require('../../../../../operations/query/filters/ofType');
const { tokenIdentifierOfTypeQueryBuilder } = require('../../../../../utils/querybuilder.util');

describe('FilterByOfType', () => {
    const makeFieldMapper = () => ({
        getFieldName: jestObj.fn((f) => f)
    });

    const makeFilterParams = (overrides = {}) => ({
        propertyObj: { type: 'token', fieldType: 'Identifier', fields: ['identifier'] },
        parsedArg: {
            queryParameterValue: {
                values: ['http://terminology.hl7.org/CodeSystem/v2-0203|MR|12345'],
                operator: '$and'
            }
        },
        fieldMapper: makeFieldMapper(),
        fnUseAccessIndex: jestObj.fn(() => false),
        resourceType: 'Patient',
        ...overrides
    });

    describe('filterByItem - token type with Identifier fieldType', () => {
        test('delegates to tokenIdentifierOfTypeQueryBuilder for valid 3-part target', () => {
            const filter = new FilterByOfType(makeFilterParams());
            const result = filter.filterByItem('identifier', 'http://sys|MR|12345');
            const expected = tokenIdentifierOfTypeQueryBuilder({
                target: 'http://sys|MR|12345',
                field: 'identifier'
            });
            expect(result).toEqual(expected);
        });

        test('returns $and with $elemMatch for type.coding and value', () => {
            const filter = new FilterByOfType(makeFilterParams());
            const result = filter.filterByItem('identifier', 'http://terminology.hl7.org/CodeSystem/v2-0203|MR|12345');
            expect(result).toHaveProperty('$and');
            expect(result.$and).toHaveLength(2);
            expect(result.$and[0]).toHaveProperty('identifier');
            expect(result.$and[0].identifier.$elemMatch).toEqual({
                'type.coding.system': 'http://terminology.hl7.org/CodeSystem/v2-0203',
                'type.coding.code': 'MR'
            });
            expect(result.$and[1]).toEqual({ 'identifier.value': '12345' });
        });

        test('uses fieldMapper to translate the field name', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => `resource.${f}`)
            };
            const params = makeFilterParams({ fieldMapper });
            const filter = new FilterByOfType(params);
            filter.filterByItem('identifier', 'http://sys|CODE|val');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('identifier');
        });

        test('returns empty object when target has fewer than 3 pipe-separated parts', () => {
            const filter = new FilterByOfType(makeFilterParams());
            const result = filter.filterByItem('identifier', 'http://sys|12345');
            expect(result).toEqual({});
        });

        test('returns empty object when target has only 1 part (no pipes)', () => {
            const filter = new FilterByOfType(makeFilterParams());
            const result = filter.filterByItem('identifier', '12345');
            expect(result).toEqual({});
        });

        test('returns empty object when target has more parts but empty segments are filtered', () => {
            const filter = new FilterByOfType(makeFilterParams());
            // "||" produces ['', '', ''] which after filter(t => t !== '') = []
            const result = filter.filterByItem('identifier', '||');
            expect(result).toEqual({});
        });

        test('returns empty object when only system is provided with pipes', () => {
            const filter = new FilterByOfType(makeFilterParams());
            // "http://sys||" produces ['http://sys', '', ''] => filter => ['http://sys'] (length 1)
            const result = filter.filterByItem('identifier', 'http://sys||');
            expect(result).toEqual({});
        });

        test('handles target with exactly 3 non-empty parts', () => {
            const filter = new FilterByOfType(makeFilterParams());
            const result = filter.filterByItem('identifier', 'sys|code|value');
            expect(result.$and[0].identifier.$elemMatch['type.coding.system']).toBe('sys');
            expect(result.$and[0].identifier.$elemMatch['type.coding.code']).toBe('code');
            expect(result.$and[1]['identifier.value']).toBe('value');
        });
    });

    describe('filterByItem - non-Identifier or non-token type', () => {
        test('returns empty object when type is not token', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'string', fieldType: 'Identifier', fields: ['identifier'] }
            });
            const filter = new FilterByOfType(params);
            const result = filter.filterByItem('identifier', 'sys|code|val');
            expect(result).toEqual({});
        });

        test('returns empty object when fieldType is not Identifier', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Coding', fields: ['code'] }
            });
            const filter = new FilterByOfType(params);
            const result = filter.filterByItem('code', 'sys|code|val');
            expect(result).toEqual({});
        });

        test('returns empty object when fieldType is CodeableConcept', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'CodeableConcept', fields: ['type'] }
            });
            const filter = new FilterByOfType(params);
            const result = filter.filterByItem('type', 'sys|code|val');
            expect(result).toEqual({});
        });

        test('returns empty object when type is null', () => {
            const params = makeFilterParams({
                propertyObj: { type: null, fieldType: 'Identifier', fields: ['identifier'] }
            });
            const filter = new FilterByOfType(params);
            const result = filter.filterByItem('identifier', 'sys|code|val');
            expect(result).toEqual({});
        });
    });

    describe('filter (inherited)', () => {
        test('builds filter for valid of-type query', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Identifier', fields: ['identifier'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['http://sys|MR|12345'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByOfType(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            expect(result[0].$or).toBeDefined();
        });

        test('returns empty array when values is null', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: null, operator: '$and' } }
            });
            const filter = new FilterByOfType(params);
            expect(filter.filter()).toEqual([]);
        });

        test('handles multiple fields', () => {
            const params = makeFilterParams({
                propertyObj: { type: 'token', fieldType: 'Identifier', fields: ['identifier', 'other'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['sys|code|val'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByOfType(params);
            const result = filter.filter();
            expect(result[0].$or).toHaveLength(2);
        });
    });
});
