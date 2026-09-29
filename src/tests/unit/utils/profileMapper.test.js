const { describe, test, expect, beforeAll, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/data/profile.map', () => ({
    canonicalToOriginalUrlMap: {
        '4_0_0': {
            AuditEvent: {
                'http://hl7.org/fhir/StructureDefinition/ehrsrle-auditevent':
                    'http://hl7.org/fhir/R4/ehrsrle/ehrsrle-auditevent.profile.json'
            },
            Composition: {
                'http://hl7.org/fhir/StructureDefinition/clinicaldocument':
                    'http://hl7.org/fhir/R4/clinicaldocument.profile.json',
                'http://hl7.org/fhir/StructureDefinition/catalog':
                    'http://hl7.org/fhir/R4/catalog.profile.json'
            },
            DiagnosticReport: {
                'http://hl7.org/fhir/StructureDefinition/lipidprofile':
                    'http://hl7.org/fhir/R4/lipidprofile.profile.json'
            }
        }
    }
}));

const { ProfileUrlMapper } = require('../../../utils/profileMapper');

describe('ProfileUrlMapper', () => {
    let mapper;

    beforeAll(() => {
        mapper = new ProfileUrlMapper();
    });

    describe('constructor', () => {
        test('creates an instance with supportedResources set populated', () => {
            expect(mapper.supportedResources).toBeInstanceOf(Set);
            expect(mapper.supportedResources.size).toBeGreaterThan(0);
        });

        test('supportedResources contains all resource names from map', () => {
            expect(mapper.supportedResources.has('AuditEvent')).toBe(true);
            expect(mapper.supportedResources.has('Composition')).toBe(true);
            expect(mapper.supportedResources.has('DiagnosticReport')).toBe(true);
        });

        test('_canonicalToOriginalMap is not writable', () => {
            expect(() => {
                mapper._canonicalToOriginalMap = {};
            }).toThrow();
        });

        test('individual canonical url entries are not writable', () => {
            expect(() => {
                mapper._canonicalToOriginalMap['http://hl7.org/fhir/StructureDefinition/ehrsrle-auditevent'] = 'something-else';
            }).toThrow();
        });
    });

    describe('supportedResources', () => {
        test('returns the set of resource names', () => {
            const resources = mapper.supportedResources;
            expect(resources.has('AuditEvent')).toBe(true);
            expect(resources.has('Composition')).toBe(true);
            expect(resources.has('DiagnosticReport')).toBe(true);
        });

        test('does not contain resources not in the map', () => {
            expect(mapper.supportedResources.has('Patient')).toBe(false);
            expect(mapper.supportedResources.has('NonExistentResource')).toBe(false);
        });
    });

    describe('getOriginalUrl', () => {
        test('returns the original url for a known canonical url', () => {
            const result = mapper.getOriginalUrl('http://hl7.org/fhir/StructureDefinition/ehrsrle-auditevent');
            expect(result).toBe('http://hl7.org/fhir/R4/ehrsrle/ehrsrle-auditevent.profile.json');
        });

        test('returns the original url for a Composition profile', () => {
            const result = mapper.getOriginalUrl('http://hl7.org/fhir/StructureDefinition/clinicaldocument');
            expect(result).toBe('http://hl7.org/fhir/R4/clinicaldocument.profile.json');
        });

        test('returns the original url for catalog profile', () => {
            const result = mapper.getOriginalUrl('http://hl7.org/fhir/StructureDefinition/catalog');
            expect(result).toBe('http://hl7.org/fhir/R4/catalog.profile.json');
        });

        test('returns the original url for DiagnosticReport lipid profile', () => {
            const result = mapper.getOriginalUrl('http://hl7.org/fhir/StructureDefinition/lipidprofile');
            expect(result).toBe('http://hl7.org/fhir/R4/lipidprofile.profile.json');
        });

        test('returns the passed url unchanged when canonical url is not found', () => {
            const unknownUrl = 'http://hl7.org/fhir/StructureDefinition/unknown-profile';
            const result = mapper.getOriginalUrl(unknownUrl);
            expect(result).toBe(unknownUrl);
        });

        test('returns the passed url when given an empty string', () => {
            const result = mapper.getOriginalUrl('');
            expect(result).toBe('');
        });

        test('returns the passed url for a non-FHIR url', () => {
            const nonFhirUrl = 'https://example.com/some-random-url';
            const result = mapper.getOriginalUrl(nonFhirUrl);
            expect(result).toBe(nonFhirUrl);
        });
    });

    describe('immutability', () => {
        test('_canonicalToOriginalMap is enumerable', () => {
            const descriptor = Object.getOwnPropertyDescriptor(mapper, '_canonicalToOriginalMap');
            expect(descriptor.enumerable).toBe(true);
        });

        test('_canonicalToOriginalMap keys include all canonical urls from all resources', () => {
            const keys = Object.keys(mapper._canonicalToOriginalMap);
            expect(keys).toContain('http://hl7.org/fhir/StructureDefinition/ehrsrle-auditevent');
            expect(keys).toContain('http://hl7.org/fhir/StructureDefinition/clinicaldocument');
            expect(keys).toContain('http://hl7.org/fhir/StructureDefinition/catalog');
            expect(keys).toContain('http://hl7.org/fhir/StructureDefinition/lipidprofile');
        });
    });
});
