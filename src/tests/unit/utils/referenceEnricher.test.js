'use strict';

const { describe, test, expect } = require('@jest/globals');
const { enrichMemberReferences } = require('../../../utils/referenceEnricher');

describe('enrichMemberReferences', () => {
    test('enriches member entity with _uuid and _sourceId for non-UUID id', () => {
        const members = [{ entity: { reference: 'Patient/abc123' } }];
        enrichMemberReferences(members, 'bwell');

        expect(members[0].entity._uuid).toMatch(/^Patient\//);
        expect(members[0].entity._sourceId).toBe('Patient/abc123');
    });

    test('uses id directly as uuid when already a UUID', () => {
        const uuid = '12345678-1234-1234-1234-123456789abc';
        const members = [{ entity: { reference: `Patient/${uuid}` } }];
        enrichMemberReferences(members, 'bwell');

        expect(members[0].entity._uuid).toBe(`Patient/${uuid}`);
        expect(members[0].entity._sourceId).toBe(`Patient/${uuid}`);
    });

    test('extracts sourceAssigningAuthority from reference with pipe', () => {
        const members = [{ entity: { reference: 'Patient/abc|custom-saa' } }];
        enrichMemberReferences(members, 'default-saa');

        expect(members[0].entity._sourceId).toBe('Patient/abc');
        // UUID should be generated from abc|custom-saa
        expect(members[0].entity._uuid).toMatch(/^Patient\//);
    });

    test('skips members without entity.reference', () => {
        const members = [
            { entity: {} },
            { entity: null },
            {}
        ];
        expect(() => enrichMemberReferences(members, 'bwell')).not.toThrow();
    });

    test('skips already enriched members', () => {
        const members = [{
            entity: {
                reference: 'Patient/xyz',
                _uuid: 'Patient/existing-uuid',
                _sourceId: 'Patient/existing-source'
            }
        }];
        enrichMemberReferences(members, 'bwell');

        expect(members[0].entity._uuid).toBe('Patient/existing-uuid');
        expect(members[0].entity._sourceId).toBe('Patient/existing-source');
    });

    test('handles reference without resource type prefix', () => {
        const members = [{ entity: { reference: 'simpleId' } }];
        enrichMemberReferences(members, 'bwell');

        expect(members[0].entity._sourceId).toBe('simpleId');
        expect(members[0].entity._uuid).toBeDefined();
    });

    test('generates deterministic UUIDs', () => {
        const members1 = [{ entity: { reference: 'Patient/abc' } }];
        const members2 = [{ entity: { reference: 'Patient/abc' } }];
        enrichMemberReferences(members1, 'bwell');
        enrichMemberReferences(members2, 'bwell');

        expect(members1[0].entity._uuid).toBe(members2[0].entity._uuid);
    });

    test('enriches multiple members', () => {
        const members = [
            { entity: { reference: 'Patient/p1' } },
            { entity: { reference: 'Practitioner/pr1' } }
        ];
        enrichMemberReferences(members, 'bwell');

        expect(members[0].entity._sourceId).toBe('Patient/p1');
        expect(members[1].entity._sourceId).toBe('Practitioner/pr1');
    });
});
