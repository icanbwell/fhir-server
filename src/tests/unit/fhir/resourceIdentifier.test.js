const { describe, test, expect } = require('@jest/globals');
const { ResourceIdentifier } = require('../../../fhir/resourceIdentifier');

describe('ResourceIdentifier', () => {
    const defaultParams = {
        id: 'patient-123',
        resourceType: 'Patient',
        _uuid: 'uuid-abc-123',
        _sourceId: 'source-patient-123',
        _sourceAssigningAuthority: 'https://example.org'
    };

    describe('constructor', () => {
        test('should set all properties correctly', () => {
            const identifier = new ResourceIdentifier(defaultParams);

            expect(identifier.id).toBe('patient-123');
            expect(identifier.resourceType).toBe('Patient');
            expect(identifier._uuid).toBe('uuid-abc-123');
            expect(identifier._sourceId).toBe('source-patient-123');
            expect(identifier._sourceAssigningAuthority).toBe('https://example.org');
        });

        test('should handle different resource types', () => {
            const identifier = new ResourceIdentifier({
                ...defaultParams,
                resourceType: 'Observation',
                id: 'obs-456'
            });

            expect(identifier.resourceType).toBe('Observation');
            expect(identifier.id).toBe('obs-456');
        });
    });

    describe('equals', () => {
        test('should return true when _uuid matches', () => {
            const identifier1 = new ResourceIdentifier(defaultParams);
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                id: 'different-id',
                _sourceAssigningAuthority: 'different-auth'
            });

            expect(identifier1.equals(identifier2)).toBe(true);
        });

        test('should return true when id and _sourceAssigningAuthority match', () => {
            const identifier1 = new ResourceIdentifier(defaultParams);
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: 'different-uuid'
            });

            expect(identifier1.equals(identifier2)).toBe(true);
        });

        test('should return false when resourceType differs', () => {
            const identifier1 = new ResourceIdentifier(defaultParams);
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                resourceType: 'Observation'
            });

            expect(identifier1.equals(identifier2)).toBe(false);
        });

        test('should return false when nothing matches', () => {
            const identifier1 = new ResourceIdentifier(defaultParams);
            const identifier2 = new ResourceIdentifier({
                id: 'different-id',
                resourceType: 'Patient',
                _uuid: 'different-uuid',
                _sourceId: 'different-source',
                _sourceAssigningAuthority: 'different-auth'
            });

            expect(identifier1.equals(identifier2)).toBe(false);
        });

        test('should work with plain objects as other (not just ResourceIdentifier instances)', () => {
            const identifier = new ResourceIdentifier(defaultParams);
            const plainObject = {
                id: 'patient-123',
                resourceType: 'Patient',
                _uuid: 'different-uuid',
                _sourceAssigningAuthority: 'https://example.org'
            };

            expect(identifier.equals(plainObject)).toBe(true);
        });

        test('should return false when id matches but _sourceAssigningAuthority differs', () => {
            const identifier1 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: undefined
            });
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: undefined,
                _sourceAssigningAuthority: 'different-auth'
            });

            expect(identifier1.equals(identifier2)).toBe(false);
        });

        test('should return false when _sourceAssigningAuthority matches but id differs', () => {
            const identifier1 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: undefined
            });
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: undefined,
                id: 'different-id'
            });

            expect(identifier1.equals(identifier2)).toBe(false);
        });

        test('should handle null/undefined _uuid gracefully', () => {
            const identifier1 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: null
            });
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                _uuid: null
            });

            // null _uuid is falsy, so falls through to id/authority check
            expect(identifier1.equals(identifier2)).toBe(true);
        });

        test('should be symmetric - if a.equals(b) then b.equals(a)', () => {
            const identifier1 = new ResourceIdentifier(defaultParams);
            const identifier2 = new ResourceIdentifier(defaultParams);

            expect(identifier1.equals(identifier2)).toBe(true);
            expect(identifier2.equals(identifier1)).toBe(true);
        });

        test('should handle comparison with ResourceIdentifier having same uuid but different resourceType', () => {
            const identifier1 = new ResourceIdentifier(defaultParams);
            const identifier2 = new ResourceIdentifier({
                ...defaultParams,
                resourceType: 'Encounter'
            });

            // resourceType check fails first, so returns false even with same _uuid
            expect(identifier1.equals(identifier2)).toBe(false);
        });
    });
});
