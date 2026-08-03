'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const {
    fhirContentTypes,
    hasNdJsonContentType,
    hasJsonContentType,
    hasCsvContentType,
    hasTabDelimitedContentType,
    hasPipeDelimitedContentType,
    hasExcelContentType
} = require('../../../utils/contentTypes');

describe('contentTypes', () => {
    describe('fhirContentTypes constants', () => {
        test('defines expected content type constants', () => {
            expect(fhirContentTypes.ndJson).toBe('application/fhir+ndjson');
            expect(fhirContentTypes.ndJson2).toBe('application/ndjson');
            expect(fhirContentTypes.ndJson3).toBe('ndjson');
            expect(fhirContentTypes.fhirJson).toBe('application/fhir+json');
            expect(fhirContentTypes.fhirJson2).toBe('application/json');
            expect(fhirContentTypes.fhirJson3).toBe('json');
            expect(fhirContentTypes.jsonPatch).toBe('application/json-patch+json');
            expect(fhirContentTypes.pipeDelimited).toBe('text/plain-pipe-delimited');
            expect(fhirContentTypes.csv).toBe('text/csv');
            expect(fhirContentTypes.tsv).toBe('text/tab-separated-values');
            expect(fhirContentTypes.form_urlencoded).toBe('application/x-www-form-urlencoded');
            expect(fhirContentTypes.excel).toBe('application/vnd.ms-excel');
            expect(fhirContentTypes.zip).toBe('application/zip');
        });
    });

    describe('hasNdJsonContentType', () => {
        test('returns true for application/fhir+ndjson', () => {
            expect(hasNdJsonContentType('application/fhir+ndjson')).toBe(true);
        });

        test('returns true for application/ndjson', () => {
            expect(hasNdJsonContentType('application/ndjson')).toBe(true);
        });

        test('returns true for ndjson shorthand', () => {
            expect(hasNdJsonContentType('ndjson')).toBe(true);
        });

        test('returns false for unrelated content type', () => {
            expect(hasNdJsonContentType('application/json')).toBe(false);
        });

        test('returns false for null', () => {
            expect(hasNdJsonContentType(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(hasNdJsonContentType(undefined)).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(hasNdJsonContentType('')).toBe(false);
        });

        test('handles array input - returns true if any element matches', () => {
            expect(hasNdJsonContentType(['text/html', 'application/ndjson'])).toBe(true);
        });

        test('handles array input - returns false if no element matches', () => {
            expect(hasNdJsonContentType(['text/html', 'text/plain'])).toBe(false);
        });

        test('does NOT use decodeURIComponent (inconsistency with csv/tsv/pipe/excel)', () => {
            // URL-encoded version of ndjson would not be recognized
            const encoded = encodeURIComponent('application/fhir+ndjson');
            expect(hasNdJsonContentType(encoded)).toBe(false);
        });
    });

    describe('hasJsonContentType', () => {
        test('returns true for application/fhir+json', () => {
            expect(hasJsonContentType('application/fhir+json')).toBe(true);
        });

        test('returns true for application/json', () => {
            expect(hasJsonContentType('application/json')).toBe(true);
        });

        test('returns true for json shorthand', () => {
            expect(hasJsonContentType('json')).toBe(true);
        });

        test('returns false for ndjson', () => {
            expect(hasJsonContentType('application/ndjson')).toBe(false);
        });

        test('returns false for null', () => {
            expect(hasJsonContentType(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(hasJsonContentType(undefined)).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(hasJsonContentType('')).toBe(false);
        });

        test('handles array input - returns true if any element matches', () => {
            expect(hasJsonContentType(['text/html', 'application/json'])).toBe(true);
        });

        test('handles array input - returns false if no element matches', () => {
            expect(hasJsonContentType(['text/html', 'ndjson'])).toBe(false);
        });
    });

    describe('hasCsvContentType', () => {
        test('returns true for text/csv', () => {
            expect(hasCsvContentType('text/csv')).toBe(true);
        });

        test('returns false for other content types', () => {
            expect(hasCsvContentType('application/json')).toBe(false);
        });

        test('returns false for null', () => {
            expect(hasCsvContentType(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(hasCsvContentType(undefined)).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(hasCsvContentType('')).toBe(false);
        });

        test('handles URL-encoded input via decodeURIComponent', () => {
            const encoded = encodeURIComponent('text/csv');
            expect(hasCsvContentType(encoded)).toBe(true);
        });

        test('handles array input - decodeURIComponent on array returns array toString', () => {
            // Note: decodeURIComponent on an array calls toString() first
            // ['text/csv'] becomes 'text/csv' when converted to string
            // This behavior is inconsistent with hasNdJsonContentType which
            // properly checks Array.isArray before decoding
            const result = hasCsvContentType(['text/csv']);
            // decodeURIComponent(['text/csv'].toString()) === 'text/csv'
            // then Array.isArray('text/csv') is false
            // so it does === comparison: 'text/csv' === 'text/csv' -> true
            expect(result).toBe(true);
        });

        test('array with multiple elements gets joined with comma by toString', () => {
            // ['text/csv', 'other'] -> decodeURIComponent('text/csv,other') -> 'text/csv,other'
            // 'text/csv,other' === 'text/csv' -> false
            const result = hasCsvContentType(['text/csv', 'other']);
            expect(result).toBe(false);
        });
    });

    describe('hasTabDelimitedContentType', () => {
        test('returns true for text/tab-separated-values', () => {
            expect(hasTabDelimitedContentType('text/tab-separated-values')).toBe(true);
        });

        test('returns false for other content types', () => {
            expect(hasTabDelimitedContentType('text/csv')).toBe(false);
        });

        test('returns false for null', () => {
            expect(hasTabDelimitedContentType(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(hasTabDelimitedContentType(undefined)).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(hasTabDelimitedContentType('')).toBe(false);
        });

        test('handles URL-encoded input via decodeURIComponent', () => {
            const encoded = encodeURIComponent('text/tab-separated-values');
            expect(hasTabDelimitedContentType(encoded)).toBe(true);
        });
    });

    describe('hasPipeDelimitedContentType', () => {
        test('returns true for text/plain-pipe-delimited', () => {
            expect(hasPipeDelimitedContentType('text/plain-pipe-delimited')).toBe(true);
        });

        test('returns false for other content types', () => {
            expect(hasPipeDelimitedContentType('text/csv')).toBe(false);
        });

        test('returns false for null', () => {
            expect(hasPipeDelimitedContentType(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(hasPipeDelimitedContentType(undefined)).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(hasPipeDelimitedContentType('')).toBe(false);
        });

        test('handles URL-encoded input via decodeURIComponent', () => {
            const encoded = encodeURIComponent('text/plain-pipe-delimited');
            expect(hasPipeDelimitedContentType(encoded)).toBe(true);
        });
    });

    describe('hasExcelContentType', () => {
        test('returns true for application/vnd.ms-excel', () => {
            expect(hasExcelContentType('application/vnd.ms-excel')).toBe(true);
        });

        test('returns false for other content types', () => {
            expect(hasExcelContentType('application/json')).toBe(false);
        });

        test('returns false for null', () => {
            expect(hasExcelContentType(null)).toBe(false);
        });

        test('returns false for undefined', () => {
            expect(hasExcelContentType(undefined)).toBe(false);
        });

        test('returns false for empty string', () => {
            expect(hasExcelContentType('')).toBe(false);
        });

        test('handles URL-encoded input via decodeURIComponent', () => {
            const encoded = encodeURIComponent('application/vnd.ms-excel');
            expect(hasExcelContentType(encoded)).toBe(true);
        });
    });

    describe('inconsistency between ndJson and csv/tsv/pipe/excel', () => {
        test('hasNdJsonContentType does not decode URL-encoded input', () => {
            const encoded = encodeURIComponent('application/fhir+ndjson');
            expect(hasNdJsonContentType(encoded)).toBe(false);
        });

        test('hasCsvContentType DOES decode URL-encoded input', () => {
            const encoded = encodeURIComponent('text/csv');
            expect(hasCsvContentType(encoded)).toBe(true);
        });

        test('hasJsonContentType does not decode URL-encoded input', () => {
            const encoded = encodeURIComponent('application/fhir+json');
            expect(hasJsonContentType(encoded)).toBe(false);
        });
    });
});
