const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const {
    stringQueryBuilder,
    tokenQueryBuilder,
    addressQueryBuilder,
    nameQueryBuilder,
    numberQueryBuilder,
    quantityQueryBuilder,
    dateQueryBuilder,
    dateQueryBuilderNative,
    datetimePeriodQueryBuilder,
    datetimeTimingQueryBuilder,
    datetimeApproxString,
    textQueryBuilder,
    exactMatchQueryBuilder,
    tokenQueryContainsBuilder,
    tokenIdentifierOfTypeQueryBuilder,
    extensionQueryBuilder
} = require('../../../utils/querybuilder.util');

// Mock FhirTypesManager to avoid loading real FHIR schema
jest.mock('../../../fhir/fhirTypesManager', () => ({
    FhirTypesManager: class {
        getDataForField({ resourceType, field }) {
            // Default: treat as array (max != '1')
            if (field === 'identifier' || field === 'extension') return { max: '*' };
            if (field === 'singleField') return { max: '1' };
            return { max: '*' };
        }
    }
}));

describe('querybuilder.util', () => {
    // ========== stringQueryBuilder ==========
    describe('stringQueryBuilder', () => {
        test('returns regex for normal string target', () => {
            const result = stringQueryBuilder({ target: 'John' });
            expect(result).toHaveProperty('$regex');
            expect(result.$regex).toBeInstanceOf(RegExp);
            expect(result.$regex.test('John')).toBe(true);
            expect(result.$regex.test('johnny')).toBe(true); // starts-with, case insensitive
        });

        test('returns empty object for non-string target', () => {
            expect(stringQueryBuilder({ target: 123 })).toEqual({});
            expect(stringQueryBuilder({ target: null })).toEqual({});
            expect(stringQueryBuilder({ target: undefined })).toEqual({});
        });

        test('escapes special regex characters in target', () => {
            const result = stringQueryBuilder({ target: 'test(value)' });
            expect(result.$regex).toBeInstanceOf(RegExp);
            // Should not throw
            expect(() => new RegExp(result.$regex.source)).not.toThrow();
        });

        test('produces case-insensitive match', () => {
            const result = stringQueryBuilder({ target: 'ABC' });
            expect(result.$regex.flags).toContain('i');
        });
    });

    // ========== addressQueryBuilder ==========
    describe('addressQueryBuilder', () => {
        test('returns empty array for non-string target', () => {
            expect(addressQueryBuilder({ target: 123 })).toEqual([]);
            expect(addressQueryBuilder({ target: null })).toEqual([]);
        });

        test('splits target on spaces and commas (0 items boundary)', () => {
            const result = addressQueryBuilder({ target: '' });
            // empty string split -> [''] which is one token
            expect(result.length).toBe(1);
        });

        test('splits target into one token', () => {
            const result = addressQueryBuilder({ target: 'Chicago' });
            expect(result.length).toBe(1);
            expect(result[0]).toHaveProperty('$or');
            expect(result[0].$or.length).toBe(6); // 6 address fields
        });

        test('splits target into multiple tokens', () => {
            const result = addressQueryBuilder({ target: '123 Main St, Chicago' });
            expect(result.length).toBe(4); // "123", "Main", "St", "Chicago"
        });

        test('useExactSearch produces exact value match instead of regex', () => {
            const result = addressQueryBuilder({ target: 'Boston', useExactSearch: true });
            expect(result[0].$or[0]).toEqual({ 'address.line': 'Boston' });
        });

        test('without useExactSearch produces regex match', () => {
            const result = addressQueryBuilder({ target: 'Boston', useExactSearch: false });
            expect(result[0].$or[0]['address.line']).toHaveProperty('$regex');
        });
    });

    // ========== nameQueryBuilder ==========
    describe('nameQueryBuilder', () => {
        test('returns empty array for non-string target', () => {
            expect(nameQueryBuilder({ target: 42 })).toEqual([]);
        });

        test('splits on spaces, dots, commas', () => {
            const result = nameQueryBuilder({ target: 'John.Doe' });
            expect(result.length).toBe(2);
        });

        test('exact search uses exact values', () => {
            const result = nameQueryBuilder({ target: 'Smith', useExactSearch: true });
            expect(result[0].$or).toEqual(expect.arrayContaining([
                { 'name.family': 'Smith' }
            ]));
        });

        test('non-exact search uses regex', () => {
            const result = nameQueryBuilder({ target: 'Smith', useExactSearch: false });
            expect(result[0].$or[0]['name.text']).toHaveProperty('$regex');
        });
    });

    // ========== tokenQueryBuilder (large method) ==========
    describe('tokenQueryBuilder', () => {
        test('target null returns $exists false', () => {
            const result = tokenQueryBuilder({ target: null, type: 'value', field: 'identifier' });
            expect(result).toEqual({ identifier: { $exists: false } });
        });

        test('exists_flag false returns $exists false', () => {
            const result = tokenQueryBuilder({ target: 'abc', type: 'value', field: 'identifier', exists_flag: false });
            expect(result).toEqual({ identifier: { $exists: false } });
        });

        test('exists_flag true returns $exists true', () => {
            const result = tokenQueryBuilder({ target: 'abc', type: 'value', field: 'identifier', exists_flag: true });
            expect(result).toEqual({ identifier: { $exists: true } });
        });

        test('target without pipe sets value only', () => {
            const result = tokenQueryBuilder({ target: 'abc', type: 'value', field: 'identifier', resourceType: 'Patient' });
            expect(result['identifier.value']).toBe('abc');
        });

        test('target with pipe separates system and value', () => {
            const result = tokenQueryBuilder({ target: 'http://example.com|123', type: 'value', field: 'identifier', resourceType: 'Patient' });
            // For array field, should use $elemMatch
            expect(result.identifier).toHaveProperty('$elemMatch');
            expect(result.identifier.$elemMatch.system).toBe('http://example.com');
            expect(result.identifier.$elemMatch.value).toBe('123');
        });

        test('comma-separated values produce $in', () => {
            const result = tokenQueryBuilder({ target: 'a,b,c', type: 'code', field: 'type.coding', resourceType: 'Patient' });
            expect(result['type.coding.code']).toEqual({ $in: ['a', 'b', 'c'] });
        });

        test('required system overrides parsed system', () => {
            const result = tokenQueryBuilder({ target: 'http://x|val', type: 'value', field: 'identifier', required: 'http://override', resourceType: 'Patient' });
            expect(result.identifier.$elemMatch.system).toBe('http://override');
        });

        test('system+value with field uses $elemMatch for array fields', () => {
            const result = tokenQueryBuilder({ target: 'sys|val', type: 'value', field: 'coding', resourceType: 'Patient' });
            expect(result.coding).toHaveProperty('$elemMatch');
            expect(result.coding.$elemMatch.system).toBe('sys');
            expect(result.coding.$elemMatch.value).toBe('val');
        });
    });

    // ========== tokenQueryContainsBuilder ==========
    describe('tokenQueryContainsBuilder', () => {
        test('target null returns $exists false', () => {
            const result = tokenQueryContainsBuilder({ target: null, type: 'value', field: 'identifier' });
            expect(result).toEqual({ identifier: { $exists: false } });
        });

        test('contains search uses $regex with case-insensitive', () => {
            const result = tokenQueryContainsBuilder({ target: 'abc', type: 'value', field: 'identifier' });
            expect(result['identifier.value']).toHaveProperty('$regex');
            expect(result['identifier.value'].$options).toBe('i');
        });

        test('pipe-separated system+value uses $elemMatch with regex', () => {
            const result = tokenQueryContainsBuilder({ target: 'sys|val', type: 'value', field: 'identifier' });
            expect(result.identifier.$elemMatch.system).toHaveProperty('$regex');
            expect(result.identifier.$elemMatch.value).toHaveProperty('$regex');
        });
    });

    // ========== tokenIdentifierOfTypeQueryBuilder ==========
    describe('tokenIdentifierOfTypeQueryBuilder', () => {
        test('returns empty object if target does not have 3 parts', () => {
            expect(tokenIdentifierOfTypeQueryBuilder({ target: 'a|b', field: 'identifier' })).toEqual({});
            expect(tokenIdentifierOfTypeQueryBuilder({ target: 'a', field: 'identifier' })).toEqual({});
        });

        test('returns $and query with system, code, and value for 3 parts', () => {
            const result = tokenIdentifierOfTypeQueryBuilder({ target: 'sys|code|val', field: 'identifier' });
            expect(result).toHaveProperty('$and');
            expect(result.$and.length).toBe(2);
            expect(result.$and[0].identifier.$elemMatch['type.coding.system']).toBe('sys');
            expect(result.$and[0].identifier.$elemMatch['type.coding.code']).toBe('code');
            expect(result.$and[1]['identifier.value']).toBe('val');
        });
    });

    // ========== exactMatchQueryBuilder ==========
    describe('exactMatchQueryBuilder', () => {
        test('target null returns $exists false', () => {
            const result = exactMatchQueryBuilder({ target: null, field: 'status' });
            expect(result).toEqual({ status: { $exists: false } });
        });

        test('exists_flag true returns $exists true', () => {
            const result = exactMatchQueryBuilder({ target: 'x', field: 'status', exists_flag: true });
            expect(result).toEqual({ status: { $exists: true } });
        });

        test('single value sets exact match', () => {
            const result = exactMatchQueryBuilder({ target: 'active', field: 'status' });
            expect(result).toEqual({ status: 'active' });
        });

        test('comma-separated values produce $in', () => {
            const result = exactMatchQueryBuilder({ target: 'active,inactive', field: 'status' });
            expect(result.status).toEqual({ $in: ['active', 'inactive'] });
        });

        test('boolean target is set directly', () => {
            const result = exactMatchQueryBuilder({ target: true, field: 'active' });
            expect(result).toEqual({ active: true });
        });
    });

    // ========== numberQueryBuilder (large method) ==========
    describe('numberQueryBuilder', () => {
        test('non-string target returns empty string', () => {
            expect(numberQueryBuilder({ target: 123, field: 'value' })).toBe('');
        });

        test('plain number returns range query', () => {
            const result = numberQueryBuilder({ target: '100', field: 'value' });
            expect(result.value).toHaveProperty('$gte');
            expect(result.value).toHaveProperty('$lt');
            expect(result.value.$gte).toBeLessThan(100);
            expect(result.value.$lt).toBeGreaterThan(100);
        });

        test('lt prefix returns $lt', () => {
            const result = numberQueryBuilder({ target: 'lt50', field: 'value' });
            expect(result.value).toEqual({ $lt: 50 });
        });

        test('le prefix returns $lte', () => {
            const result = numberQueryBuilder({ target: 'le50', field: 'value' });
            expect(result.value).toEqual({ $lte: 50 });
        });

        test('gt prefix returns $gt', () => {
            const result = numberQueryBuilder({ target: 'gt50', field: 'value' });
            expect(result.value).toEqual({ $gt: 50 });
        });

        test('ge prefix returns $gte', () => {
            const result = numberQueryBuilder({ target: 'ge50', field: 'value' });
            expect(result.value).toEqual({ $gte: 50 });
        });

        test('ne prefix returns range with $not', () => {
            const result = numberQueryBuilder({ target: 'ne100', field: 'value' });
            expect(result.value).toHaveProperty('$exists', true);
            expect(result.value.$not).toHaveProperty('$gte');
            expect(result.value.$not).toHaveProperty('$lt');
        });

        test('ap prefix returns approximate range', () => {
            const result = numberQueryBuilder({ target: 'ap100', field: 'value' });
            expect(result.value.$gte).toBeLessThan(100);
            expect(result.value.$lt).toBeGreaterThan(100);
            // approximate is 10%
            expect(result.value.$gte).toBeCloseTo(90, 0);
            expect(result.value.$lt).toBeCloseTo(110, 0);
        });

        test('scientific notation number', () => {
            const result = numberQueryBuilder({ target: '1.5e2', field: 'value' });
            expect(result.value).toHaveProperty('$gte');
            expect(result.value).toHaveProperty('$lt');
        });

        test('invalid prefix returns empty object', () => {
            const result = numberQueryBuilder({ target: 'xx50', field: 'value' });
            expect(result).toEqual({});
        });

        test('non-numeric string returns empty object', () => {
            const result = numberQueryBuilder({ target: 'abc', field: 'value' });
            expect(result).toEqual({});
        });
    });

    // ========== quantityQueryBuilder (large method) ==========
    describe('quantityQueryBuilder', () => {
        test('empty or null target returns empty object', () => {
            expect(quantityQueryBuilder({ target: '', field: 'valueQuantity' })).toEqual({});
            expect(quantityQueryBuilder({ target: null, field: 'valueQuantity' })).toEqual({});
        });

        test('number only (no prefix) returns range', () => {
            const result = quantityQueryBuilder({ target: '5.4', field: 'vQ' });
            expect(result['vQ.value']).toHaveProperty('$gte');
            expect(result['vQ.value']).toHaveProperty('$lt');
        });

        test('number with system and code', () => {
            const result = quantityQueryBuilder({ target: '5.4|http://unitsofmeasure.org|mg', field: 'vQ' });
            expect(result['vQ.system']).toBe('http://unitsofmeasure.org');
            expect(result['vQ.code']).toBe('mg');
            expect(result['vQ.value']).toHaveProperty('$gte');
        });

        test('lt prefix', () => {
            const result = quantityQueryBuilder({ target: 'lt10||mg', field: 'vQ' });
            expect(result['vQ.value']).toEqual({ $lt: 10 });
            expect(result['vQ.code']).toBe('mg');
        });

        test('ge prefix', () => {
            const result = quantityQueryBuilder({ target: 'ge20||', field: 'vQ' });
            expect(result['vQ.value']).toEqual({ $gte: 20 });
        });

        test('ne prefix returns $not range', () => {
            const result = quantityQueryBuilder({ target: 'ne100||', field: 'vQ' });
            expect(result['vQ.value']).toHaveProperty('$exists', true);
            expect(result['vQ.value'].$not).toHaveProperty('$gte');
        });
    });

    // ========== dateQueryBuilder (largest method) ==========
    describe('dateQueryBuilder', () => {
        test('non-string date returns null', () => {
            expect(dateQueryBuilder({ date: 123, type: 'date' })).toBeNull();
        });

        test('missing modifier "true"/"false" returns null', () => {
            expect(dateQueryBuilder({ date: 'true', type: 'date' })).toBeNull();
            expect(dateQueryBuilder({ date: 'false', type: 'date' })).toBeNull();
        });

        test('invalid date string throws BadRequestError', () => {
            expect(() => dateQueryBuilder({ date: 'not-a-date', type: 'date' })).toThrow();
        });

        test('year only (eq prefix) returns regex', () => {
            const result = dateQueryBuilder({ date: '2023', type: 'date' });
            expect(result).toHaveProperty('$regex');
        });

        test('year-month returns regex', () => {
            const result = dateQueryBuilder({ date: '2023-06', type: 'date' });
            expect(result).toHaveProperty('$regex');
        });

        test('full date returns regex', () => {
            const result = dateQueryBuilder({ date: '2023-06-15', type: 'dateTime' });
            expect(result).toHaveProperty('$regex');
        });

        test('ge prefix returns $gte with UTC string', () => {
            const result = dateQueryBuilder({ date: 'ge2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$gte');
        });

        test('lt prefix returns $lt', () => {
            const result = dateQueryBuilder({ date: 'lt2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$lt');
        });

        test('le prefix returns $lte', () => {
            const result = dateQueryBuilder({ date: 'le2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$lte');
        });

        test('gt prefix returns $gt', () => {
            const result = dateQueryBuilder({ date: 'gt2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$gt');
        });

        test('sa prefix maps to $gt', () => {
            const result = dateQueryBuilder({ date: 'sa2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$gt');
        });

        test('eb prefix maps to $lt', () => {
            const result = dateQueryBuilder({ date: 'eb2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$lt');
        });

        test('period type with eq prefix returns array', () => {
            const result = dateQueryBuilder({ date: '2023-06-15T10:00', type: 'period', path: 'effectivePeriod' });
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(3);
        });

        test('timing type with eq prefix returns array', () => {
            const result = dateQueryBuilder({ date: '2023-06-15T10:00', type: 'timing', path: 'timing' });
            expect(Array.isArray(result)).toBe(true);
        });

        test('dateTime with timezone offset converts to UTC', () => {
            const result = dateQueryBuilder({ date: '2023-06-15T10:00+05:00', type: 'dateTime' });
            // Should produce regex matching the UTC conversion
            expect(result).toHaveProperty('$regex');
        });
    });

    // ========== dateQueryBuilderNative ==========
    describe('dateQueryBuilderNative', () => {
        test('plain date returns eq (range for day)', () => {
            const result = dateQueryBuilderNative({ dateSearchParameter: '2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$gte');
            expect(result).toHaveProperty('$lte');
        });

        test('gt prefix', () => {
            const result = dateQueryBuilderNative({ dateSearchParameter: 'gt2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$gt');
            expect(result.$gt).toBeInstanceOf(Date);
        });

        test('lt prefix', () => {
            const result = dateQueryBuilderNative({ dateSearchParameter: 'lt2023-01-01', type: 'date' });
            expect(result).toHaveProperty('$lt');
        });

        test('ne prefix', () => {
            const result = dateQueryBuilderNative({ dateSearchParameter: 'ne2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$not');
            expect(result.$not.$gte).toBeInstanceOf(Date);
        });

        test('invalid date throws BadRequestError', () => {
            expect(() => dateQueryBuilderNative({ dateSearchParameter: 'zz2023-99-99', type: 'date' })).toThrow();
        });

        test('ap prefix returns approximate range', () => {
            const result = dateQueryBuilderNative({ dateSearchParameter: 'ap2023-06-15', type: 'date' });
            expect(result).toHaveProperty('$gte');
            expect(result).toHaveProperty('$lte');
        });
    });

    // ========== datetimePeriodQueryBuilder ==========
    describe('datetimePeriodQueryBuilder', () => {
        test('eq prefix produces $or with start/end conditions', () => {
            const result = datetimePeriodQueryBuilder({ dateQueryItem: '2023-06-15', fieldName: 'period' });
            expect(result).toHaveProperty('$or');
            expect(result.$or.length).toBe(3);
        });

        test('le prefix produces $or', () => {
            const result = datetimePeriodQueryBuilder({ dateQueryItem: 'le2023-06-15', fieldName: 'period' });
            expect(result).toHaveProperty('$or');
        });

        test('ge prefix produces $or', () => {
            const result = datetimePeriodQueryBuilder({ dateQueryItem: 'ge2023-06-15', fieldName: 'period' });
            expect(result).toHaveProperty('$or');
        });

        test('ne prefix', () => {
            const result = datetimePeriodQueryBuilder({ dateQueryItem: 'ne2023-06-15', fieldName: 'period' });
            expect(result).toHaveProperty('$or');
        });

        test('sa prefix', () => {
            const result = datetimePeriodQueryBuilder({ dateQueryItem: 'sa2023-06-15', fieldName: 'period' });
            expect(result['period.start']).toBeDefined();
        });

        test('eb prefix', () => {
            const result = datetimePeriodQueryBuilder({ dateQueryItem: 'eb2023-06-15', fieldName: 'period' });
            expect(result['period.end']).toBeDefined();
        });

        test('invalid prefix throws', () => {
            expect(() => datetimePeriodQueryBuilder({ dateQueryItem: 'xx2023-06-15', fieldName: 'period' })).toThrow();
        });
    });

    // ========== datetimeTimingQueryBuilder ==========
    describe('datetimeTimingQueryBuilder', () => {
        test('eq prefix queries timing.event', () => {
            const result = datetimeTimingQueryBuilder({ dateQueryItem: '2023-06-15', fieldName: 'timing' });
            expect(result['timing.event']).toBeDefined();
        });

        test('ge prefix', () => {
            const result = datetimeTimingQueryBuilder({ dateQueryItem: 'ge2023-06-15', fieldName: 'timing' });
            expect(result['timing.event']).toEqual({ $ne: null });
        });

        test('sa prefix', () => {
            const result = datetimeTimingQueryBuilder({ dateQueryItem: 'sa2023-06-15', fieldName: 'timing' });
            expect(result['timing.event'].$gte).toBeDefined();
        });

        test('invalid prefix throws', () => {
            expect(() => datetimeTimingQueryBuilder({ dateQueryItem: 'xx2023-06-15', fieldName: 'timing' })).toThrow();
        });
    });

    // ========== datetimeApproxString ==========
    describe('datetimeApproxString', () => {
        test('non-string returns empty strings', () => {
            const result = datetimeApproxString({ dateQueryItem: 123 });
            expect(result).toEqual({ startDate: '', endDate: '' });
        });

        test('valid date returns start and end strings', () => {
            const result = datetimeApproxString({ dateQueryItem: '2023-06-15' });
            expect(result).toHaveProperty('start');
            expect(result).toHaveProperty('end');
            expect(typeof result.start).toBe('string');
            expect(typeof result.end).toBe('string');
        });
    });

    // ========== textQueryBuilder ==========
    describe('textQueryBuilder', () => {
        test('simple text produces regex', () => {
            const result = textQueryBuilder({ field: 'code.text', text: 'diabetes', ignoreCase: false });
            expect(result['code.text']).toHaveProperty('$regex');
        });

        test('ignoreCase adds $options i', () => {
            const result = textQueryBuilder({ field: 'code.text', text: 'diabetes', ignoreCase: true });
            expect(result['code.text'].$options).toBe('i');
        });

        test('comma-separated text creates alternation regex', () => {
            const result = textQueryBuilder({ field: 'code.text', text: 'a,b,c', ignoreCase: false });
            const regex = result['code.text'].$regex;
            expect(regex.test('a')).toBe(true);
            expect(regex.test('b')).toBe(true);
            expect(regex.test('c')).toBe(true);
        });
    });

    // ========== extensionQueryBuilder ==========
    describe('extensionQueryBuilder', () => {
        test('target null returns $exists false', () => {
            const result = extensionQueryBuilder({ target: null, type: 'value', field: 'extension' });
            expect(result).toEqual({ extension: { $exists: false } });
        });

        test('url|value uses $elemMatch for array fields', () => {
            const result = extensionQueryBuilder({ target: 'http://ext|val', type: 'valueString', field: 'extension', resourceType: 'Patient' });
            expect(result.extension.$elemMatch.url).toBe('http://ext');
            expect(result.extension.$elemMatch.valueString).toBe('val');
        });

        test('required overrides url', () => {
            const result = extensionQueryBuilder({ target: 'http://x|val', type: 'valueString', field: 'extension', required: 'http://override', resourceType: 'Patient' });
            expect(result.extension.$elemMatch.url).toBe('http://override');
        });
    });
});
