const { describe, test, expect } = require('@jest/globals');
const { ObjectId } = require('mongodb');
const { AccessLogsTransformer } = require('../../../consumers/mongoToClickHouseSync/transformers/accessLogsTransformer');

describe('AccessLogsTransformer', () => {
    const transformer = new AccessLogsTransformer();

    test('should transform a valid access log document', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            timestamp: '2025-03-15T10:30:00.000Z',
            outcomeDesc: 'Success',
            agent: {
                altId: 'user@example.com',
                networkAddress: '::ffff:127.0.0.1',
                scopes: 'user/*.read'
            },
            details: {
                version: '1.0.0',
                host: 'localhost',
                contentType: 'application/json'
            },
            request: {
                id: 'req-123',
                systemGeneratedRequestId: 'sys-uuid-123',
                url: '/4_0_0/Patient/123',
                method: 'GET',
                resourceType: 'Patient',
                operation: 'READ',
                duration: 150,
                start: '2025-03-15T10:30:00.000Z',
                end: '2025-03-15T10:30:00.150Z'
            }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.mongo_id).toBe('682d833de0f8c1253ef59c48');
        expect(result.timestamp).toBe('2025-03-15 10:30:00.000');
        expect(result.method).toBe('GET');
        expect(result.url).toBe('/4_0_0/Patient/123');
        expect(result.resource_type).toBe('Patient');
        expect(result.operation).toBe('READ');
        expect(result.duration).toBe(150);
        expect(result.outcome).toBe('Success');
        expect(result.agent_alt_id).toBe('user@example.com');
        expect(result.network_address).toBe('::ffff:127.0.0.1');
        expect(result.request_id).toBe('sys-uuid-123');
        expect(result.raw).toBeDefined();

        const parsed = JSON.parse(result.raw);
        expect(parsed.request.method).toBe('GET');
        expect(parsed.agent.altId).toBe('user@example.com');
    });

    test('should handle timestamp as Date object', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            timestamp: new Date('2025-03-15T10:30:00.000Z'),
            request: { method: 'GET' }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.timestamp).toBe('2025-03-15 10:30:00.000');
    });

    test('should return null for missing timestamp', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            outcomeDesc: 'Success',
            request: { method: 'GET' }
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for null doc', () => {
        expect(transformer.transform(null)).toBeNull();
        expect(transformer.transform(undefined)).toBeNull();
    });

    test('should return null for missing _id', () => {
        const doc = {
            timestamp: '2025-03-15T10:30:00.000Z',
            request: { method: 'GET' }
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should handle missing optional fields gracefully', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            timestamp: '2025-03-15T10:30:00.000Z'
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.method).toBe('');
        expect(result.url).toBe('');
        expect(result.resource_type).toBe('');
        expect(result.operation).toBe('');
        expect(result.duration).toBe(0);
        expect(result.outcome).toBe('');
        expect(result.agent_alt_id).toBe('');
        expect(result.network_address).toBe('');
        expect(result.request_id).toBe('');
    });
});
