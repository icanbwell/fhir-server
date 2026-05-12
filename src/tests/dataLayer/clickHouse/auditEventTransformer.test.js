'use strict';

const { describe, test, expect } = require('@jest/globals');
const { AuditEventTransformer } = require('../../../dataLayer/clickHouse/auditEventTransformer');
const deepcopy = require('deepcopy');
const auditEventSample = require('../../scripts/fixtures/audit_event_sample.json');

describe('AuditEventTransformer', () => {
    describe('transformDocument', () => {
        test('transforms a full AuditEvent document to ClickHouse row matching RFC schema', () => {
            const transformer = new AuditEventTransformer();
            const doc = deepcopy(auditEventSample);
            doc._id = { toString: () => '667890abcdef1234567890ab' };

            const row = transformer.transformDocument(doc);

            expect(row.id).toBe('audit-001');
            expect(row._uuid).toBe('audit-uuid-001');
            expect(row.recorded).toBe('2024-06-15 10:30:00.000');
            expect(row.action).toBe('E');

            expect(row.agent_who).toEqual([
                'Practitioner/prac-uuid-123',
                'Device/device-uuid-456'
            ]);
            expect(row.agent_altid).toEqual(['alt-prac-123']);

            expect(row.entity_what).toEqual([
                'Patient/patient-uuid-789',
                'Encounter/enc-uuid-012'
            ]);

            expect(row.agent_requestor_who).toBe('Practitioner/prac-uuid-123');

            expect(row.purpose_of_event).toEqual([
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
            ]);

            expect(row.meta_security).toEqual([
                { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
            ]);

            expect(row._sourceAssigningAuthority).toBe('bwell');
            expect(row._sourceId).toBe('audit-001');

            expect(row.resource).toEqual(doc);
            expect(row.resource.resourceType).toBe('AuditEvent');
            expect(row.resource.id).toBe('audit-001');
        });

        test('emits an empty _uuid for a doc missing _uuid (CH insert will reject)', () => {
            const transformer = new AuditEventTransformer();
            const doc = deepcopy(auditEventSample);
            doc._id = { toString: () => 'abc123' };
            delete doc._uuid;

            const row = transformer.transformDocument(doc);
            expect(row).not.toBeNull();
            expect(row._uuid).toBeUndefined();
        });

        test('throws when recorded is missing (toClickHouseDateTime cannot format)', () => {
            const transformer = new AuditEventTransformer();
            const doc = deepcopy(auditEventSample);
            doc._id = { toString: () => 'abc123' };
            delete doc.recorded;

            expect(() => transformer.transformDocument(doc)).toThrow();
        });

        test('handles missing optional fields with defaults', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                resourceType: 'AuditEvent',
                id: 'minimal-audit',
                _uuid: 'minimal-uuid',
                meta: { lastUpdated: '2024-01-01T00:00:00.000Z' },
                recorded: '2024-01-01T00:00:00.000Z'
            };

            const row = transformer.transformDocument(doc);

            expect(row).not.toBeNull();
            expect(row.id).toBe('minimal-audit');
            expect(row._uuid).toBe('minimal-uuid');
            expect(row.action).toBe('');
            expect(row.agent_who).toEqual([]);
            expect(row.agent_altid).toEqual([]);
            expect(row.entity_what).toEqual([]);
            expect(row.agent_requestor_who).toBe('');
            expect(row.purpose_of_event).toEqual([]);
            expect(row.meta_security).toEqual([]);
            expect(row._sourceAssigningAuthority).toBe('');
            expect(row._sourceId).toBe('');
        });

        test('prefers _uuid over reference in agent.who', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                agent: [
                    {
                        who: {
                            reference: 'Practitioner/local-id',
                            _uuid: 'Practitioner/global-uuid'
                        }
                    }
                ]
            };

            const row = transformer.transformDocument(doc);
            expect(row.agent_who).toEqual(['Practitioner/global-uuid']);
        });

        test('falls back to reference when _uuid is absent', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                agent: [{ who: { reference: 'Practitioner/local-id' } }],
                entity: [{ what: { reference: 'Patient/local-patient' } }]
            };

            const row = transformer.transformDocument(doc);
            expect(row.agent_who).toEqual(['Practitioner/local-id']);
            expect(row.entity_what).toEqual(['Patient/local-patient']);
        });

        test('extracts agent_requestor_who from agent with requestor=true', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                agent: [
                    { who: { _uuid: 'Device/dev-1' }, requestor: false },
                    { who: { _uuid: 'Practitioner/prac-1' }, requestor: true }
                ]
            };

            const row = transformer.transformDocument(doc);
            expect(row.agent_requestor_who).toBe('Practitioner/prac-1');
        });

        test('returns empty string for agent_requestor_who when no requestor', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                agent: [{ who: { _uuid: 'Device/dev-1' }, requestor: false }]
            };

            const row = transformer.transformDocument(doc);
            expect(row.agent_requestor_who).toBe('');
        });

        test('extracts meta_security as tuples', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                        { system: 'https://www.icanbwell.com/access', code: 'client' }
                    ]
                }
            };

            const row = transformer.transformDocument(doc);
            expect(row.meta_security).toEqual([
                { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                { system: 'https://www.icanbwell.com/access', code: 'client' }
            ]);
        });

        test('extracts purpose_of_event from purposeOfEvent codings', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                purposeOfEvent: [
                    {
                        coding: [
                            { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT', display: 'treatment' },
                            { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HOPERAT', display: 'healthcare operations' }
                        ]
                    },
                    {
                        coding: [
                            { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATRQT', display: 'patient requested' }
                        ]
                    }
                ]
            };

            const row = transformer.transformDocument(doc);
            expect(row.purpose_of_event).toEqual([
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' },
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HOPERAT' },
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATRQT' }
            ]);
        });

        test('skips purposeOfEvent codings missing system or code', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                purposeOfEvent: [
                    {
                        coding: [
                            { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' },
                            { system: 'missing-code' },
                            { code: 'missing-system' }
                        ]
                    },
                    { text: 'no coding array' }
                ]
            };

            const row = transformer.transformDocument(doc);
            expect(row.purpose_of_event).toEqual([
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
            ]);
        });

        test('skips security tags missing system or code', () => {
            const transformer = new AuditEventTransformer();
            const doc = {
                _id: { toString: () => 'abc123' },
                _uuid: 'test-uuid',
                recorded: '2024-01-01T00:00:00.000Z',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                        { system: 'missing-code' },
                        { code: 'missing-system' }
                    ]
                }
            };

            const row = transformer.transformDocument(doc);
            expect(row.meta_security).toEqual([{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]);
        });
    });

    describe('transformBatch', () => {
        test('transforms every valid doc and reports skipped=0', () => {
            const transformer = new AuditEventTransformer();
            const a = deepcopy(auditEventSample);
            a._id = { toString: () => 'aaa' };
            const b = deepcopy(auditEventSample);
            b._id = { toString: () => 'bbb' };
            b._uuid = 'audit-uuid-002';

            const { rows, skipped } = transformer.transformBatch([a, b]);
            expect(rows).toHaveLength(2);
            expect(skipped).toBe(0);
            expect(rows[0]._uuid).toBe('audit-uuid-001');
            expect(rows[1]._uuid).toBe('audit-uuid-002');
        });

        test('propagates the underlying error when a doc is missing recorded', () => {
            const transformer = new AuditEventTransformer();
            const valid = deepcopy(auditEventSample);
            const invalid = { _id: { toString: () => 'bbb' }, _uuid: 'u' };

            expect(() => transformer.transformBatch([valid, invalid])).toThrow();
        });
    });

    describe('toClickHouseDateTime', () => {
        test('converts ISO string', () => {
            const transformer = new AuditEventTransformer();
            expect(transformer.toClickHouseDateTime('2024-06-15T10:30:00.000Z')).toBe(
                '2024-06-15 10:30:00.000'
            );
        });

        test('converts Date object', () => {
            const transformer = new AuditEventTransformer();
            const result = transformer.toClickHouseDateTime(
                new Date('2024-01-01T00:00:00.000Z')
            );
            expect(result).toBe('2024-01-01 00:00:00.000');
        });
    });
});
