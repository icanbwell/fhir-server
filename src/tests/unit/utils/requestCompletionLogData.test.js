'use strict';

const { describe, test, expect } = require('@jest/globals');
const { generateLogDetail } = require('../../../utils/requestCompletionLogData');

describe('requestCompletionLogData', () => {
    describe('generateLogDetail', () => {
        test('returns empty string for non-401/403 status codes', () => {
            expect(generateLogDetail({ authToken: 'x', scope: 's', statusCode: 200, username: 'u' })).toBe('');
            expect(generateLogDetail({ authToken: 'x', scope: 's', statusCode: 500, username: 'u' })).toBe('');
        });

        test('returns "No authorization token provided" for 401 without auth token', () => {
            const result = generateLogDetail({ authToken: '', scope: '', statusCode: 401, username: '' });
            expect(result).toBe('No authorization token provided');
        });

        test('returns "No authorization token provided" for 401 with null auth token', () => {
            const result = generateLogDetail({ authToken: null, scope: '', statusCode: 401, username: '' });
            expect(result).toBe('No authorization token provided');
        });

        test('returns "Expired token" for 401 with expired JWT', () => {
            const payload = { exp: Math.floor(Date.now() / 1000) - 3600 };
            const token = 'header.' + btoa(JSON.stringify(payload)) + '.signature';
            const result = generateLogDetail({
                authToken: `Bearer ${token}`, scope: '', statusCode: 401, username: ''
            });
            expect(result).toBe('Expired token');
        });

        test('returns "Invalid token" for 401 with valid non-expired JWT', () => {
            const payload = { exp: Math.floor(Date.now() / 1000) + 3600 };
            const token = 'header.' + btoa(JSON.stringify(payload)) + '.signature';
            const result = generateLogDetail({
                authToken: `Bearer ${token}`, scope: '', statusCode: 401, username: ''
            });
            expect(result).toBe('Invalid token');
        });

        test('returns "Invalid: ..." for 401 with malformed token', () => {
            const result = generateLogDetail({
                authToken: 'Bearer notavalidtoken', scope: '', statusCode: 401, username: ''
            });
            expect(result).toMatch(/^Invalid: /);
        });

        test('returns access denied message for 403', () => {
            const result = generateLogDetail({
                authToken: '', scope: 'patient/*.read', statusCode: 403, username: 'admin'
            });
            expect(result).toContain("User 'admin'");
            expect(result).toContain("'patient/*.read'");
            expect(result).toContain('denied access');
        });

        test('handles null scope for 403', () => {
            const result = generateLogDetail({
                authToken: '', scope: null, statusCode: 403, username: 'user1'
            });
            expect(result).toContain("User 'user1'");
        });
    });
});
