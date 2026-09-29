'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../../middleware/fhir/resources/4_0_0/parameters', () => ({
    patient: {
        name: { type: 'string', definition: '/SearchParameter/Patient-name' },
        birthdate: { type: 'date', definition: '/SearchParameter/Patient-birthdate' }
    },
    resource: {
        _id: { type: 'token', definition: '/SearchParameter/Resource-id' },
        _lastUpdated: { type: 'date', definition: '/SearchParameter/Resource-lastUpdated' }
    },
    domainresource: {
        _text: { type: 'string', definition: '/SearchParameter/DomainResource-text' }
    }
}));

const { getSearchParameters, getParameters } = require('../../../../../middleware/fhir/utils/params.utils');

describe('params.utils', () => {
    describe('getParameters', () => {
        test('returns parameters for 4_0_0 version', () => {
            const result = getParameters('4_0_0', 'patient');
            expect(result).toBeDefined();
            expect(result.name).toEqual({ type: 'string', definition: '/SearchParameter/Patient-name' });
        });

        test('returns undefined for unsupported version', () => {
            const result = getParameters('2_0_0', 'patient');
            expect(result).toBeUndefined();
        });

        test('returns resource parameters', () => {
            const result = getParameters('4_0_0', 'resource');
            expect(result._id).toBeDefined();
            expect(result._lastUpdated).toBeDefined();
        });
    });

    describe('getSearchParameters', () => {
        test('returns array of search parameters for a profile', () => {
            const result = getSearchParameters('Patient', '4_0_0');
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        test('includes resource-level parameters', () => {
            const result = getSearchParameters('Patient', '4_0_0');
            const names = result.map(p => p.name);
            expect(names).toContain('_id');
            expect(names).toContain('_lastUpdated');
        });

        test('includes domainresource parameters for non-DSTU2 versions', () => {
            const result = getSearchParameters('Patient', '4_0_0');
            const names = result.map(p => p.name);
            expect(names).toContain('_text');
        });

        test('each parameter has a name and versions property', () => {
            const result = getSearchParameters('Patient', '4_0_0');
            result.forEach(param => {
                expect(param.name).toBeDefined();
                expect(param.versions).toBe('4_0_0');
            });
        });

        test('converts profile name to lowercase', () => {
            const result = getSearchParameters('PATIENT', '4_0_0');
            const names = result.map(p => p.name);
            expect(names).toContain('name');
            expect(names).toContain('birthdate');
        });

        test('returns parameters with type info merged from source', () => {
            const result = getSearchParameters('Patient', '4_0_0');
            const nameParam = result.find(p => p.name === 'name');
            expect(nameParam.type).toBe('string');
            expect(nameParam.definition).toBe('/SearchParameter/Patient-name');
        });

        test('merges profile-specific and resource parameters', () => {
            const result = getSearchParameters('Patient', '4_0_0');
            const names = result.map(p => p.name);
            // profile-specific
            expect(names).toContain('name');
            expect(names).toContain('birthdate');
            // resource-level
            expect(names).toContain('_id');
        });
    });
});
