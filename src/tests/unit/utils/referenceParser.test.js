'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ReferenceParser } = require('../../../utils/referenceParser');

describe('ReferenceParser', () => {
    describe('parseReference', () => {
        test('parses ResourceType/id format', () => {
            const result = ReferenceParser.parseReference('Patient/123');
            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('123');
            expect(result.sourceAssigningAuthority).toBeUndefined();
        });

        test('parses ResourceType/id|authority format', () => {
            const result = ReferenceParser.parseReference('Patient/123|bwell');
            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('123');
            expect(result.sourceAssigningAuthority).toBe('bwell');
        });

        test('parses bare id without resourceType', () => {
            const result = ReferenceParser.parseReference('12345');
            expect(result.resourceType).toBeUndefined();
            expect(result.id).toBe('12345');
        });

        test('parses bare id|authority without resourceType', () => {
            const result = ReferenceParser.parseReference('12345|client-a');
            expect(result.resourceType).toBeUndefined();
            expect(result.id).toBe('12345');
            expect(result.sourceAssigningAuthority).toBe('client-a');
        });

        test('returns id as full URL when input is URL', () => {
            const url = 'https://fhir.example.com/Patient/123';
            const result = ReferenceParser.parseReference(url);
            expect(result.id).toBe(url);
        });

        test('parses UUID reference', () => {
            const result = ReferenceParser.parseReference('Patient/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        });
    });

    describe('createReference', () => {
        test('creates ResourceType/id reference', () => {
            expect(ReferenceParser.createReference({ resourceType: 'Patient', id: '123' }))
                .toBe('Patient/123');
        });

        test('creates id-only reference when no resourceType', () => {
            expect(ReferenceParser.createReference({ id: '123' }))
                .toBe('123');
        });

        test('appends sourceAssigningAuthority for non-UUID ids', () => {
            expect(ReferenceParser.createReference({
                resourceType: 'Patient',
                id: '123',
                sourceAssigningAuthority: 'bwell'
            })).toBe('Patient/123|bwell');
        });

        test('does NOT append sourceAssigningAuthority for UUID ids', () => {
            expect(ReferenceParser.createReference({
                resourceType: 'Patient',
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                sourceAssigningAuthority: 'bwell'
            })).toBe('Patient/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        });

        test('omits authority when not provided', () => {
            expect(ReferenceParser.createReference({
                resourceType: 'Observation',
                id: 'obs-1'
            })).toBe('Observation/obs-1');
        });
    });

    describe('isUuidReference', () => {
        test('returns true for UUID in reference', () => {
            expect(ReferenceParser.isUuidReference('Patient/a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
                .toBe(true);
        });

        test('returns false for non-UUID reference', () => {
            expect(ReferenceParser.isUuidReference('Patient/simple-id')).toBe(false);
        });

        test('returns true for bare UUID', () => {
            expect(ReferenceParser.isUuidReference('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
                .toBe(true);
        });
    });

    describe('getResourceType', () => {
        test('extracts resourceType', () => {
            expect(ReferenceParser.getResourceType('Observation/123')).toBe('Observation');
        });

        test('returns undefined for bare id', () => {
            expect(ReferenceParser.getResourceType('123')).toBeUndefined();
        });
    });

    describe('getSourceAssigningAuthority', () => {
        test('extracts authority from reference', () => {
            expect(ReferenceParser.getSourceAssigningAuthority('Patient/123|bwell')).toBe('bwell');
        });

        test('returns undefined when no authority', () => {
            expect(ReferenceParser.getSourceAssigningAuthority('Patient/123')).toBeUndefined();
        });
    });

    describe('createReferenceWithoutSourceAssigningAuthority', () => {
        test('strips authority from reference', () => {
            expect(ReferenceParser.createReferenceWithoutSourceAssigningAuthority('Patient/123|bwell'))
                .toBe('Patient/123');
        });

        test('returns same reference when no authority present', () => {
            expect(ReferenceParser.createReferenceWithoutSourceAssigningAuthority('Patient/456'))
                .toBe('Patient/456');
        });
    });

    describe('parseCanonicalReference', () => {
        test('parses canonical URL to resourceType and id', () => {
            const result = ReferenceParser.parseCanonicalReference({
                url: 'https://fhir.example.com/Questionnaire/q-123'
            });
            expect(result.resourceType).toBe('Questionnaire');
            expect(result.id).toBe('q-123');
        });

        test('returns null for URL without resource pattern', () => {
            const result = ReferenceParser.parseCanonicalReference({
                url: 'https://fhir.example.com/'
            });
            expect(result).toBeNull();
        });

        test('parses relative reference when not a URL', () => {
            const result = ReferenceParser.parseCanonicalReference({ url: 'Patient/123' });
            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('123');
        });

        test('parses URL with nested path', () => {
            const result = ReferenceParser.parseCanonicalReference({
                url: 'https://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
            });
            expect(result.resourceType).toBe('StructureDefinition');
            expect(result.id).toBe('us-core-patient');
        });
    });
});
