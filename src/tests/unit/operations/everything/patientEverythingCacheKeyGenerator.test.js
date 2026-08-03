const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock baseCacheKeyGenerator
jestObj.mock('../../../../operations/common/baseCacheKeyGenerator', () => {
    class BaseCacheKeyGenerator {
        constructor() {
            this.operation = '';
            this.invalidParamsForCache = [];
            this.cacheableResponseTypes = [];
        }
    }
    return { BaseCacheKeyGenerator };
});

// Mock contentTypes
jestObj.mock('../../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        fhirJson: 'application/fhir+json',
        fhirJson2: 'application/json',
        fhirJson3: 'json',
        ndJson: 'application/fhir+ndjson',
        ndJson2: 'application/ndjson',
        ndJson3: 'ndjson'
    }
}));

const { PatientEverythingCacheKeyGenerator } = require('../../../../operations/everything/patientEverythingCachekeyGenerator');

describe('PatientEverythingCacheKeyGenerator', () => {
    let generator;

    beforeEach(() => {
        generator = new PatientEverythingCacheKeyGenerator();
    });

    test('sets operation to Everything', () => {
        expect(generator.operation).toBe('Everything');
    });

    test('invalidParamsForCache has 12 items', () => {
        expect(generator.invalidParamsForCache).toHaveLength(12);
    });

    test('invalidParamsForCache includes _since', () => {
        expect(generator.invalidParamsForCache).toContain('_since');
    });

    test('invalidParamsForCache includes contained', () => {
        expect(generator.invalidParamsForCache).toContain('contained');
    });

    test('invalidParamsForCache includes all expected params', () => {
        const expectedParams = [
            '_since', '_includePatientLinkedOnly', '_rewritePatientReference',
            '_includeNonClinicalResources', '_debug', '_explain', '_includeHidden',
            '_includeProxyPatientLinkedOnly', '_excludeProxyPatientLinked',
            '_includePatientLinkedUuidOnly', '_includeUuidOnly', 'contained'
        ];
        expect(generator.invalidParamsForCache).toEqual(expectedParams);
    });

    test('cacheableResponseTypes includes fhirJson types', () => {
        expect(generator.cacheableResponseTypes).toContain('application/fhir+json');
        expect(generator.cacheableResponseTypes).toContain('application/json');
        expect(generator.cacheableResponseTypes).toContain('json');
    });

    test('cacheableResponseTypes includes ndJson types', () => {
        expect(generator.cacheableResponseTypes).toContain('application/fhir+ndjson');
        expect(generator.cacheableResponseTypes).toContain('application/ndjson');
        expect(generator.cacheableResponseTypes).toContain('ndjson');
    });

    test('cacheableResponseTypes has 6 items total', () => {
        expect(generator.cacheableResponseTypes).toHaveLength(6);
    });
});
