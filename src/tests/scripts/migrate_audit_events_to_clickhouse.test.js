const { describe, test, expect } = require('@jest/globals');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { generateDailyPartitions } = require('../../admin/utils/migrationStateManager');
const deepcopy = require('deepcopy');
const auditEventSample = require('./fixtures/audit_event_sample.json');

describe('AuditEvent Migration', () => {
    describe('AuditEventTransformer', () => {
        describe('transformDocument', () => {
            test('transforms a full AuditEvent document to ClickHouse row matching RFC schema', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => '667890abcdef1234567890ab' };

                const row = transformer.transformDocument(doc);

                // Resource identifiers
                expect(row.id).toBe('audit-001');
                expect(row._uuid).toBe('audit-uuid-001');

                // Primary search param
                expect(row.recorded).toBe('2024-06-15 10:30:00.000');

                // Frequently filtered
                expect(row.action).toBe('E');

                // Agent references — prefers _uuid over reference
                expect(row.agent_who).toEqual([
                    'Practitioner/prac-uuid-123',
                    'Device/device-uuid-456'
                ]);
                expect(row.agent_altid).toEqual(['alt-prac-123']);

                // Entity references — prefers _uuid over reference
                expect(row.entity_what).toEqual([
                    'Patient/patient-uuid-789',
                    'Encounter/enc-uuid-012'
                ]);

                // Agent requestor (agent where requestor === true)
                expect(row.agent_requestor_who).toBe('Practitioner/prac-uuid-123');

                // purposeOfEvent as Array(Tuple(system, code)) — promoted from resource JSON
                expect(row.purpose_of_event).toEqual([
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
                ]);

                // meta.security as Array(Tuple(system, code)) — named objects for JSONEachRow
                expect(row.meta_security).toEqual([
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
                ]);

                // b.well internal columns
                expect(row._sourceAssigningAuthority).toBe('bwell');
                expect(row._sourceId).toBe('audit-001');

                // resource is the full document object (Native JSON, not stringified)
                expect(row.resource).toEqual(doc);
                expect(row.resource.resourceType).toBe('AuditEvent');
                expect(row.resource.id).toBe('audit-001');
            });

            test('returns null for document missing _uuid', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => 'abc123' };
                delete doc._uuid;

                const row = transformer.transformDocument(doc);
                expect(row).toBeNull();
            });

            test('returns null for document missing recorded', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => 'abc123' };
                delete doc.recorded;

                const row = transformer.transformDocument(doc);
                expect(row).toBeNull();
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
            test('transforms array and tracks skipped docs', () => {
                const transformer = new AuditEventTransformer();
                const valid = deepcopy(auditEventSample);
                valid._id = { toString: () => 'aaa' };
                const invalid = { _id: { toString: () => 'bbb' } }; // missing _uuid and recorded

                const { rows, skipped } = transformer.transformBatch([valid, invalid]);
                expect(rows).toHaveLength(1);
                expect(skipped).toBe(1);
                expect(rows[0]._uuid).toBe('audit-uuid-001');
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

    describe('generateDailyPartitions', () => {
        test('generates correct daily range', () => {
            const days = generateDailyPartitions('2024-01-01', '2024-01-05');
            expect(days).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']);
        });

        test('handles month boundary', () => {
            const days = generateDailyPartitions('2024-01-30', '2024-02-02');
            expect(days).toEqual(['2024-01-30', '2024-01-31', '2024-02-01']);
        });

        test('handles year boundary', () => {
            const days = generateDailyPartitions('2023-12-30', '2024-01-02');
            expect(days).toEqual(['2023-12-30', '2023-12-31', '2024-01-01']);
        });

        test('returns empty for same start and end', () => {
            const days = generateDailyPartitions('2024-01-01', '2024-01-01');
            expect(days).toEqual([]);
        });

        test('generates correct count for full date range', () => {
            const days = generateDailyPartitions('2022-01-01', '2026-04-01');
            // Jan 2022 to Mar 2026 inclusive = 1552 days
            expect(days.length).toBeGreaterThan(1500);
            expect(days.length).toBeLessThan(1600);
            expect(days[0]).toBe('2022-01-01');
            expect(days[days.length - 1]).toBe('2026-03-31');
        });
    });
});
