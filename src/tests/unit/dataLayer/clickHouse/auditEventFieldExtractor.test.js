'use strict';

const { describe, test, expect } = require('@jest/globals');
const { AuditEventFieldExtractor } = require('../../../../dataLayer/clickHouse/auditEventFieldExtractor');

describe('AuditEventFieldExtractor', () => {
    const extractor = new AuditEventFieldExtractor();

    test('extract returns transformed row from plain object', () => {
        const resource = {
            id: 'ae-1',
            _uuid: 'AuditEvent/ae-1-uuid',
            recorded: '2024-06-15T10:30:00.000Z',
            action: 'R',
            agent: [
                { who: { _uuid: 'Practitioner/pract-uuid', reference: 'Practitioner/123' }, requestor: true }
            ],
            entity: [
                { what: { _uuid: 'Patient/patient-uuid', reference: 'Patient/456' } }
            ],
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                    { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
                ]
            },
            _sourceAssigningAuthority: 'org-1',
            _sourceId: 'AuditEvent/ae-1'
        };

        const row = extractor.extract(resource);
        expect(row).not.toBeNull();
        expect(row.id).toBe('ae-1');
        expect(row._uuid).toBe('AuditEvent/ae-1-uuid');
        expect(row.recorded).toBe('2024-06-15 10:30:00.000');
        expect(row.action).toBe('R');
        expect(row.agent_who).toEqual(['Practitioner/pract-uuid']);
        expect(row.entity_what).toEqual(['Patient/patient-uuid']);
        expect(row.agent_requestor_who).toBe('Practitioner/pract-uuid');
        expect(row.access_tags).toEqual(['client-a']);
        expect(row._sourceAssigningAuthority).toBe('org-1');
    });

    test('extract handles resource with toJSONInternal method', () => {
        const resource = {
            toJSONInternal: () => ({
                id: 'ae-2',
                _uuid: 'AuditEvent/ae-2-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                agent: [],
                entity: [],
                meta: { security: [] }
            })
        };

        const row = extractor.extract(resource);
        expect(row).not.toBeNull();
        expect(row.id).toBe('ae-2');
        expect(row._uuid).toBe('AuditEvent/ae-2-uuid');
    });

    test('extract returns null for resource missing _uuid', () => {
        const resource = { id: 'ae-3', recorded: '2024-01-01T00:00:00.000Z' };
        const row = extractor.extract(resource);
        expect(row).toBeNull();
    });

    test('extract returns null for resource missing recorded', () => {
        const resource = { id: 'ae-4', _uuid: 'AuditEvent/ae-4-uuid' };
        const row = extractor.extract(resource);
        expect(row).toBeNull();
    });
});
