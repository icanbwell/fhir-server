const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../utils/querybuilder.util', () => ({
    dateQueryBuilder: jestObj.fn(),
    dateQueryBuilderNative: jestObj.fn(),
    datetimePeriodQueryBuilder: jestObj.fn(),
    datetimeTimingQueryBuilder: jestObj.fn(),
    datetimeApproxString: jestObj.fn()
}));

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn(),
    assertTypeEquals: jestObj.fn()
}));

const { FilterByDateTime } = require('../../../../../operations/query/filters/dateTime');
const {
    dateQueryBuilder,
    dateQueryBuilderNative,
    datetimePeriodQueryBuilder,
    datetimeTimingQueryBuilder,
    datetimeApproxString
} = require('../../../../../utils/querybuilder.util');

describe('FilterByDateTime', () => {
    let filter;
    let mockFieldMapper;
    let mockPropertyObj;
    let mockParsedArg;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockFieldMapper = {
            getFieldName: jestObj.fn((field) => field)
        };

        mockPropertyObj = {
            type: 'date',
            fields: ['effectiveDateTime'],
            fieldTypesObj: {
                effectiveDateTime: 'datetime'
            }
        };

        mockParsedArg = {
            queryParameterValue: {
                values: ['2023-01-01'],
                operator: '$and'
            }
        };

        filter = new FilterByDateTime({
            propertyObj: mockPropertyObj,
            parsedArg: mockParsedArg,
            fieldMapper: mockFieldMapper,
            fnUseAccessIndex: jestObj.fn(() => false),
            resourceType: 'Observation'
        });
    });

    describe('filterByItem', () => {
        test('returns null when value is true (boolean string)', () => {
            const result = filter.filterByItem('effectiveDateTime', 'true', 'datetime');
            expect(result).toBeNull();
        });

        test('returns null when value is false (boolean string)', () => {
            const result = filter.filterByItem('effectiveDateTime', 'false', 'datetime');
            expect(result).toBeNull();
        });

        test('returns null when value is "1" (truthy)', () => {
            const result = filter.filterByItem('effectiveDateTime', '1', 'datetime');
            expect(result).toBeNull();
        });

        test('returns null when value is "0" (falsy)', () => {
            const result = filter.filterByItem('effectiveDateTime', '0', 'datetime');
            expect(result).toBeNull();
        });

        test('handles period fieldType by calling datetimePeriodQueryBuilder', () => {
            const expectedQuery = { 'period.start': { $lte: '2023-01-01' } };
            datetimePeriodQueryBuilder.mockReturnValue(expectedQuery);

            const result = filter.filterByItem('period', 'ge2023-01-01', 'period');

            expect(datetimePeriodQueryBuilder).toHaveBeenCalledWith({
                dateQueryItem: 'ge2023-01-01',
                fieldName: 'period'
            });
            expect(result).toEqual(expectedQuery);
        });

        test('handles timing fieldType by calling datetimeTimingQueryBuilder', () => {
            const expectedQuery = { 'timing.event': { $gte: '2023-01-01' } };
            datetimeTimingQueryBuilder.mockReturnValue(expectedQuery);

            const result = filter.filterByItem('timing', 'ge2023-01-01', 'timing');

            expect(datetimeTimingQueryBuilder).toHaveBeenCalledWith({
                dateQueryItem: 'ge2023-01-01',
                fieldName: 'timing'
            });
            expect(result).toEqual(expectedQuery);
        });

        test('handles datetime fieldType with regular date value', () => {
            const expectedDateQuery = { $gte: '2023-01-01', $lt: '2023-01-02' };
            dateQueryBuilder.mockReturnValue(expectedDateQuery);

            const result = filter.filterByItem('effectiveDateTime', 'ge2023-01-01', 'datetime');

            expect(dateQueryBuilder).toHaveBeenCalledWith({
                date: 'ge2023-01-01',
                type: 'date'
            });
            expect(result).toEqual({ effectiveDateTime: expectedDateQuery });
        });

        test('handles date fieldType with regular date value', () => {
            const expectedDateQuery = { $eq: '2023-06-15' };
            dateQueryBuilder.mockReturnValue(expectedDateQuery);

            const result = filter.filterByItem('birthDate', 'eq2023-06-15', 'date');

            expect(dateQueryBuilder).toHaveBeenCalledWith({
                date: 'eq2023-06-15',
                type: 'date'
            });
            expect(result).toEqual({ birthDate: expectedDateQuery });
        });

        test('handles datetime fieldType with approximate (ap) prefix', () => {
            datetimeApproxString.mockReturnValue({
                start: '2022-12-31',
                end: '2023-01-02'
            });

            const result = filter.filterByItem('effectiveDateTime', 'ap2023-01-01', 'datetime');

            expect(datetimeApproxString).toHaveBeenCalledWith({
                dateQueryItem: '2023-01-01'
            });
            expect(result).toEqual({
                effectiveDateTime: { $gte: '2022-12-31', $lte: '2023-01-02' }
            });
        });

        test('handles date fieldType with approximate (ap) prefix', () => {
            datetimeApproxString.mockReturnValue({
                start: '2022-12-25',
                end: '2023-01-07'
            });

            const result = filter.filterByItem('birthDate', 'ap2023-01-01', 'date');

            expect(datetimeApproxString).toHaveBeenCalledWith({
                dateQueryItem: '2023-01-01'
            });
            expect(result).toEqual({
                birthDate: { $gte: '2022-12-25', $lte: '2023-01-07' }
            });
        });

        test('handles instant fieldType by calling dateQueryBuilderNative', () => {
            const expectedNativeQuery = { $gte: new Date('2023-01-01T00:00:00Z') };
            dateQueryBuilderNative.mockReturnValue(expectedNativeQuery);

            const result = filter.filterByItem('meta.lastUpdated', 'ge2023-01-01', 'instant');

            expect(dateQueryBuilderNative).toHaveBeenCalledWith({
                dateSearchParameter: 'ge2023-01-01',
                type: 'date'
            });
            expect(result).toEqual({ 'meta.lastUpdated': expectedNativeQuery });
        });

        test('returns null for unknown fieldType', () => {
            const result = filter.filterByItem('someField', '2023-01-01', 'unknown');
            expect(result).toBeNull();
        });

        test('returns null when fieldType is null', () => {
            const result = filter.filterByItem('someField', '2023-01-01', null);
            expect(result).toBeNull();
        });

        test('uses fieldMapper.getFieldName to translate field names', () => {
            mockFieldMapper.getFieldName.mockReturnValue('mapped.field.name');
            dateQueryBuilder.mockReturnValue({ $gte: '2023-01-01' });

            const result = filter.filterByItem('originalField', 'ge2023-01-01', 'datetime');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('originalField');
            expect(result).toEqual({ 'mapped.field.name': { $gte: '2023-01-01' } });
        });
    });

    describe('filter', () => {
        test('returns array with $or clause containing results from filterByField', () => {
            dateQueryBuilder.mockReturnValue({ $gte: '2023-01-01' });

            const result = filter.filter();

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveProperty('$or');
        });

        test('filters out undefined entries from $or array', () => {
            // Set up multiple fields, one returning null (e.g., value is "true")
            mockPropertyObj.fields = ['field1', 'field2'];
            mockPropertyObj.fieldTypesObj = {
                field1: 'datetime',
                field2: 'datetime'
            };
            mockParsedArg.queryParameterValue.values = ['true'];

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            const result = filter.filter();

            // After filtering, $or should have no undefined entries
            expect(result[0]['$or'].every(item => item !== undefined)).toBe(true);
        });

        test('calls filterByField for each field in propertyObj.fields', () => {
            mockPropertyObj.fields = ['field1', 'field2'];
            mockPropertyObj.fieldTypesObj = {
                field1: 'datetime',
                field2: 'date'
            };
            dateQueryBuilder.mockReturnValue({ $gte: '2023-01-01' });

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            const result = filter.filter();

            expect(result[0]['$or']).toBeDefined();
        });
    });

    describe('filterByField', () => {
        test('uses fieldTypesObj to determine field type', () => {
            dateQueryBuilder.mockReturnValue({ $gte: '2023-01-01' });

            const queryParameterValue = {
                values: ['ge2023-01-01'],
                operator: '$and'
            };

            const result = filter.filterByField('effectiveDateTime', queryParameterValue);

            expect(result).toHaveProperty('$and');
        });

        test('returns null fieldType when fieldTypesObj is not set', () => {
            mockPropertyObj.fieldTypesObj = null;
            dateQueryBuilder.mockReturnValue({ $gte: '2023-01-01' });

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            // With null fieldType, filterByItem returns null
            const queryParameterValue = {
                values: ['ge2023-01-01'],
                operator: '$and'
            };

            const result = filter.filterByField('effectiveDateTime', queryParameterValue);

            expect(result['$and']).toEqual([null]);
        });

        test('simplifies instant range queries by combining $gt/$gte and $lt/$lte', () => {
            mockPropertyObj.fieldTypesObj = {
                'meta.lastUpdated': 'instant'
            };

            dateQueryBuilderNative.mockReturnValueOnce({ $gte: new Date('2023-01-01') });
            dateQueryBuilderNative.mockReturnValueOnce({ $lte: new Date('2023-12-31') });

            const queryParameterValue = {
                values: ['ge2023-01-01', 'le2023-12-31'],
                operator: '$and'
            };

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            const result = filter.filterByField('meta.lastUpdated', queryParameterValue);

            // Should combine into a single simplified range query
            const andClause = result['$and'];
            expect(andClause).toHaveLength(1);
            expect(andClause[0]['meta.lastUpdated']).toHaveProperty('$gte');
            expect(andClause[0]['meta.lastUpdated']).toHaveProperty('$lte');
        });

        test('prefers $lte over $lt when both present in instant queries', () => {
            mockPropertyObj.fieldTypesObj = {
                'meta.lastUpdated': 'instant'
            };

            dateQueryBuilderNative.mockReturnValueOnce({ $lt: new Date('2023-12-31') });
            dateQueryBuilderNative.mockReturnValueOnce({ $lte: new Date('2023-12-31') });

            const queryParameterValue = {
                values: ['lt2023-12-31', 'le2023-12-31'],
                operator: '$and'
            };

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            const result = filter.filterByField('meta.lastUpdated', queryParameterValue);

            const andClause = result['$and'];
            expect(andClause).toHaveLength(1);
            const rangeQuery = andClause[0]['meta.lastUpdated'];
            expect(rangeQuery).toHaveProperty('$lte');
            expect(rangeQuery).not.toHaveProperty('$lt');
        });

        test('prefers $gte over $gt when both present in instant queries', () => {
            mockPropertyObj.fieldTypesObj = {
                'meta.lastUpdated': 'instant'
            };

            dateQueryBuilderNative.mockReturnValueOnce({ $gt: new Date('2023-01-01') });
            dateQueryBuilderNative.mockReturnValueOnce({ $gte: new Date('2023-01-01') });

            const queryParameterValue = {
                values: ['gt2023-01-01', 'ge2023-01-01'],
                operator: '$and'
            };

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            const result = filter.filterByField('meta.lastUpdated', queryParameterValue);

            const andClause = result['$and'];
            expect(andClause).toHaveLength(1);
            const rangeQuery = andClause[0]['meta.lastUpdated'];
            expect(rangeQuery).toHaveProperty('$gte');
            expect(rangeQuery).not.toHaveProperty('$gt');
        });

        test('keeps non-simplifiable instant queries as separate entries', () => {
            mockPropertyObj.fieldTypesObj = {
                'meta.lastUpdated': 'instant'
            };

            // A query with multiple keys (e.g., $gte and $lt in same object) is not simplifiable
            dateQueryBuilderNative.mockReturnValueOnce({ $gte: new Date('2023-01-01'), $lt: new Date('2023-02-01') });

            const queryParameterValue = {
                values: ['eq2023-01-01'],
                operator: '$and'
            };

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            const result = filter.filterByField('meta.lastUpdated', queryParameterValue);

            const andClause = result['$and'];
            expect(andClause).toHaveLength(1);
            // The non-simplifiable query should be kept as-is
            expect(andClause[0]['meta.lastUpdated']).toHaveProperty('$gte');
            expect(andClause[0]['meta.lastUpdated']).toHaveProperty('$lt');
        });

        test('CODE BUG: crashes on null childQuery for instant field (does not guard against null)', () => {
            mockPropertyObj.fieldTypesObj = {
                'meta.lastUpdated': 'instant'
            };

            // When filterByItem returns null (e.g., value is "true"), the code
            // tries to access null['meta.lastUpdated'] which throws TypeError.
            // CORRECT behavior would be to guard against null entries.
            const queryParameterValue = {
                values: ['true'],
                operator: '$and'
            };

            filter = new FilterByDateTime({
                propertyObj: mockPropertyObj,
                parsedArg: mockParsedArg,
                fieldMapper: mockFieldMapper,
                fnUseAccessIndex: jestObj.fn(() => false),
                resourceType: 'Observation'
            });

            expect(() => {
                filter.filterByField('meta.lastUpdated', queryParameterValue);
            }).toThrow(TypeError);
        });

        test('handles multiple values for non-instant fields', () => {
            dateQueryBuilder.mockReturnValueOnce({ $gte: '2023-01-01' });
            dateQueryBuilder.mockReturnValueOnce({ $lte: '2023-12-31' });

            const queryParameterValue = {
                values: ['ge2023-01-01', 'le2023-12-31'],
                operator: '$and'
            };

            const result = filter.filterByField('effectiveDateTime', queryParameterValue);

            expect(result['$and']).toHaveLength(2);
            expect(result['$and'][0]).toEqual({ effectiveDateTime: { $gte: '2023-01-01' } });
            expect(result['$and'][1]).toEqual({ effectiveDateTime: { $lte: '2023-12-31' } });
        });
    });
});
