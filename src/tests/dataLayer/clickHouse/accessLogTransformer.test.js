'use strict';

const { describe, test, expect } = require('@jest/globals');
const { AccessLogTransformer } = require('../../../dataLayer/clickHouse/accessLogTransformer');

describe('AccessLogTransformer', () => {
    const transformer = new AccessLogTransformer();

    const baseDoc = () => ({
        timestamp: new Date('2024-06-15T10:30:00.000Z'),
        outcomeDesc: 'Success',
        agent: {
            altId: 'user-123',
            networkAddress: '10.0.0.1',
            scopes: 'user/*.read user/*.write'
        },
        details: {
            host: 'fhir.example.com',
            originService: 'patient-portal',
            operationResult: 'ok'
        },
        request: {
            id: 'req-abc',
            systemGeneratedRequestId: 'sys-req-xyz',
            url: '/4_0_0/Patient/123',
            resourceType: 'Patient',
            operation: 'read',
            method: 'GET',
            duration: 42
        }
    });

    describe('toClickHouseDateTime', () => {
        test('converts Date instance to ClickHouse DateTime64 format', () => {
            const result = transformer.toClickHouseDateTime(new Date('2024-06-15T10:30:00.000Z'));
            expect(result).toBe('2024-06-15 10:30:00.000');
        });

        test('converts ISO 8601 string to ClickHouse DateTime64 format', () => {
            const result = transformer.toClickHouseDateTime('2024-06-15T10:30:00.000Z');
            expect(result).toBe('2024-06-15 10:30:00.000');
        });
    });

    describe('normalizeScopes', () => {
        test('splits space-delimited scope string into array', () => {
            expect(transformer.normalizeScopes('user/*.read user/*.write')).toEqual([
                'user/*.read',
                'user/*.write'
            ]);
        });

        test('collapses runs of whitespace and drops empties', () => {
            expect(transformer.normalizeScopes('  user/*.read   user/*.write  ')).toEqual([
                'user/*.read',
                'user/*.write'
            ]);
        });

        test('returns array input filtered to strings', () => {
            expect(transformer.normalizeScopes(['a', 'b', 42, null, 'c'])).toEqual(['a', 'b', 'c']);
        });

        test('returns empty array for undefined or non-string/array values', () => {
            expect(transformer.normalizeScopes(undefined)).toEqual([]);
            expect(transformer.normalizeScopes(null)).toEqual([]);
            expect(transformer.normalizeScopes(123)).toEqual([]);
        });
    });

    describe('transformDocument', () => {
        test('produces a ClickHouse row for a valid access-log document', () => {
            const row = transformer.transformDocument(baseDoc());
            expect(row).not.toBeNull();
            expect(row.timestamp).toBe('2024-06-15 10:30:00.000');
            expect(row.outcome_desc).toBe('Success');
            expect(row.agent).toEqual({
                altId: 'user-123',
                networkAddress: '10.0.0.1',
                scopes: ['user/*.read', 'user/*.write']
            });
            expect(row.details).toEqual({
                host: 'fhir.example.com',
                originService: 'patient-portal',
                operationResult: 'ok'
            });
            expect(row.request.id).toBe('req-abc');
            expect(row).not.toHaveProperty('access_tags');
        });

        test('preserves already-array scopes', () => {
            const doc = baseDoc();
            doc.agent.scopes = ['patient/*.read', 'patient/*.write'];
            const row = transformer.transformDocument(doc);
            expect(row.agent.scopes).toEqual(['patient/*.read', 'patient/*.write']);
        });

        test('defaults outcome_desc to empty string when missing', () => {
            const doc = baseDoc();
            delete doc.outcomeDesc;
            const row = transformer.transformDocument(doc);
            expect(row.outcome_desc).toBe('');
        });

        test('defaults details to empty object when missing', () => {
            const doc = baseDoc();
            delete doc.details;
            const row = transformer.transformDocument(doc);
            expect(row.details).toEqual({});
        });

        test('defaults agent to empty object when missing', () => {
            const doc = baseDoc();
            delete doc.agent;
            const row = transformer.transformDocument(doc);
            expect(row.agent).toEqual({});
        });

        test('returns null when doc is null or undefined', () => {
            expect(transformer.transformDocument(null)).toBeNull();
            expect(transformer.transformDocument(undefined)).toBeNull();
        });

        test('returns null when timestamp is missing', () => {
            const doc = baseDoc();
            delete doc.timestamp;
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('returns null when request.id is missing', () => {
            const doc = baseDoc();
            delete doc.request.id;
            expect(transformer.transformDocument(doc)).toBeNull();
        });

        test('returns null when request is missing', () => {
            const doc = baseDoc();
            delete doc.request;
            expect(transformer.transformDocument(doc)).toBeNull();
        });
    });

    describe('transformBatch', () => {
        test('splits rows and skipped counts', () => {
            const good = baseDoc();
            const missingTimestamp = baseDoc();
            delete missingTimestamp.timestamp;
            const missingRequestId = baseDoc();
            delete missingRequestId.request.id;

            const result = transformer.transformBatch([good, missingTimestamp, missingRequestId, good]);
            expect(result.rows).toHaveLength(2);
            expect(result.skipped).toBe(2);
        });

        test('returns empty result for empty batch', () => {
            expect(transformer.transformBatch([])).toEqual({ rows: [], skipped: 0 });
        });
    });
});
