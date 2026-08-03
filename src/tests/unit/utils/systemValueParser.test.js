'use strict';

const { describe, test, expect } = require('@jest/globals');
const { SystemValueParser } = require('../../../utils/systemValueParser');

describe('SystemValueParser', () => {
    describe('parse', () => {
        test('splits system|value on pipe', () => {
            const result = SystemValueParser.parse('http://loinc.org|12345');
            expect(result.system).toBe('http://loinc.org');
            expect(result.value).toBe('12345');
        });

        test('returns value only when no pipe present', () => {
            const result = SystemValueParser.parse('12345');
            expect(result.system).toBeUndefined();
            expect(result.value).toBe('12345');
        });

        test('handles empty system (pipe at start)', () => {
            const result = SystemValueParser.parse('|myvalue');
            expect(result.system).toBe('');
            expect(result.value).toBe('myvalue');
        });

        test('handles empty value (pipe at end)', () => {
            const result = SystemValueParser.parse('http://system|');
            expect(result.system).toBe('http://system');
            expect(result.value).toBe('');
        });

        test('only splits on first pipe - extra pipes go into value', () => {
            const result = SystemValueParser.parse('sys|val|extra');
            expect(result.system).toBe('sys');
            expect(result.value).toBe('val');
        });

        test('handles empty string input', () => {
            const result = SystemValueParser.parse('');
            expect(result.system).toBeUndefined();
            expect(result.value).toBe('');
        });

        test('preserves special characters in system URL', () => {
            const result = SystemValueParser.parse('http://hl7.org/fhir/sid/us-ssn|999-99-9999');
            expect(result.system).toBe('http://hl7.org/fhir/sid/us-ssn');
            expect(result.value).toBe('999-99-9999');
        });
    });
});
