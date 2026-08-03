'use strict';

const { describe, test, expect } = require('@jest/globals');
const { IdParser } = require('../../../utils/idParser');

describe('IdParser', () => {
    describe('parse', () => {
        test('parses simple id', () => {
            const result = IdParser.parse('12345');
            expect(result.id).toBe('12345');
            expect(result.sourceAssigningAuthority).toBeUndefined();
        });

        test('parses id with pipe-separated sourceAssigningAuthority', () => {
            const result = IdParser.parse('12345|bwell');
            expect(result.id).toBe('12345');
            expect(result.sourceAssigningAuthority).toBe('bwell');
        });

        test('handles UUID id', () => {
            const result = IdParser.parse('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(result.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(result.sourceAssigningAuthority).toBeUndefined();
        });

        test('handles UUID id with authority', () => {
            const result = IdParser.parse('a1b2c3d4-e5f6-7890-abcd-ef1234567890|client');
            expect(result.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(result.sourceAssigningAuthority).toBe('client');
        });

        test('only splits on first pipe', () => {
            const result = IdParser.parse('id|auth|extra');
            expect(result.id).toBe('id');
            expect(result.sourceAssigningAuthority).toBe('auth');
        });

        test('handles empty string id', () => {
            const result = IdParser.parse('');
            expect(result.id).toBe('');
            expect(result.sourceAssigningAuthority).toBeUndefined();
        });

        test('handles pipe at start (empty id)', () => {
            const result = IdParser.parse('|bwell');
            expect(result.id).toBe('');
            expect(result.sourceAssigningAuthority).toBe('bwell');
        });

        test('handles pipe at end (empty authority)', () => {
            const result = IdParser.parse('123|');
            expect(result.id).toBe('123');
            expect(result.sourceAssigningAuthority).toBe('');
        });
    });
});
