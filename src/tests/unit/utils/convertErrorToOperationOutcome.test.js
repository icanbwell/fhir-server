'use strict';

const { describe, test, expect } = require('@jest/globals');
const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');

describe('convertErrorToOperationOutcome', () => {
    test('returns OperationOutcome with issue array', () => {
        const error = new Error('Something went wrong');
        const result = convertErrorToOperationOutcome({ error });
        expect(result.resourceType).toBe('OperationOutcome');
        expect(result.issue).toHaveLength(1);
    });

    test('includes error message in details when not internalError', () => {
        const error = new Error('Bad request data');
        const result = convertErrorToOperationOutcome({ error });
        expect(result.issue[0].details.text).toContain('Bad request data');
    });

    test('hides error message for internalError (shows generic text)', () => {
        const error = new Error('database connection string leaked');
        const result = convertErrorToOperationOutcome({ error, internalError: true });
        expect(result.issue[0].details.text).toBe('Internal Server Error');
        expect(result.issue[0].details.text).not.toContain('database');
    });

    test('uses error.issue when present and not internalError', () => {
        const error = new Error('custom');
        error.issue = [
            { severity: 'warning', code: 'not-found', details: { text: 'Resource missing' } }
        ];
        const result = convertErrorToOperationOutcome({ error });
        expect(result.issue).toHaveLength(1);
        expect(result.issue[0].severity).toBe('warning');
        expect(result.issue[0].code).toBe('not-found');
    });

    test('ignores error.issue when internalError is true', () => {
        const error = new Error('oops');
        error.issue = [{ severity: 'error', code: 'custom' }];
        const result = convertErrorToOperationOutcome({ error, internalError: true });
        expect(result.issue[0].details.text).toBe('Internal Server Error');
    });

    test('ignores empty issue array on error', () => {
        const error = new Error('fallback');
        error.issue = [];
        const result = convertErrorToOperationOutcome({ error });
        expect(result.issue[0].details.text).toContain('fallback');
    });

    test('sets severity to error and code to internal', () => {
        const error = new Error('test');
        const result = convertErrorToOperationOutcome({ error });
        expect(result.issue[0].severity).toBe('error');
        expect(result.issue[0].code).toBe('internal');
    });
});
