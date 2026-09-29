const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { AuditEventTransformer } = require('../../../../dataLayer/clickHouse/auditEventTransformer');

describe('AuditEventTransformer', () => {
    let transformer;

    beforeEach(() => {
        transformer = new AuditEventTransformer();
    });

    describe('toClickHouseDateTime', () => {
        test('converts ISO string to ClickHouse DateTime64 format', () => {
            const result = transformer.toClickHouseDateTime('2024-03-20T08:15:30.500Z');
            expect(result).toBe('2024-03-20 08:15:30.500');
        });

        test('converts Date object to ClickHouse DateTime64 format', () => {
            const date = new Date('2024-11-05T23:59:59.999Z');
            const result = transformer.toClickHouseDateTime(date);
            expect(result).toBe('2024-11-05 23:59:59.999');
        });

        test('replaces T and Z in ISO format', () => {
            const result = transformer.toClickHouseDateTime('2024-01-01T00:00:00.000Z');
            expect(result).not.toContain('T');
            expect(result).not.toContain('Z');
        });
    });

    describe('extractReference', () => {
        test('prefers _uuid over reference', () => {
            const ref = { _uuid: 'Practitioner/uuid-123', reference: 'Practitioner/local-456' };
            expect(transformer.extractReference(ref)).toBe('Practitioner/uuid-123');
        });

        test('falls back to reference when _uuid is absent', () => {
            const ref = { reference: 'Patient/local-789' };
            expect(transformer.extractReference(ref)).toBe('Patient/local-789');
        });

        test('returns empty string for undefined ref', () => {
            expect(transformer.extractReference(undefined)).toBe('');
        });

        test('returns empty string for null ref', () => {
            expect(transformer.extractReference(null)).toBe('');
        });

        test('returns empty string when both _uuid and reference are absent', () => {
            expect(transformer.extractReference({})).toBe('');
        });

        test('returns empty string for empty _uuid with no reference', () => {
            expect(transformer.extractReference({ _uuid: '' })).toBe('');
        });

        test('prefers _uuid even when it is truthy and reference also exists', () => {
            const ref = { _uuid: 'Device/uuid-1', reference: 'Device/ref-1' };
            expect(transformer.extractReference(ref)).toBe('Device/uuid-1');
        });
    });

    describe('collectFromArray', () => {
        test('collects non-empty values using extractor', () => {
            const arr = [{ name: 'a' }, { name: 'b' }, { name: '' }];
            const result = transformer.collectFromArray(arr, (item) => item.name);
            expect(result).toEqual(['a', 'b']);
        });

        test('returns empty array for non-array input', () => {
            expect(transformer.collectFromArray(undefined, (x) => x)).toEqual([]);
            expect(transformer.collectFromArray(null, (x) => x)).toEqual([]);
            expect(transformer.collectFromArray('string', (x) => x)).toEqual([]);
        });

        test('returns empty array when all extracted values are falsy', () => {
            const arr = [{ val: '' }, { val: null }, { val: undefined }];
            const result = transformer.collectFromArray(arr, (item) => item.val);
            expect(result).toEqual([]);
        });

        test('returns empty array for empty input array', () => {
            expect(transformer.collectFromArray([], (x) => x)).toEqual([]);
        });
    });

    describe('extractRequestorWho', () => {
        test('extracts _uuid from the requestor agent', () => {
            const agents = [
                { requestor: false, who: { _uuid: 'Practitioner/non-requestor' } },
                { requestor: true, who: { _uuid: 'Practitioner/uuid-requestor', reference: 'Practitioner/ref-requestor' } }
            ];
            expect(transformer.extractRequestorWho(agents)).toBe('Practitioner/uuid-requestor');
        });

        test('falls back to reference when _uuid is absent on requestor', () => {
            const agents = [
                { requestor: true, who: { reference: 'Practitioner/ref-only' } }
            ];
            expect(transformer.extractRequestorWho(agents)).toBe('Practitioner/ref-only');
        });

        test('returns empty string when no agent is requestor', () => {
            const agents = [
                { requestor: false, who: { _uuid: 'Practitioner/p1' } }
            ];
            expect(transformer.extractRequestorWho(agents)).toBe('');
        });

        test('returns empty string when requestor has no who', () => {
            const agents = [{ requestor: true }];
            expect(transformer.extractRequestorWho(agents)).toBe('');
        });

        test('returns empty string for non-array input', () => {
            expect(transformer.extractRequestorWho(undefined)).toBe('');
            expect(transformer.extractRequestorWho(null)).toBe('');
            expect(transformer.extractRequestorWho({})).toBe('');
        });

        test('returns empty string for empty array', () => {
            expect(transformer.extractRequestorWho([])).toBe('');
        });

        test('does not match truthy but non-true requestor values', () => {
            const agents = [{ requestor: 1, who: { _uuid: 'Practitioner/truthy' } }];
            expect(transformer.extractRequestorWho(agents)).toBe('');
        });
    });

    describe('extractMetaSecurity', () => {
        test('extracts system/code tuples from security array', () => {
            const security = [
                { system: 'https://www.icanbwell.com/access', code: 'client1' },
                { system: 'https://www.icanbwell.com/owner', code: 'owner1' }
            ];
            const result = transformer.extractMetaSecurity(security);
            expect(result).toEqual([
                { system: 'https://www.icanbwell.com/access', code: 'client1' },
                { system: 'https://www.icanbwell.com/owner', code: 'owner1' }
            ]);
        });

        test('skips entries missing system', () => {
            const security = [
                { code: 'orphan' },
                { system: 'https://www.icanbwell.com/access', code: 'valid' }
            ];
            const result = transformer.extractMetaSecurity(security);
            expect(result).toEqual([{ system: 'https://www.icanbwell.com/access', code: 'valid' }]);
        });

        test('skips entries missing code', () => {
            const security = [
                { system: 'https://www.icanbwell.com/access' },
                { system: 'https://www.icanbwell.com/owner', code: 'valid' }
            ];
            const result = transformer.extractMetaSecurity(security);
            expect(result).toEqual([{ system: 'https://www.icanbwell.com/owner', code: 'valid' }]);
        });

        test('returns empty array for non-array input', () => {
            expect(transformer.extractMetaSecurity(undefined)).toEqual([]);
            expect(transformer.extractMetaSecurity(null)).toEqual([]);
            expect(transformer.extractMetaSecurity('string')).toEqual([]);
        });

        test('returns empty array for empty array', () => {
            expect(transformer.extractMetaSecurity([])).toEqual([]);
        });
    });

    describe('extractPurposeOfEvent', () => {
        test('flattens codings from multiple CodeableConcepts', () => {
            const purposeOfEvent = [
                { coding: [{ system: 'http://hl7.org/fhir', code: 'TREAT' }] },
                { coding: [{ system: 'http://hl7.org/fhir', code: 'HPAYMT' }, { system: 'http://custom', code: 'BILLING' }] }
            ];
            const result = transformer.extractPurposeOfEvent(purposeOfEvent);
            expect(result).toEqual([
                { system: 'http://hl7.org/fhir', code: 'TREAT' },
                { system: 'http://hl7.org/fhir', code: 'HPAYMT' },
                { system: 'http://custom', code: 'BILLING' }
            ]);
        });

        test('skips CodeableConcepts without coding array', () => {
            const purposeOfEvent = [
                { text: 'Treatment' },
                { coding: [{ system: 'http://hl7.org/fhir', code: 'TREAT' }] }
            ];
            const result = transformer.extractPurposeOfEvent(purposeOfEvent);
            expect(result).toEqual([{ system: 'http://hl7.org/fhir', code: 'TREAT' }]);
        });

        test('skips codings missing system or code', () => {
            const purposeOfEvent = [
                { coding: [{ system: 'sys1' }, { code: 'code1' }, { system: 'sys2', code: 'code2' }] }
            ];
            const result = transformer.extractPurposeOfEvent(purposeOfEvent);
            expect(result).toEqual([{ system: 'sys2', code: 'code2' }]);
        });

        test('returns empty array for non-array input', () => {
            expect(transformer.extractPurposeOfEvent(undefined)).toEqual([]);
            expect(transformer.extractPurposeOfEvent(null)).toEqual([]);
        });

        test('returns empty array for empty array', () => {
            expect(transformer.extractPurposeOfEvent([])).toEqual([]);
        });
    });

    describe('transformDocument', () => {
        const baseDoc = {
            id: 'audit-1',
            _uuid: 'AuditEvent/uuid-1',
            recorded: '2024-03-15T10:00:00.000Z',
            action: 'R',
            agent: [
                {
                    requestor: true,
                    who: { _uuid: 'Practitioner/uuid-agent-1', reference: 'Practitioner/ref-1' },
                    altId: 'alt-1'
                }
            ],
            entity: [
                { what: { _uuid: 'Patient/uuid-entity-1', reference: 'Patient/ref-entity-1' } }
            ],
            purposeOfEvent: [
                { coding: [{ system: 'http://hl7.org/fhir', code: 'TREAT' }] }
            ],
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                    { system: 'https://www.icanbwell.com/owner', code: 'owner-x' }
                ]
            },
            _sourceAssigningAuthority: 'authority-1',
            _sourceId: 'source-1'
        };

        test('transforms a full AuditEvent document correctly', () => {
            const result = transformer.transformDocument(baseDoc);
            expect(result.id).toBe('audit-1');
            expect(result._uuid).toBe('AuditEvent/uuid-1');
            expect(result.recorded).toBe('2024-03-15 10:00:00.000');
            expect(result.action).toBe('R');
            expect(result.agent_who).toEqual(['Practitioner/uuid-agent-1']);
            expect(result.agent_altid).toEqual(['alt-1']);
            expect(result.entity_what).toEqual(['Patient/uuid-entity-1']);
            expect(result.agent_requestor_who).toBe('Practitioner/uuid-agent-1');
            expect(result.purpose_of_event).toEqual([{ system: 'http://hl7.org/fhir', code: 'TREAT' }]);
            expect(result.meta_security).toEqual([
                { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                { system: 'https://www.icanbwell.com/owner', code: 'owner-x' }
            ]);
            expect(result.access_tags).toEqual(['client-a']);
            expect(result._sourceAssigningAuthority).toBe('authority-1');
            expect(result._sourceId).toBe('source-1');
            expect(result.resource).toBe(baseDoc);
        });

        test('throws when recorded is missing (toClickHouseDateTime cannot format)', () => {
            const doc = { ...baseDoc };
            delete doc.recorded;
            expect(() => transformer.transformDocument(doc)).toThrow();
        });

        test('handles missing optional fields gracefully', () => {
            const doc = {
                _uuid: 'AuditEvent/uuid-2',
                recorded: '2024-01-01T00:00:00.000Z'
            };
            const result = transformer.transformDocument(doc);
            expect(result.id).toBe('');
            expect(result.action).toBe('');
            expect(result.agent_who).toEqual([]);
            expect(result.agent_altid).toEqual([]);
            expect(result.entity_what).toEqual([]);
            expect(result.agent_requestor_who).toBe('');
            expect(result.purpose_of_event).toEqual([]);
            expect(result.meta_security).toEqual([]);
            expect(result.access_tags).toEqual([]);
            expect(result._sourceAssigningAuthority).toBe('');
            expect(result._sourceId).toBe('');
        });

        test('filters access_tags to only access system tags', () => {
            const doc = {
                _uuid: 'AuditEvent/uuid-3',
                recorded: '2024-01-01T00:00:00.000Z',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client-x' },
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-y' },
                        { system: 'https://www.icanbwell.com/access', code: 'client-z' }
                    ]
                }
            };
            const result = transformer.transformDocument(doc);
            expect(result.access_tags).toEqual(['client-x', 'client-z']);
        });

        test('handles multiple agents and entities', () => {
            const doc = {
                _uuid: 'AuditEvent/uuid-4',
                recorded: '2024-01-01T00:00:00.000Z',
                agent: [
                    { who: { _uuid: 'Practitioner/p1' }, altId: 'alt1', requestor: false },
                    { who: { reference: 'Device/d1' }, altId: 'alt2', requestor: true },
                    { who: { _uuid: 'Organization/o1' }, requestor: false }
                ],
                entity: [
                    { what: { _uuid: 'Patient/pat1' } },
                    { what: { reference: 'Encounter/enc1' } },
                    { what: {} }
                ]
            };
            const result = transformer.transformDocument(doc);
            expect(result.agent_who).toEqual(['Practitioner/p1', 'Device/d1', 'Organization/o1']);
            expect(result.agent_altid).toEqual(['alt1', 'alt2']);
            expect(result.entity_what).toEqual(['Patient/pat1', 'Encounter/enc1']);
            expect(result.agent_requestor_who).toBe('Device/d1');
        });

        test('stores the original doc as resource', () => {
            const doc = { _uuid: 'AuditEvent/x', recorded: '2024-01-01T00:00:00.000Z', custom: 'field' };
            const result = transformer.transformDocument(doc);
            expect(result.resource).toBe(doc);
        });
    });

    describe('transformBatch', () => {
        test('propagates the underlying error when a doc is missing recorded', () => {
            const valid = { _uuid: 'AuditEvent/uuid-1', recorded: '2024-01-01T00:00:00.000Z' };
            const invalid = { _uuid: 'AuditEvent/uuid-2' };
            expect(() => transformer.transformBatch([valid, invalid])).toThrow();
        });

        test('transforms all documents in the batch', () => {
            const docs = [
                { _uuid: 'AuditEvent/uuid-1', recorded: '2024-01-01T00:00:00.000Z', action: 'C' },
                { _uuid: 'AuditEvent/uuid-2', recorded: '2024-01-02T00:00:00.000Z', action: 'R' }
            ];
            const result = transformer.transformBatch(docs);
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]._uuid).toBe('AuditEvent/uuid-1');
            expect(result.rows[1]._uuid).toBe('AuditEvent/uuid-2');
        });

        test('always returns skipped as 0', () => {
            const docs = [
                { _uuid: 'AuditEvent/uuid-1', recorded: '2024-01-01T00:00:00.000Z' }
            ];
            const result = transformer.transformBatch(docs);
            expect(result.skipped).toBe(0);
        });

        test('handles empty batch', () => {
            const result = transformer.transformBatch([]);
            expect(result.rows).toHaveLength(0);
            expect(result.skipped).toBe(0);
        });
    });
});
