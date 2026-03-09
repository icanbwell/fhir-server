const { describe, test, expect } = require('@jest/globals');
const { FhirReferenceParser } = require('../../../../utils/fhir/referenceParser');

describe('FhirReferenceParser', () => {
    describe('extractEntityType', () => {
        test('extracts type from relative reference', () => {
            expect(FhirReferenceParser.extractEntityType('Patient/123')).toBe('Patient');
            expect(FhirReferenceParser.extractEntityType('Practitioner/abc-123')).toBe('Practitioner');
            expect(FhirReferenceParser.extractEntityType('Organization/org-1')).toBe('Organization');
        });

        test('extracts type from absolute URL', () => {
            expect(FhirReferenceParser.extractEntityType('https://example.com/fhir/Patient/123')).toBe('Patient');
            expect(FhirReferenceParser.extractEntityType('http://example.com/fhir/Practitioner/abc')).toBe('Practitioner');
        });

        test('extracts type from URN format', () => {
            expect(FhirReferenceParser.extractEntityType('urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7')).toBe('uuid');
            expect(FhirReferenceParser.extractEntityType('urn:oid:1.2.3.4.5')).toBe('oid');
        });

        test('returns unknown for invalid formats', () => {
            expect(FhirReferenceParser.extractEntityType('')).toBe('unknown');
            expect(FhirReferenceParser.extractEntityType(null)).toBe('unknown');
            expect(FhirReferenceParser.extractEntityType(undefined)).toBe('unknown');
            expect(FhirReferenceParser.extractEntityType('NoSlash')).toBe('unknown');
        });

        test('handles complex URLs with multiple path segments', () => {
            expect(FhirReferenceParser.extractEntityType('https://example.com/api/v1/fhir/Patient/123')).toBe('Patient');
        });
    });

    describe('isValid', () => {
        test('accepts valid relative references', () => {
            expect(FhirReferenceParser.isValid('Patient/123')).toBe(true);
            expect(FhirReferenceParser.isValid('Practitioner/abc-123')).toBe(true);
        });

        test('accepts valid absolute URLs', () => {
            expect(FhirReferenceParser.isValid('https://example.com/fhir/Patient/123')).toBe(true);
            expect(FhirReferenceParser.isValid('http://example.com/Patient/123')).toBe(true);
        });

        test('accepts valid URN format', () => {
            expect(FhirReferenceParser.isValid('urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7')).toBe(true);
            expect(FhirReferenceParser.isValid('urn:oid:1.2.3.4.5')).toBe(true);
        });

        test('rejects invalid formats', () => {
            expect(FhirReferenceParser.isValid('')).toBe(false);
            expect(FhirReferenceParser.isValid(null)).toBe(false);
            expect(FhirReferenceParser.isValid(undefined)).toBe(false);
            expect(FhirReferenceParser.isValid('InvalidFormat')).toBe(false);
            expect(FhirReferenceParser.isValid(123)).toBe(false);
        });
    });

    describe('extractId', () => {
        test('extracts ID from relative reference', () => {
            expect(FhirReferenceParser.extractId('Patient/123')).toBe('123');
            expect(FhirReferenceParser.extractId('Practitioner/abc-123')).toBe('abc-123');
        });

        test('extracts ID from absolute URL', () => {
            expect(FhirReferenceParser.extractId('https://example.com/fhir/Patient/123')).toBe('123');
        });

        test('extracts ID from URN', () => {
            expect(FhirReferenceParser.extractId('urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7')).toBe('53fefa32-fcbb-4ff8-8a92-55ee120877b7');
        });

        test('returns null for invalid input', () => {
            expect(FhirReferenceParser.extractId('')).toBe(null);
            expect(FhirReferenceParser.extractId(null)).toBe(null);
            expect(FhirReferenceParser.extractId(undefined)).toBe(null);
        });
    });
});
