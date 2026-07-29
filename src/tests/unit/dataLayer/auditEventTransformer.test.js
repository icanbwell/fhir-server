'use strict';

const { describe, test, expect } = require('@jest/globals');
const { AuditEventTransformer } = require('../../../dataLayer/clickHouse/auditEventTransformer');

describe('AuditEventTransformer', () => {
    const transformer = new AuditEventTransformer();

    describe('toClickHouseDateTime', () => {
        test('converts ISO string to ClickHouse format', () => {
            expect(transformer.toClickHouseDateTime('2024-01-15T10:30:00.000Z'))
                .toBe('2024-01-15 10:30:00.000');
        });

        test('converts Date object to ClickHouse format', () => {
            const d = new Date('2024-06-01T08:15:30.123Z');
            expect(transformer.toClickHouseDateTime(d)).toBe('2024-06-01 08:15:30.123');
        });

        test('handles date without milliseconds', () => {
            expect(transformer.toClickHouseDateTime('2024-01-01T00:00:00Z'))
                .toBe('2024-01-01 00:00:00');
        });
    });

    describe('extractReference', () => {
        test('prefers _uuid over reference', () => {
            const ref = { _uuid: 'Patient/uuid-123', reference: 'Patient/local-id' };
            expect(transformer.extractReference(ref)).toBe('Patient/uuid-123');
        });

        test('falls back to reference when _uuid is absent', () => {
            const ref = { reference: 'Practitioner/456' };
            expect(transformer.extractReference(ref)).toBe('Practitioner/456');
        });

        test('returns empty string for null/undefined', () => {
            expect(transformer.extractReference(null)).toBe('');
            expect(transformer.extractReference(undefined)).toBe('');
        });

        test('returns empty string when neither _uuid nor reference present', () => {
            expect(transformer.extractReference({})).toBe('');
        });
    });

    describe('collectFromArray', () => {
        test('collects non-empty values', () => {
            const arr = [{ name: 'a' }, { name: 'b' }, { name: '' }];
            const result = transformer.collectFromArray(arr, (item) => item.name);
            expect(result).toEqual(['a', 'b']);
        });

        test('returns empty array for non-array input', () => {
            expect(transformer.collectFromArray(null, () => 'x')).toEqual([]);
            expect(transformer.collectFromArray(undefined, () => 'x')).toEqual([]);
            expect(transformer.collectFromArray('string', () => 'x')).toEqual([]);
        });

        test('filters out falsy extractor results', () => {
            const arr = [{ val: 'a' }, { val: null }, { val: 'c' }];
            const result = transformer.collectFromArray(arr, (item) => item.val);
            expect(result).toEqual(['a', 'c']);
        });
    });

    describe('extractRequestorWho', () => {
        test('extracts who from agent where requestor=true', () => {
            const agents = [
                { requestor: false, who: { _uuid: 'P/non-requestor' } },
                { requestor: true, who: { _uuid: 'P/requestor-uuid', reference: 'P/local' } }
            ];
            expect(transformer.extractRequestorWho(agents)).toBe('P/requestor-uuid');
        });

        test('falls back to reference when _uuid absent', () => {
            const agents = [{ requestor: true, who: { reference: 'Practitioner/789' } }];
            expect(transformer.extractRequestorWho(agents)).toBe('Practitioner/789');
        });

        test('returns empty string when no requestor agent', () => {
            const agents = [{ requestor: false, who: { _uuid: 'P/1' } }];
            expect(transformer.extractRequestorWho(agents)).toBe('');
        });

        test('returns empty string when agents is not an array', () => {
            expect(transformer.extractRequestorWho(null)).toBe('');
            expect(transformer.extractRequestorWho(undefined)).toBe('');
        });

        test('returns empty string when requestor has no who', () => {
            const agents = [{ requestor: true }];
            expect(transformer.extractRequestorWho(agents)).toBe('');
        });
    });

    describe('extractMetaSecurity', () => {
        test('extracts system/code tuples', () => {
            const security = [
                { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
            ];
            expect(transformer.extractMetaSecurity(security)).toEqual([
                { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
            ]);
        });

        test('skips entries without system', () => {
            const security = [{ code: 'orphan' }];
            expect(transformer.extractMetaSecurity(security)).toEqual([]);
        });

        test('skips entries without code', () => {
            const security = [{ system: 'https://example.com' }];
            expect(transformer.extractMetaSecurity(security)).toEqual([]);
        });

        test('returns empty array for non-array input', () => {
            expect(transformer.extractMetaSecurity(null)).toEqual([]);
            expect(transformer.extractMetaSecurity(undefined)).toEqual([]);
        });
    });

    describe('extractPurposeOfEvent', () => {
        test('flattens CodeableConcept codings', () => {
            const purposes = [
                { coding: [{ system: 'http://hl7.org/v3', code: 'TREAT' }] },
                { coding: [{ system: 'http://hl7.org/v3', code: 'HPAYMT' }] }
            ];
            expect(transformer.extractPurposeOfEvent(purposes)).toEqual([
                { system: 'http://hl7.org/v3', code: 'TREAT' },
                { system: 'http://hl7.org/v3', code: 'HPAYMT' }
            ]);
        });

        test('flattens multiple codings within single CodeableConcept', () => {
            const purposes = [
                { coding: [
                    { system: 'sys1', code: 'a' },
                    { system: 'sys2', code: 'b' }
                ]}
            ];
            expect(transformer.extractPurposeOfEvent(purposes)).toHaveLength(2);
        });

        test('skips entries without coding array', () => {
            const purposes = [{ text: 'treatment' }];
            expect(transformer.extractPurposeOfEvent(purposes)).toEqual([]);
        });

        test('skips codings without system or code', () => {
            const purposes = [
                { coding: [{ system: 'sys1' }, { code: 'orphan' }, { system: 's', code: 'c' }] }
            ];
            expect(transformer.extractPurposeOfEvent(purposes)).toEqual([{ system: 's', code: 'c' }]);
        });

        test('returns empty for non-array input', () => {
            expect(transformer.extractPurposeOfEvent(undefined)).toEqual([]);
        });
    });

    describe('transformDocument', () => {
        const makeDoc = (overrides = {}) => ({
            id: 'audit-1',
            _uuid: 'uuid-audit-1',
            recorded: '2024-03-15T12:00:00.000Z',
            action: 'R',
            agent: [
                { requestor: true, who: { _uuid: 'Practitioner/pract-uuid' }, altId: 'alt-1' }
            ],
            entity: [
                { what: { _uuid: 'Patient/pat-uuid' } }
            ],
            purposeOfEvent: [
                { coding: [{ system: 'http://hl7.org/v3', code: 'TREAT' }] }
            ],
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/owner', code: 'org-abc' }
                ]
            },
            _sourceAssigningAuthority: 'bwell',
            _sourceId: 'audit-1',
            ...overrides
        });

        test('produces correct ClickHouse row structure', () => {
            const row = transformer.transformDocument(makeDoc());
            expect(row.id).toBe('audit-1');
            expect(row._uuid).toBe('uuid-audit-1');
            expect(row.recorded).toBe('2024-03-15 12:00:00.000');
            expect(row.action).toBe('R');
            expect(row.agent_who).toEqual(['Practitioner/pract-uuid']);
            expect(row.agent_altid).toEqual(['alt-1']);
            expect(row.entity_what).toEqual(['Patient/pat-uuid']);
            expect(row.agent_requestor_who).toBe('Practitioner/pract-uuid');
            expect(row.access_tags).toEqual(['bwell']);
            expect(row._sourceAssigningAuthority).toBe('bwell');
            expect(row._sourceId).toBe('audit-1');
            expect(row.resource).toBe(row.resource);
        });

        test('defaults missing fields to empty strings/arrays', () => {
            const row = transformer.transformDocument({
                _uuid: 'u',
                recorded: '2024-01-01T00:00:00Z'
            });
            expect(row.id).toBe('');
            expect(row.action).toBe('');
            expect(row.agent_who).toEqual([]);
            expect(row.entity_what).toEqual([]);
            expect(row._sourceAssigningAuthority).toBe('');
            expect(row._sourceId).toBe('');
        });

        test('stores full document as resource', () => {
            const doc = makeDoc();
            const row = transformer.transformDocument(doc);
            expect(row.resource).toBe(doc);
        });
    });

    describe('transformBatch', () => {
        test('transforms array of documents', () => {
            const docs = [
                { _uuid: 'u1', recorded: '2024-01-01T00:00:00Z', id: 'a1' },
                { _uuid: 'u2', recorded: '2024-01-02T00:00:00Z', id: 'a2' }
            ];
            const { rows, skipped } = transformer.transformBatch(docs);
            expect(rows).toHaveLength(2);
            expect(skipped).toBe(0);
            expect(rows[0]._uuid).toBe('u1');
            expect(rows[1]._uuid).toBe('u2');
        });

        test('empty batch produces empty result', () => {
            const { rows, skipped } = transformer.transformBatch([]);
            expect(rows).toEqual([]);
            expect(skipped).toBe(0);
        });
    });
});
