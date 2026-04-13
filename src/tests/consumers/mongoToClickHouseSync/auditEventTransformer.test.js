const { describe, test, expect } = require('@jest/globals');
const { ObjectId } = require('mongodb');
const { AuditEventTransformer } = require('../../../consumers/mongoToClickHouseSync/transformers/auditEventTransformer');

describe('AuditEventTransformer', () => {
    const transformer = new AuditEventTransformer();

    test('should transform a valid AuditEvent document', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            id: 'audit-123',
            _uuid: 'audit-uuid-123',
            recorded: '2025-03-15T10:30:00.000Z',
            type: {
                coding: [{ system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110112', display: 'Query' }]
            },
            action: 'R',
            outcome: '0',
            agent: [{
                who: { reference: 'Practitioner/doc-1' },
                requestor: true
            }],
            source: {
                observer: { reference: 'Device/server-1' }
            },
            entity: [{
                what: { reference: 'Patient/patient-1' },
                type: { code: '1', display: 'Person' }
            }],
            meta: {
                lastUpdated: '2025-03-15T10:30:00.000Z',
                source: 'bwell',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
                ]
            }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.mongo_id).toBe('682d833de0f8c1253ef59c48');
        expect(result.resource_id).toBe('audit-123');
        expect(result.recorded).toBe('2025-03-15 10:30:00.000');
        expect(result.type_code).toBe('110112');
        expect(result.action).toBe('R');
        expect(result.outcome).toBe('0');
        expect(result.agent_who).toBe('Practitioner/doc-1');
        expect(result.source_observer).toBe('Device/server-1');
        expect(result.entity_what).toBe('Patient/patient-1');
        expect(result.access_tag).toBe('bwell');
        expect(result.owner_tag).toBe('bwell');
        expect(result.raw).toBeDefined();

        // raw should not contain _id
        const parsed = JSON.parse(result.raw);
        expect(parsed._id).toBeUndefined();
        expect(parsed.resourceType).toBe('AuditEvent');
        expect(parsed.id).toBe('audit-123');
    });

    test('should handle recorded as Date object', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            id: 'audit-456',
            _uuid: 'audit-uuid-456',
            recorded: new Date('2025-03-15T10:30:00.000Z'),
            meta: { security: [] }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.recorded).toBe('2025-03-15 10:30:00.000');
    });

    test('should fall back to _uuid when id is missing', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            _uuid: 'fallback-uuid',
            recorded: '2025-03-15T10:30:00.000Z',
            meta: { security: [] }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.resource_id).toBe('fallback-uuid');
    });

    test('should return null for missing resourceType', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            id: 'audit-123',
            recorded: '2025-03-15T10:30:00.000Z'
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for missing recorded', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            id: 'audit-123',
            _uuid: 'audit-uuid-123'
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for missing both id and _uuid', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            recorded: '2025-03-15T10:30:00.000Z'
        };

        const result = transformer.transform(doc);
        expect(result).toBeNull();
    });

    test('should return null for null doc', () => {
        expect(transformer.transform(null)).toBeNull();
        expect(transformer.transform(undefined)).toBeNull();
    });

    test('should handle missing optional fields gracefully', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            id: 'audit-minimal',
            _uuid: 'audit-uuid-minimal',
            recorded: '2025-03-15T10:30:00.000Z',
            meta: { security: [] }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.type_code).toBe('');
        expect(result.action).toBe('');
        expect(result.outcome).toBe('');
        expect(result.agent_who).toBe('');
        expect(result.source_observer).toBe('');
        expect(result.entity_what).toBe('');
        expect(result.access_tag).toBe('');
        expect(result.owner_tag).toBe('');
    });

    test('should handle type.code when type.coding is missing', () => {
        const doc = {
            _id: new ObjectId('682d833de0f8c1253ef59c48'),
            resourceType: 'AuditEvent',
            id: 'audit-123',
            _uuid: 'audit-uuid-123',
            recorded: '2025-03-15T10:30:00.000Z',
            type: { code: 'rest' },
            meta: { security: [] }
        };

        const result = transformer.transform(doc);

        expect(result).not.toBeNull();
        expect(result.type_code).toBe('rest');
    });
});
