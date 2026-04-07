const { describe, test, expect } = require('@jest/globals');
const { ObjectId } = require('mongodb');
const { ResourceHistoryTransformer } = require('../../../consumers/mongoToClickHouseSync/transformers/resourceHistoryTransformer');

describe('ResourceHistoryTransformer', () => {
    const transformer = new ResourceHistoryTransformer();

    test('should transform a valid MongoDB history document', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
            resource: {
                resourceType: 'Person',
                id: 'aba5bcf41cf64435839cf0568c121843',
                meta: {
                    versionId: '5',
                    lastUpdated: '2025-05-21T07:39:41.822Z',
                    source: 'bwell'
                },
                name: [{ given: ['Test'] }],
                _uuid: '849cb4f0-033b-5d6e-a614-9bbbbb3ba11e',
                _sourceId: 'aba5bcf41cf64435839cf0568c121843'
            },
            request: {
                id: '654c5584-7a1d-4674-9580-15e229fdc344',
                method: 'POST',
                url: '/4_0_0/Person/aba5bcf41cf64435839cf0568c121843'
            },
            response: {
                status: '200'
            }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.resource_type).toBe('Person');
        expect(result.resource_uuid).toBe('849cb4f0-033b-5d6e-a614-9bbbbb3ba11e');
        expect(result.mongo_id).toBe('682d833de0f8c1253ef59c48');
        expect(result.last_updated).toBe('2025-05-21 07:39:41.822');
        expect(result.raw).toBeDefined();

        const parsed = JSON.parse(result.raw);
        expect(parsed.resource.resourceType).toBe('Person');
        expect(parsed.request.method).toBe('POST');
        expect(parsed.response.status).toBe('200');
    });

    test('should handle lastUpdated as Date object', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: 'test-uuid',
            resource: {
                resourceType: 'Patient',
                id: 'patient1',
                meta: {
                    versionId: '1',
                    lastUpdated: new Date('2025-05-21T07:39:41.822Z')
                }
            },
            request: { id: 'req-1', method: 'POST', url: '/Patient/patient1' }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.last_updated).toBe('2025-05-21 07:39:41.822');
    });

    test('should return null for missing resource', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: 'test-uuid'
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for missing resourceType', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: 'test-uuid',
            resource: {
                id: 'patient1',
                meta: { lastUpdated: '2025-05-21T07:39:41.822Z' }
            }
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for missing lastUpdated', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: 'test-uuid',
            resource: {
                resourceType: 'Patient',
                id: 'patient1',
                meta: { versionId: '1' }
            }
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for null doc', () => {
        expect(transformer.transform(null)).toBeNull();
        expect(transformer.transform(undefined)).toBeNull();
    });

    test('should fall back to resource._uuid when doc.id is missing', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resource: {
                resourceType: 'Observation',
                id: 'obs1',
                meta: {
                    versionId: '1',
                    lastUpdated: '2025-01-01T00:00:00.000Z'
                },
                _uuid: 'fallback-uuid-value'
            },
            request: { id: 'req-1', method: 'POST', url: '/Observation/obs1' }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.resource_uuid).toBe('fallback-uuid-value');
    });

    test('should include response in raw when present', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: 'test-uuid',
            resource: {
                resourceType: 'Patient',
                id: 'patient1',
                meta: { versionId: '1', lastUpdated: '2025-01-01T00:00:00.000Z' }
            },
            request: { id: 'req-1', method: 'POST', url: '/Patient/patient1' },
            response: {
                status: '200',
                outcome: {
                    resourceType: 'OperationOutcome',
                    issue: [{ severity: 'information', code: 'informational' }]
                }
            }
        };

        const result = transformer.transform(doc);
        const parsed = JSON.parse(result.raw);

        expect(parsed.response).toBeDefined();
        expect(parsed.response.status).toBe('200');
        expect(parsed.response.outcome.resourceType).toBe('OperationOutcome');
    });
});
