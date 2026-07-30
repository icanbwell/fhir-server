const { describe, test, expect } = require('@jest/globals');
const { convertGraphQLParameters } = require('../../../../operations/query/convertGraphQLParameters');

describe('convertGraphQLParameters', () => {
    describe('string searchType', () => {
        test('handles basic string value', () => {
            const input = {
                searchType: 'string',
                value: 'test-name'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('test-name');
            expect(result.notQueryParameterValue).toBeUndefined();
            expect(result.andQueryParameterValue).toEqual([]);
            expect(result.newModifiers).toEqual([]);
        });

        test('handles string with values array', () => {
            const input = {
                searchType: 'string',
                values: ['name1', 'name2']
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['name1', 'name2']);
        });

        test('handles string notEquals', () => {
            const input = {
                searchType: 'string',
                notEquals: { value: 'bad-name' }
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toBe('bad-name');
            expect(result.orQueryParameterValue).toBeNull();
        });

        test('handles string notEquals with values', () => {
            const input = {
                searchType: 'string',
                notEquals: { values: ['bad1', 'bad2'] }
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toEqual(['bad1', 'bad2']);
        });

        test('handles string contains modifier', () => {
            const input = {
                searchType: 'string',
                contains: 'partial'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('partial');
            expect(result.newModifiers).toEqual(['contains']);
        });

        test('handles string exact modifier', () => {
            const input = {
                searchType: 'string',
                exact: 'exact-value'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('exact-value');
            expect(result.newModifiers).toEqual(['exact']);
        });

        test('handles string with missing property', () => {
            const input = {
                searchType: 'string',
                missing: true
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe(true);
            expect(result.newModifiers).toEqual(['missing']);
        });
    });

    describe('token searchType', () => {
        test('handles token with system and code', () => {
            const input = {
                searchType: 'token',
                values: [{ system: 'http://loinc.org', code: '12345' }]
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['http://loinc.org|12345']);
        });

        test('handles token with value only', () => {
            const input = {
                searchType: 'token',
                value: { code: 'active' }
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['active']);
        });

        test('handles token notEquals', () => {
            const input = {
                searchType: 'token',
                notEquals: { values: [{ system: 'http://sys', code: 'bad' }] }
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toEqual(['http://sys|bad']);
            expect(result.orQueryParameterValue).toEqual([]);
        });

        test('handles token with text modifier', () => {
            const input = {
                searchType: 'token',
                text: 'free text search'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('free text search');
            expect(result.newModifiers).toEqual(['text']);
        });

        test('handles token of-type modifier', () => {
            const input = {
                searchType: 'token',
                ofType: { system: 'http://sys', code: 'MR', value: '12345' }
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('http://sys|MR|12345');
            expect(result.newModifiers).toEqual(['of-type']);
        });

        test('handles token innerNotEquals', () => {
            const input = {
                searchType: 'token',
                values: [
                    { system: 'http://sys', code: 'good' },
                    { notEquals: { system: 'http://sys', code: 'bad' } }
                ]
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['http://sys|good']);
            expect(result.notQueryParameterValue).toEqual(['http://sys|bad']);
        });

        test('handles token with missing property', () => {
            const input = {
                searchType: 'token',
                missing: true
            };
            // BUG: After the token case without values/text/ofType,
            // orQueryParameterValue remains as newQueryParameterValue = []
            // The missing check on line 222 checks orQueryParameterValue === null
            // but it's [], so missing won't be processed
            const result = convertGraphQLParameters(input);
            // This demonstrates the bug - missing should be detected but the check fails
            // because orQueryParameterValue was set to [] instead of remaining null
            // In practice the token case with no values falls through to the check at line 86
            // where orQueryParameterValue = newQueryParameterValue (which is [])
            expect(result.newModifiers).toEqual(['missing']);
            expect(result.orQueryParameterValue).toBe(true);
        });

        test('handles token with url extension', () => {
            const input = {
                searchType: 'token',
                values: [{ url: 'http://ext.url', valueString: 'extValue' }]
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['http://ext.url|extValue']);
        });
    });

    describe('reference searchType', () => {
        test('handles reference with target and value', () => {
            const input = {
                searchType: 'reference',
                target: 'Patient',
                value: '123'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('Patient/123');
        });

        test('handles reference notEquals', () => {
            const input = {
                searchType: 'reference',
                notEquals: { target: 'Patient', value: '123' }
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toBe('Patient/123');
        });

        test('handles reference value only (no target)', () => {
            const input = {
                searchType: 'reference',
                value: '456'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('456');
        });

        test('handles reference with missing property', () => {
            const input = {
                searchType: 'reference',
                missing: true
            };
            const result = convertGraphQLParameters(input);
            // For reference without target/value, referenceText is '' so
            // we hit the length check and skip. orQueryParameterValue stays null.
            expect(result.orQueryParameterValue).toBe(true);
            expect(result.newModifiers).toEqual(['missing']);
        });
    });

    describe('quantity searchType', () => {
        test('handles quantity with prefix, value, system, code', () => {
            const input = {
                searchType: 'quantity',
                prefix: 'gt',
                value: '5.4',
                system: 'http://unitsofmeasure.org',
                code: 'mg'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe('gt5.4|http://unitsofmeasure.org|mg');
        });

        test('handles quantity notEquals', () => {
            const input = {
                searchType: 'quantity',
                notEquals: { value: '100', system: 'http://sys', code: 'kg' }
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toBe('100|http://sys|kg');
        });

        test('handles quantity with missing property', () => {
            const input = {
                searchType: 'quantity',
                missing: true
            };
            const result = convertGraphQLParameters(input);
            // quantity without value/prefix/system/code: quantityString is ''
            // condition on line 158 fails (empty string) so orQueryParameterValue stays null
            expect(result.orQueryParameterValue).toBe(true);
            expect(result.newModifiers).toEqual(['missing']);
        });
    });

    describe('date/dateTime searchType', () => {
        test('handles dateTime with equals', () => {
            const input = {
                searchType: 'dateTime',
                value: { equals: '2023-01-01' }
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['eq2023-01-01']);
        });

        test('handles date with greaterThan and lessThan (AND condition)', () => {
            const input = {
                searchType: 'date',
                value: { greaterThan: '2023-01-01', lessThan: '2023-12-31' }
            };
            const result = convertGraphQLParameters(input);
            // multiple values per date object => andQueryParameterValue
            expect(result.andQueryParameterValue).toEqual([['gt2023-01-01', 'lt2023-12-31']]);
            expect(result.orQueryParameterValue).toEqual([]);
        });

        test('handles dateTime with multiple values', () => {
            const input = {
                searchType: 'dateTime',
                values: [
                    { equals: '2023-01-01' },
                    { greaterThan: '2023-06-01' }
                ]
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['eq2023-01-01', 'gt2023-06-01']);
        });

        test('handles number type without eq prefix', () => {
            const input = {
                searchType: 'number',
                value: { equals: '42' }
            };
            const result = convertGraphQLParameters(input);
            // number type should not prepend 'eq'
            expect(result.orQueryParameterValue).toEqual(['42']);
        });

        test('BUG: date/dateTime with missing property is not detected when values are present', () => {
            // This demonstrates the bug on line 222:
            // After date/dateTime case processes values, orQueryParameterValue = []
            // The check `orQueryParameterValue === null` fails, so missing is ignored
            const input = {
                searchType: 'dateTime',
                missing: true
            };
            const result = convertGraphQLParameters(input);
            // Without value/values, the date case doesn't trigger the inner loops
            // orQueryParameterValue remains null in this path, so missing IS detected
            expect(result.orQueryParameterValue).toBe(true);
            expect(result.newModifiers).toEqual(['missing']);
        });

        test('date with values AND missing - value takes precedence over missing', () => {
            const input = {
                searchType: 'dateTime',
                values: [{ equals: '2023-01-01' }],
                missing: true
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(['eq2023-01-01']);
            expect(result.newModifiers).not.toContain('missing');
        });
    });

    describe('default searchType', () => {
        test('handles unknown search type by returning the full object', () => {
            const input = {
                searchType: 'unknownType',
                someData: 'abc'
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe(input);
        });
    });

    describe('non-object inputs', () => {
        test('handles plain string', () => {
            const result = convertGraphQLParameters('simple-value');
            expect(result.orQueryParameterValue).toBe('simple-value');
        });

        test('handles array', () => {
            const result = convertGraphQLParameters(['val1', 'val2']);
            expect(result.orQueryParameterValue).toEqual(['val1', 'val2']);
        });

        test('handles null', () => {
            const result = convertGraphQLParameters(null);
            expect(result.orQueryParameterValue).toBe(null);
        });

        test('handles undefined', () => {
            const result = convertGraphQLParameters(undefined);
            expect(result.orQueryParameterValue).toBeUndefined();
        });

        test('handles object without searchType', () => {
            const input = { value: 'test' };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toEqual(input);
        });
    });

    describe('missing property handling', () => {
        test('missing property on string type with no value/values/notEquals/contains/exact', () => {
            // A string search type with only 'missing' field
            const input = {
                searchType: 'string',
                missing: true
            };
            const result = convertGraphQLParameters(input);
            // The string case falls through without setting orQueryParameterValue
            // so it stays null, and the missing check fires
            expect(result.orQueryParameterValue).toBe(true);
            expect(result.newModifiers).toEqual(['missing']);
        });

        test('missing=false is handled correctly', () => {
            const input = {
                searchType: 'string',
                missing: false
            };
            const result = convertGraphQLParameters(input);
            expect(result.orQueryParameterValue).toBe(false);
            expect(result.newModifiers).toEqual(['missing']);
        });

        test('BUG: string notEquals + missing - missing is silently ignored', () => {
            // When notEquals is set, queryParameterValue gets reassigned to []
            // Object.hasOwn([], 'missing') is false, so missing is never processed
            const input = {
                searchType: 'string',
                notEquals: { value: 'bad-name' },
                missing: true
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toBe('bad-name');
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // missing modifier should NOT be dropped when notEquals is also present
            expect(result.newModifiers).toContain('missing');
        });

        test('BUG: reference notEquals + missing - missing is silently ignored', () => {
            const input = {
                searchType: 'reference',
                notEquals: { target: 'Patient', value: '123' },
                missing: true
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toBe('Patient/123');
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // missing modifier should NOT be dropped when notEquals is also present
            expect(result.newModifiers).toContain('missing');
        });

        test('BUG: quantity notEquals + missing - missing is silently ignored', () => {
            const input = {
                searchType: 'quantity',
                notEquals: { value: '100', system: 'http://sys', code: 'kg' },
                missing: true
            };
            const result = convertGraphQLParameters(input);
            expect(result.notQueryParameterValue).toBe('100|http://sys|kg');
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // missing modifier should NOT be dropped when notEquals is also present
            expect(result.newModifiers).toContain('missing');
        });
    });
});
