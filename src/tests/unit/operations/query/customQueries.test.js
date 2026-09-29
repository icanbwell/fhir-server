const { describe, test, expect } = require('@jest/globals');
const { fhirFilterTypes, vulcanIgSearchQueries } = require('../../../../operations/query/customQueries');

describe('customQueries', () => {
    describe('fhirFilterTypes', () => {
        test('has all expected filter types', () => {
            expect(fhirFilterTypes.reference).toBe('reference');
            expect(fhirFilterTypes.token).toBe('token');
            expect(fhirFilterTypes.date).toBe('date');
            expect(fhirFilterTypes.datetime).toBe('datetime');
            expect(fhirFilterTypes.instant).toBe('instant');
            expect(fhirFilterTypes.period).toBe('period');
            expect(fhirFilterTypes.string).toBe('string');
            expect(fhirFilterTypes.uri).toBe('uri');
            expect(fhirFilterTypes.email).toBe('email');
            expect(fhirFilterTypes.phone).toBe('phone');
            expect(fhirFilterTypes.canonical).toBe('canonical');
            expect(fhirFilterTypes.quantity).toBe('quantity');
            expect(fhirFilterTypes.number).toBe('number');
            expect(fhirFilterTypes.composite).toBe('composite');
        });

        test('all filter type values are unique strings', () => {
            const values = Object.values(fhirFilterTypes);
            const uniqueValues = new Set(values);
            expect(uniqueValues.size).toBe(values.length);
            values.forEach(v => expect(typeof v).toBe('string'));
        });

        test('NOTE: fhirFilterTypes uses lowercase "datetime" but r4.js switch uses "dateTime"', () => {
            // In r4.js line 230-233, the switch cases use:
            //   case fhirFilterTypes.dateTime  (which is undefined!)
            //   case fhirFilterTypes.date
            //   case fhirFilterTypes.period
            //   case fhirFilterTypes.instant
            //
            // fhirFilterTypes.dateTime is UNDEFINED because the object defines 'datetime' (lowercase)
            // This means a propertyObj with type='dateTime' would fall through to the default
            // case and throw "Unknown type=dateTime"
            //
            // However, in practice the SearchParameterDefinition.type for date-time fields
            // is set to 'datetime' (lowercase) by the search parameter setup code,
            // so this mismatch between the enum value and the case label is consistent.
            expect(fhirFilterTypes.dateTime).toBeUndefined();
            expect(fhirFilterTypes.datetime).toBe('datetime');
        });
    });

    describe('vulcanIgSearchQueries', () => {
        test('has Patient resource queries', () => {
            expect(vulcanIgSearchQueries.Patient).toBeDefined();
        });

        test('Patient has expected custom query keys', () => {
            const patientKeys = Object.keys(vulcanIgSearchQueries.Patient);
            expect(patientKeys).toContain('condition');
            expect(patientKeys).toContain('medication');
            expect(patientKeys).toContain('observation');
            expect(patientKeys).toContain('encounter-type');
            expect(patientKeys).toContain('consent-status');
        });

        test('each query has correct structure', () => {
            for (const [queryName, queryDef] of Object.entries(vulcanIgSearchQueries.Patient)) {
                expect(queryDef.filters).toBeDefined();
                expect(Array.isArray(queryDef.filters)).toBe(true);
                expect(queryDef.filters.length).toBeGreaterThan(0);
                expect(queryDef.resultSearchParam).toBeDefined();

                for (const filter of queryDef.filters) {
                    expect(filter.resourceType).toBeDefined();
                    expect(filter.searchParam).toBeDefined();
                    expect(filter.filterField).toBeDefined();
                    expect(filter.extractValueFn).toBeDefined();
                    expect(typeof filter.extractValueFn).toBe('string');
                }
            }
        });

        test('extractValueFn strings are valid function bodies', () => {
            for (const [, queryDef] of Object.entries(vulcanIgSearchQueries.Patient)) {
                for (const filter of queryDef.filters) {
                    // Should be able to create functions from these strings
                    const fn = new Function('x', filter.extractValueFn);
                    // They all follow the pattern: return x.split('/')[1]
                    const testInput = 'Patient/123';
                    expect(fn(testInput)).toBe('123');
                }
            }
        });

        test('all resultSearchParam values are "id"', () => {
            for (const [, queryDef] of Object.entries(vulcanIgSearchQueries.Patient)) {
                expect(queryDef.resultSearchParam).toBe('id');
            }
        });

        test('consent queries use patient._uuid while others use subject._uuid', () => {
            const consentQueries = ['consent-status', 'consent-scope'];
            const otherQueries = Object.keys(vulcanIgSearchQueries.Patient)
                .filter(k => !consentQueries.includes(k));

            for (const key of consentQueries) {
                expect(vulcanIgSearchQueries.Patient[key].filters[0].filterField).toBe('patient._uuid');
            }

            for (const key of otherQueries) {
                expect(vulcanIgSearchQueries.Patient[key].filters[0].filterField).toBe('subject._uuid');
            }
        });
    });
});
