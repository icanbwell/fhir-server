'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { FilterByMissing } = require('../../../../../operations/query/filters/missing');

describe('FilterByMissing', () => {
    const makeFieldMapper = () => ({
        getFieldName: jestObj.fn((f) => f)
    });

    const makeFilterParams = (overrides = {}) => ({
        propertyObj: { fields: ['name'] },
        parsedArg: {
            queryParameterValue: {
                values: ['true'],
                operator: '$and'
            }
        },
        fieldMapper: makeFieldMapper(),
        fnUseAccessIndex: jestObj.fn(() => false),
        resourceType: 'Patient',
        ...overrides
    });

    describe('filterByItem', () => {
        test('returns $exists: false when value is "true"', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', 'true');
            expect(result).toEqual({ name: { $exists: false } });
        });

        test('returns $exists: true when value is "false"', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', 'false');
            expect(result).toEqual({ name: { $exists: true } });
        });

        test('returns $exists: false when value is "True" (case insensitive via isTrue)', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', 'True');
            expect(result).toEqual({ name: { $exists: false } });
        });

        test('returns $exists: false when value is "TRUE"', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', 'TRUE');
            expect(result).toEqual({ name: { $exists: false } });
        });

        test('returns $exists: false when value is "1"', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', '1');
            expect(result).toEqual({ name: { $exists: false } });
        });

        test('returns $exists: true when value is "0"', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', '0');
            expect(result).toEqual({ name: { $exists: true } });
        });

        test('returns $exists: true for arbitrary non-true string', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', 'anything');
            expect(result).toEqual({ name: { $exists: true } });
        });

        test('returns $exists: true for empty string', () => {
            const filter = new FilterByMissing(makeFilterParams());
            const result = filter.filterByItem('name', '');
            expect(result).toEqual({ name: { $exists: true } });
        });

        test('uses fieldMapper to translate field names', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => `mapped.${f}`)
            };
            const filter = new FilterByMissing(makeFilterParams({ fieldMapper }));
            const result = filter.filterByItem('status', 'true');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('status');
            expect(result).toEqual({ 'mapped.status': { $exists: false } });
        });

        test('uses fieldMapper for "false" (not missing) case too', () => {
            const fieldMapper = {
                getFieldName: jestObj.fn((f) => `prefix.${f}`)
            };
            const filter = new FilterByMissing(makeFilterParams({ fieldMapper }));
            const result = filter.filterByItem('status', 'false');
            expect(fieldMapper.getFieldName).toHaveBeenCalledWith('status');
            expect(result).toEqual({ 'prefix.status': { $exists: true } });
        });
    });

    describe('filter (inherited)', () => {
        test('builds $or with missing=true', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['name'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['true'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByMissing(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            expect(result[0].$or).toBeDefined();
            expect(result[0].$or[0].$and).toEqual([{ name: { $exists: false } }]);
        });

        test('builds $or with missing=false', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['name'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['false'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByMissing(params);
            const result = filter.filter();
            expect(result[0].$or[0].$and).toEqual([{ name: { $exists: true } }]);
        });

        test('handles multiple fields', () => {
            const params = makeFilterParams({
                propertyObj: { fields: ['name', 'address'] },
                parsedArg: {
                    queryParameterValue: {
                        values: ['true'],
                        operator: '$and'
                    }
                }
            });
            const filter = new FilterByMissing(params);
            const result = filter.filter();
            expect(result[0].$or).toHaveLength(2);
        });

        test('returns empty array when values is null', () => {
            const params = makeFilterParams({
                parsedArg: { queryParameterValue: { values: null, operator: '$and' } }
            });
            const filter = new FilterByMissing(params);
            expect(filter.filter()).toEqual([]);
        });
    });
});
