const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { AccessLogTransformer } = require('../../../../dataLayer/clickHouse/accessLogTransformer');

describe('AccessLogTransformer', () => {
    let transformer;

    beforeEach(() => {
        transformer = new AccessLogTransformer();
    });

    describe('toClickHouseDateTime', () => {
        test('converts ISO string to ClickHouse DateTime64 format', () => {
            const result = transformer.toClickHouseDateTime('2024-01-15T10:30:00.000Z');
            expect(result).toBe('2024-01-15 10:30:00.000');
        });

        test('converts Date object to ClickHouse DateTime64 format', () => {
            const date = new Date('2024-06-20T14:45:30.123Z');
            const result = transformer.toClickHouseDateTime(date);
            expect(result).toBe('2024-06-20 14:45:30.123');
        });

        test('handles midnight timestamp', () => {
            const result = transformer.toClickHouseDateTime('2024-12-31T00:00:00.000Z');
            expect(result).toBe('2024-12-31 00:00:00.000');
        });

        test('handles timestamp without milliseconds', () => {
            const result = transformer.toClickHouseDateTime('2024-01-01T12:00:00Z');
            expect(result).toBe('2024-01-01 12:00:00');
        });
    });

    describe('normalizeScopes', () => {
        test('returns array unchanged when input is array of strings', () => {
            const scopes = ['read', 'write', 'admin'];
            const result = transformer.normalizeScopes(scopes);
            expect(result).toEqual(['read', 'write', 'admin']);
        });

        test('filters non-string items from array', () => {
            const scopes = ['read', 123, null, 'write', undefined];
            const result = transformer.normalizeScopes(scopes);
            expect(result).toEqual(['read', 'write']);
        });

        test('splits space-delimited string into array', () => {
            const result = transformer.normalizeScopes('read write admin');
            expect(result).toEqual(['read', 'write', 'admin']);
        });

        test('handles multiple spaces between scope values', () => {
            const result = transformer.normalizeScopes('read   write   admin');
            expect(result).toEqual(['read', 'write', 'admin']);
        });

        test('handles tabs and mixed whitespace', () => {
            const result = transformer.normalizeScopes('read\twrite\n admin');
            expect(result).toEqual(['read', 'write', 'admin']);
        });

        test('returns empty array for empty string', () => {
            const result = transformer.normalizeScopes('');
            expect(result).toEqual([]);
        });

        test('returns empty array for whitespace-only string', () => {
            const result = transformer.normalizeScopes('   ');
            expect(result).toEqual([]);
        });

        test('returns empty array for undefined', () => {
            const result = transformer.normalizeScopes(undefined);
            expect(result).toEqual([]);
        });

        test('returns empty array for null', () => {
            const result = transformer.normalizeScopes(null);
            expect(result).toEqual([]);
        });

        test('returns empty array for number', () => {
            const result = transformer.normalizeScopes(42);
            expect(result).toEqual([]);
        });

        test('returns empty array for empty array', () => {
            const result = transformer.normalizeScopes([]);
            expect(result).toEqual([]);
        });
    });

    describe('transformDocument', () => {
        test('transforms a valid document with all fields', () => {
            const doc = {
                timestamp: '2024-01-15T10:30:00.000Z',
                request: { id: 'req-123', method: 'GET', url: '/Patient' },
                agent: { altId: 'user-1', scopes: 'read write' },
                outcomeDesc: 'Success',
                details: { statusCode: 200 }
            };
            const result = transformer.transformDocument(doc);
            expect(result).toEqual({
                timestamp: '2024-01-15 10:30:00.000',
                outcome_desc: 'Success',
                agent: { altId: 'user-1', scopes: ['read', 'write'] },
                details: { statusCode: 200 },
                request: { id: 'req-123', method: 'GET', url: '/Patient' }
            });
        });

        test('normalizes agent scopes from array', () => {
            const doc = {
                timestamp: '2024-01-15T10:30:00.000Z',
                request: { id: 'req-123' },
                agent: { scopes: ['scope1', 'scope2'] }
            };
            const result = transformer.transformDocument(doc);
            expect(result.agent.scopes).toEqual(['scope1', 'scope2']);
        });

        test('returns null for null doc', () => {
            expect(transformer.transformDocument(null)).toBeNull();
        });

        test('returns null for undefined doc', () => {
            expect(transformer.transformDocument(undefined)).toBeNull();
        });

        test('returns null for doc without timestamp', () => {
            const doc = { request: { id: 'req-123' } };
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('returns null for doc without request', () => {
            const doc = { timestamp: '2024-01-15T10:30:00.000Z' };
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('returns null for doc with request but no id', () => {
            const doc = { timestamp: '2024-01-15T10:30:00.000Z', request: { method: 'GET' } };
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('uses empty string for missing outcomeDesc', () => {
            const doc = {
                timestamp: '2024-01-15T10:30:00.000Z',
                request: { id: 'req-123' }
            };
            const result = transformer.transformDocument(doc);
            expect(result.outcome_desc).toBe('');
        });

        test('uses empty object for missing details', () => {
            const doc = {
                timestamp: '2024-01-15T10:30:00.000Z',
                request: { id: 'req-123' }
            };
            const result = transformer.transformDocument(doc);
            expect(result.details).toEqual({});
        });

        test('uses empty object for missing agent', () => {
            const doc = {
                timestamp: '2024-01-15T10:30:00.000Z',
                request: { id: 'req-123' }
            };
            const result = transformer.transformDocument(doc);
            expect(result.agent).toEqual({});
        });

        test('preserves request object as-is', () => {
            const request = { id: 'req-456', method: 'POST', url: '/Observation', headers: { 'content-type': 'application/json' } };
            const doc = {
                timestamp: '2024-01-15T10:30:00.000Z',
                request
            };
            const result = transformer.transformDocument(doc);
            expect(result.request).toBe(request);
        });
    });

    describe('transformBatch', () => {
        test('transforms all valid documents', () => {
            const docs = [
                { timestamp: '2024-01-15T10:30:00.000Z', request: { id: 'req-1' } },
                { timestamp: '2024-01-16T11:00:00.000Z', request: { id: 'req-2' } }
            ];
            const result = transformer.transformBatch(docs);
            expect(result.rows).toHaveLength(2);
            expect(result.skipped).toBe(0);
        });

        test('skips invalid documents and counts them', () => {
            const docs = [
                { timestamp: '2024-01-15T10:30:00.000Z', request: { id: 'req-1' } },
                null,
                { timestamp: '2024-01-16T11:00:00.000Z' }, // missing request
                { timestamp: '2024-01-17T12:00:00.000Z', request: { id: 'req-3' } }
            ];
            const result = transformer.transformBatch(docs);
            expect(result.rows).toHaveLength(2);
            expect(result.skipped).toBe(2);
        });

        test('returns empty rows and correct skipped count for all invalid docs', () => {
            const docs = [null, undefined, {}, { request: {} }];
            const result = transformer.transformBatch(docs);
            expect(result.rows).toHaveLength(0);
            expect(result.skipped).toBe(4);
        });

        test('handles empty array', () => {
            const result = transformer.transformBatch([]);
            expect(result.rows).toHaveLength(0);
            expect(result.skipped).toBe(0);
        });
    });
});
