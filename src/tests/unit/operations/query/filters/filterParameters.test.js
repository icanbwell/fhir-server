const { describe, test, expect, jest: jestObj } = require('@jest/globals');

const { FilterParameters } = require('../../../../../operations/query/filters/filterParameters');

describe('FilterParameters', () => {
    describe('constructor', () => {
        test('stores all provided properties correctly', () => {
            const propertyObj = { name: 'name', type: 'string', field: 'name' };
            const parsedArg = { queryParameterValue: { value: 'John' } };
            const fieldMapper = { getField: jestObj.fn() };
            const fnUseAccessIndex = jestObj.fn().mockReturnValue(true);
            const resourceType = 'Patient';

            const params = new FilterParameters({
                propertyObj,
                parsedArg,
                fieldMapper,
                fnUseAccessIndex,
                resourceType
            });

            expect(params.propertyObj).toBe(propertyObj);
            expect(params.parsedArg).toBe(parsedArg);
            expect(params.fieldMapper).toBe(fieldMapper);
            expect(params.fnUseAccessIndex).toBe(fnUseAccessIndex);
            expect(params.resourceType).toBe(resourceType);
        });

        test('stores undefined for missing optional properties', () => {
            const params = new FilterParameters({
                propertyObj: undefined,
                parsedArg: undefined,
                fieldMapper: undefined,
                fnUseAccessIndex: undefined,
                resourceType: undefined
            });

            expect(params.propertyObj).toBeUndefined();
            expect(params.parsedArg).toBeUndefined();
            expect(params.fieldMapper).toBeUndefined();
            expect(params.fnUseAccessIndex).toBeUndefined();
            expect(params.resourceType).toBeUndefined();
        });

        test('stores null values without error', () => {
            const params = new FilterParameters({
                propertyObj: null,
                parsedArg: null,
                fieldMapper: null,
                fnUseAccessIndex: null,
                resourceType: null
            });

            expect(params.propertyObj).toBeNull();
            expect(params.parsedArg).toBeNull();
            expect(params.fieldMapper).toBeNull();
            expect(params.fnUseAccessIndex).toBeNull();
            expect(params.resourceType).toBeNull();
        });

        test('stores complex propertyObj with nested fields', () => {
            const propertyObj = {
                name: 'identifier',
                type: 'token',
                field: 'identifier',
                target: ['Patient', 'Organization'],
                searchParameter: { code: 'identifier' }
            };

            const params = new FilterParameters({
                propertyObj,
                parsedArg: {},
                fieldMapper: {},
                fnUseAccessIndex: () => false,
                resourceType: 'Patient'
            });

            expect(params.propertyObj).toBe(propertyObj);
            expect(params.propertyObj.target).toEqual(['Patient', 'Organization']);
        });

        test('fnUseAccessIndex is callable with a code argument', () => {
            const fnUseAccessIndex = jestObj.fn().mockImplementation((code) => code === 'bwell');

            const params = new FilterParameters({
                propertyObj: {},
                parsedArg: {},
                fieldMapper: {},
                fnUseAccessIndex,
                resourceType: 'Patient'
            });

            expect(params.fnUseAccessIndex('bwell')).toBe(true);
            expect(params.fnUseAccessIndex('other')).toBe(false);
            expect(fnUseAccessIndex).toHaveBeenCalledTimes(2);
        });

        test('preserves exact reference identity for all properties', () => {
            const propertyObj = { name: 'test' };
            const parsedArg = { queryParameterValue: {} };
            const fieldMapper = { getField: () => {} };
            const fnUseAccessIndex = () => true;

            const params = new FilterParameters({
                propertyObj,
                parsedArg,
                fieldMapper,
                fnUseAccessIndex,
                resourceType: 'Observation'
            });

            // Verify references are the same objects (not clones)
            expect(params.propertyObj).toBe(propertyObj);
            expect(params.parsedArg).toBe(parsedArg);
            expect(params.fieldMapper).toBe(fieldMapper);
            expect(params.fnUseAccessIndex).toBe(fnUseAccessIndex);
        });

        test('stores string resourceType correctly for various FHIR resource types', () => {
            const types = ['Patient', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport'];

            for (const rt of types) {
                const params = new FilterParameters({
                    propertyObj: {},
                    parsedArg: {},
                    fieldMapper: {},
                    fnUseAccessIndex: () => true,
                    resourceType: rt
                });
                expect(params.resourceType).toBe(rt);
            }
        });

        test('does not add any extra properties beyond the five defined', () => {
            const params = new FilterParameters({
                propertyObj: { name: 'test' },
                parsedArg: { value: '123' },
                fieldMapper: { getField: () => {} },
                fnUseAccessIndex: () => false,
                resourceType: 'Patient'
            });

            const keys = Object.keys(params);
            expect(keys).toHaveLength(5);
            expect(keys).toContain('propertyObj');
            expect(keys).toContain('parsedArg');
            expect(keys).toContain('fieldMapper');
            expect(keys).toContain('fnUseAccessIndex');
            expect(keys).toContain('resourceType');
        });

        test('handles empty object argument gracefully', () => {
            const params = new FilterParameters({});

            expect(params.propertyObj).toBeUndefined();
            expect(params.parsedArg).toBeUndefined();
            expect(params.fieldMapper).toBeUndefined();
            expect(params.fnUseAccessIndex).toBeUndefined();
            expect(params.resourceType).toBeUndefined();
        });
    });
});
