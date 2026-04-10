const { describe, test, expect } = require('@jest/globals');
const { AuditEventTransformer } = require('../../scripts/lib/auditEventTransformer');
const { generateDailyPartitions } = require('../../scripts/lib/migrationStateManager');
const deepcopy = require('deepcopy');
const auditEventSample = require('./fixtures/audit_event_sample.json');

describe('AuditEvent Migration', () => {
    describe('AuditEventTransformer', () => {
        describe('transformDocument', () => {
            test('flattens a full AuditEvent document to ClickHouse row', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => '667890abcdef1234567890ab' };

                const row = transformer.transformDocument(doc);

                // Primary identifiers
                expect(row.mongo_id).toBe('667890abcdef1234567890ab');
                expect(row.last_updated).toBe('2024-06-15 10:30:00.000');

                // Scalars
                expect(row.recorded).toBe('2024-06-15 10:30:00.000');
                expect(row.action).toBe('E');
                expect(row.outcome).toBe('0');

                // Type
                expect(row.type_system).toBe('http://dicom.nema.org/resources/ontology/DCM');
                expect(row.type_code).toBe('110112');

                // Subtype
                expect(row.subtype_system).toEqual(['http://hl7.org/fhir/restful-interaction']);
                expect(row.subtype_code).toEqual(['search-type']);

                // Source
                expect(row.source_observer).toBe('Organization/bwell');
                expect(row.source_site).toBe('fhir-server-prod');

                // Agent (flattened from 2 agents)
                expect(row.agent_who).toEqual(['Practitioner/prac-123', 'Device/device-456']);
                expect(row.agent_name).toEqual(['Dr. Smith', 'FHIR Server']);
                expect(row.agent_altid).toEqual(['alt-prac-123']);
                expect(row.agent_role_code).toEqual(['110153']);
                expect(row.agent_role_system).toEqual(['http://dicom.nema.org/resources/ontology/DCM']);
                expect(row.agent_policy).toEqual(['urn:policy:consent-abc']);
                expect(row.agent_network_address).toEqual(['192.168.1.100', '10.0.0.1']);

                // Entity (flattened from 2 entities)
                expect(row.entity_what).toEqual(['Patient/patient-789', 'Encounter/enc-012']);
                expect(row.entity_name).toEqual(['Patient Search']);
                expect(row.entity_type_system).toEqual([
                    'http://hl7.org/fhir/resource-types',
                    'http://hl7.org/fhir/resource-types'
                ]);
                expect(row.entity_type_code).toEqual(['Patient', 'Encounter']);
                expect(row.entity_role_system).toEqual(['http://terminology.hl7.org/CodeSystem/object-role']);
                expect(row.entity_role_code).toEqual(['1']);

                // Raw JSON
                const raw = JSON.parse(row.raw);
                expect(raw.resourceType).toBe('AuditEvent');
                expect(raw.id).toBe('audit-001');
            });

            test('returns null for document missing id', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => 'abc123' };
                delete doc.id;
                delete doc._uuid;
                delete doc._sourceId;

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
                expect(row.action).toBe('');
                expect(row.outcome).toBe('');
                expect(row.type_system).toBe('');
                expect(row.type_code).toBe('');
                expect(row.subtype_system).toEqual([]);
                expect(row.subtype_code).toEqual([]);
                expect(row.agent_who).toEqual([]);
                expect(row.entity_what).toEqual([]);
            });
        });

        describe('transformBatch', () => {
            test('transforms array and tracks skipped docs', () => {
                const transformer = new AuditEventTransformer();
                const valid = deepcopy(auditEventSample);
                valid._id = { toString: () => 'aaa' };
                const invalid = { _id: { toString: () => 'bbb' } }; // missing id and recorded

                const { rows, skipped } = transformer.transformBatch([valid, invalid]);
                expect(rows).toHaveLength(1);
                expect(skipped).toBe(1);
                expect(rows[0].mongo_id).toBe('aaa');
            });
        });

        describe('toClickHouseDateTime', () => {
            test('converts ISO string', () => {
                const transformer = new AuditEventTransformer();
                expect(transformer.toClickHouseDateTime('2024-06-15T10:30:00.000Z')).toBe('2024-06-15 10:30:00.000');
            });

            test('converts Date object', () => {
                const transformer = new AuditEventTransformer();
                const result = transformer.toClickHouseDateTime(new Date('2024-01-01T00:00:00.000Z'));
                expect(result).toBe('2024-01-01 00:00:00.000');
            });
        });
    });

    describe('generateDailyPartitions', () => {
        test('generates correct daily range', () => {
            const days = generateDailyPartitions('2024-01-01', '2024-01-05');
            expect(days).toEqual([
                '2024-01-01',
                '2024-01-02',
                '2024-01-03',
                '2024-01-04'
            ]);
        });

        test('handles month boundary', () => {
            const days = generateDailyPartitions('2024-01-30', '2024-02-02');
            expect(days).toEqual([
                '2024-01-30',
                '2024-01-31',
                '2024-02-01'
            ]);
        });

        test('handles year boundary', () => {
            const days = generateDailyPartitions('2023-12-30', '2024-01-02');
            expect(days).toEqual([
                '2023-12-30',
                '2023-12-31',
                '2024-01-01'
            ]);
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
