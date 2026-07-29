'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

const { AccessLogTransformer } = require('../../../dataLayer/clickHouse/accessLogTransformer');

describe('AccessLogTransformer', () => {
    let transformer;

    beforeEach(() => {
        transformer = new AccessLogTransformer();
    });

    describe('transformDocument - PHI passthrough', () => {
        test('SECURITY: agent field (containing JWT tokens) passed verbatim to ClickHouse', () => {
            const doc = {
                timestamp: '2024-01-01T00:00:00.000Z',
                request: { id: 'req-1', url: '/Patient' },
                agent: {
                    altId: 'user@example.com',
                    scopes: 'patient/*.read user/*.write',
                    token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.sensitive-jwt-payload'
                }
            };

            const result = transformer.transformDocument(doc);

            expect(result.agent.token).toBe(
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.sensitive-jwt-payload'
            );
        });

        test('SECURITY: request field (containing PHI in URLs) passed verbatim to ClickHouse', () => {
            const doc = {
                timestamp: '2024-01-01T00:00:00.000Z',
                request: {
                    id: 'req-1',
                    url: '/Patient?name=John%20Smith&birthdate=1990-01-01',
                    body: { resourceType: 'Patient', name: [{ given: ['John'], family: 'Smith' }] }
                },
                agent: {}
            };

            const result = transformer.transformDocument(doc);

            expect(result.request.url).toContain('name=John%20Smith');
            expect(result.request.body.name[0].family).toBe('Smith');
        });

        test('SECURITY: scopes from JWT exposed in agent field without redaction', () => {
            const doc = {
                timestamp: '2024-01-01T00:00:00.000Z',
                request: { id: 'req-1' },
                agent: {
                    scopes: 'patient/Patient.read patient/Observation.read admin/*.*'
                }
            };

            const result = transformer.transformDocument(doc);

            expect(result.agent.scopes).toContain('admin/*.*');
        });
    });

    describe('transformDocument - required field validation', () => {
        test('returns null for null document', () => {
            expect(transformer.transformDocument(null)).toBeNull();
        });

        test('returns null for document without timestamp', () => {
            const doc = { request: { id: 'req-1' } };
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('returns null for document without request.id', () => {
            const doc = { timestamp: '2024-01-01T00:00:00.000Z', request: {} };
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('returns null for document without request', () => {
            const doc = { timestamp: '2024-01-01T00:00:00.000Z' };
            expect(transformer.transformDocument(doc)).toBeNull();
        });
    });

    describe('toClickHouseDateTime', () => {
        test('converts ISO string to ClickHouse format', () => {
            expect(transformer.toClickHouseDateTime('2024-03-15T14:30:45.123Z')).toBe(
                '2024-03-15 14:30:45.123'
            );
        });

        test('converts Date object to ClickHouse format', () => {
            const date = new Date('2024-06-01T09:00:00.000Z');
            expect(transformer.toClickHouseDateTime(date)).toBe('2024-06-01 09:00:00.000');
        });
    });

    describe('normalizeScopes', () => {
        test('splits space-delimited string into array', () => {
            expect(transformer.normalizeScopes('read write admin')).toEqual([
                'read',
                'write',
                'admin'
            ]);
        });

        test('passes through arrays', () => {
            expect(transformer.normalizeScopes(['a', 'b'])).toEqual(['a', 'b']);
        });

        test('returns empty array for undefined', () => {
            expect(transformer.normalizeScopes(undefined)).toEqual([]);
        });

        test('filters non-string values from arrays', () => {
            expect(transformer.normalizeScopes(['valid', 123, null, 'also-valid'])).toEqual([
                'valid',
                'also-valid'
            ]);
        });
    });

    describe('transformBatch', () => {
        test('transforms valid documents and counts skipped ones', () => {
            const docs = [
                { timestamp: '2024-01-01T00:00:00Z', request: { id: 'r1' } },
                null,
                { timestamp: '2024-01-02T00:00:00Z', request: { id: 'r2' } },
                { request: { id: 'r3' } }
            ];

            const { rows, skipped } = transformer.transformBatch(docs);

            expect(rows).toHaveLength(2);
            expect(skipped).toBe(2);
        });

        test('SECURITY: batch processing does not filter sensitive data from valid documents', () => {
            const docs = [
                {
                    timestamp: '2024-01-01T00:00:00Z',
                    request: { id: 'r1', url: '/Patient?ssn=123-45-6789' },
                    agent: { token: 'Bearer secret-token' }
                }
            ];

            const { rows } = transformer.transformBatch(docs);

            expect(rows[0].request.url).toContain('ssn=123-45-6789');
            expect(rows[0].agent.token).toBe('Bearer secret-token');
        });
    });
});
