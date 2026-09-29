'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { BaseFilter } = require('../../../../../operations/query/filters/baseFilter');

describe('BaseFilter', () => {
    const makeFieldMapper = () => ({
        getFieldName: jestObj.fn((field) => field === 'id' ? '_sourceId' : field)
    });

    const makeFilterParams = (overrides = {}) => ({
        propertyObj: { fields: ['name'] },
        parsedArg: {
            queryParameterValue: {
                values: ['Smith'],
                operator: '$and'
            }
        },
        fieldMapper: makeFieldMapper(),
        fnUseAccessIndex: jestObj.fn(() => false),
        resourceType: 'Patient',
        ...overrides
    });

    describe('constructor', () => {
        test('assigns all filter parameters', () => {
            const params = makeFilterParams();
            const filter = new BaseFilter(params);
            expect(filter.propertyObj).toBe(params.propertyObj);
            expect(filter.parsedArg).toBe(params.parsedArg);
            expect(filter.fieldMapper).toBe(params.fieldMapper);
            expect(filter.fnUseAccessIndex).toBe(params.fnUseAccessIndex);
            expect(filter.resourceType).toBe('Patient');
        });

        test('throws when propertyObj is null', () => {
            expect(() => new BaseFilter(makeFilterParams({ propertyObj: null })))
                .toThrow('filterParameters.propertyObj is null');
        });

        test('throws when parsedArg is null', () => {
            expect(() => new BaseFilter(makeFilterParams({ parsedArg: null })))
                .toThrow('filterParameters.parsedArg is null');
        });

        test('throws when fieldMapper is null', () => {
            expect(() => new BaseFilter(makeFilterParams({ fieldMapper: null })))
                .toThrow('filterParameters.fieldMapper is null');
        });

        test('throws when resourceType is null', () => {
            expect(() => new BaseFilter(makeFilterParams({ resourceType: null })))
                .toThrow('filterParameters.resourceType is null');
        });

        test('does NOT throw when fnUseAccessIndex is null (optional)', () => {
            expect(() => new BaseFilter(makeFilterParams({ fnUseAccessIndex: null })))
                .not.toThrow();
        });
    });

    describe('filterByItem', () => {
        test('returns field:value mapping using fieldMapper', () => {
            const filter = new BaseFilter(makeFilterParams());
            const result = filter.filterByItem('name', 'Smith');
            expect(result).toEqual({ name: 'Smith' });
        });

        test('uses fieldMapper to translate field names', () => {
            const filter = new BaseFilter(makeFilterParams());
            const result = filter.filterByItem('id', '12345');
            expect(result).toEqual({ _sourceId: '12345' });
            expect(filter.fieldMapper.getFieldName).toHaveBeenCalledWith('id');
        });

        test('handles complex values', () => {
            const filter = new BaseFilter(makeFilterParams());
            const result = filter.filterByItem('status', 'active');
            expect(result).toEqual({ status: 'active' });
        });
    });

    describe('filter', () => {
        test('returns empty array when values is null', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: null, operator: '$and' } }
            });
            const filter = new BaseFilter(params);
            expect(filter.filter()).toEqual([]);
        });

        test('returns $or segment wrapping field filters', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['name'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['Smith'],
                        operator: '$and'
                    }
                }
            });
            const filter = new BaseFilter(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            expect(result[0].$or).toBeDefined();
        });

        test('uses the parsedArg operator as the key for values', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['status'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['active', 'inactive'],
                        operator: '$or'
                    }
                }
            });
            const filter = new BaseFilter(params);
            const result = filter.filter();
            expect(result[0].$or[0].$or).toBeDefined();
        });

        test('maps over multiple fields', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['name', 'family'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['Smith'],
                        operator: '$and'
                    }
                }
            });
            const filter = new BaseFilter(params);
            const result = filter.filter();
            expect(result[0].$or).toHaveLength(2);
        });

        test('maps over multiple values within a field', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['status'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['active', 'inactive', 'entered-in-error'],
                        operator: '$or'
                    }
                }
            });
            const filter = new BaseFilter(params);
            const result = filter.filter();
            expect(result[0].$or[0].$or).toHaveLength(3);
        });

        test('returns empty array when values is undefined', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: undefined, operator: '$and' } }
            });
            const filter = new BaseFilter(params);
            expect(filter.filter()).toEqual([]);
        });

        test('returns empty array when values is empty array', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: [], operator: '$and' } }
            });
            const filter = new BaseFilter(params);
            const result = filter.filter();
            expect(result[0].$or[0].$and).toEqual([]);
        });
    });
});
