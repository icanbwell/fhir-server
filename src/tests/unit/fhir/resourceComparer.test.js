const { describe, test, expect } = require('@jest/globals');
const { ResourceComparer } = require('../../../fhir/resourceComparer');

describe('ResourceComparer', () => {
    describe('isSameResourceByIdAndSecurityTag', () => {
        test('should return true when _uuid matches and resourceType matches', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-abc-123',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-2',
                resourceType: 'Patient',
                _uuid: 'uuid-abc-123',
                _sourceAssigningAuthority: 'auth-2'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(true);
        });

        test('should return true when id and _sourceAssigningAuthority match', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-111',
                _sourceAssigningAuthority: 'https://example.org'
            };
            const second = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-222',
                _sourceAssigningAuthority: 'https://example.org'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(true);
        });

        test('should return false when resourceTypes differ', () => {
            const first = {
                id: 'resource-1',
                resourceType: 'Patient',
                _uuid: 'uuid-abc-123',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'resource-1',
                resourceType: 'Observation',
                _uuid: 'uuid-abc-123',
                _sourceAssigningAuthority: 'auth-1'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });

        test('should return false when nothing matches except resourceType', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-111',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-2',
                resourceType: 'Patient',
                _uuid: 'uuid-222',
                _sourceAssigningAuthority: 'auth-2'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });

        test('should return false when id matches but _sourceAssigningAuthority differs', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-111',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-222',
                _sourceAssigningAuthority: 'auth-2'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });

        test('should return false when _sourceAssigningAuthority matches but id differs', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-111',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-2',
                resourceType: 'Patient',
                _uuid: 'uuid-222',
                _sourceAssigningAuthority: 'auth-1'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });

        test('should prioritize _uuid match over id/authority match', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-shared',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-DIFFERENT',
                resourceType: 'Patient',
                _uuid: 'uuid-shared',
                _sourceAssigningAuthority: 'auth-DIFFERENT'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(true);
        });

        test('should return false when _uuid is null/undefined on both sides', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: null,
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-2',
                resourceType: 'Patient',
                _uuid: null,
                _sourceAssigningAuthority: 'auth-2'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });

        test('should fall through to id/authority check when _uuid is falsy', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: undefined,
                _sourceAssigningAuthority: 'https://example.org'
            };
            const second = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: undefined,
                _sourceAssigningAuthority: 'https://example.org'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(true);
        });

        test('should return false when _uuid is empty string on both (falsy)', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: '',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-2',
                resourceType: 'Patient',
                _uuid: '',
                _sourceAssigningAuthority: 'auth-2'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });

        test('should return true when _uuid is empty string on both but id/authority match', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: '',
                _sourceAssigningAuthority: 'auth-same'
            };
            const second = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: '',
                _sourceAssigningAuthority: 'auth-same'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(true);
        });

        test('should handle case where only first has _uuid', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-only-first',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: undefined,
                _sourceAssigningAuthority: 'auth-1'
            };

            // first._uuid is truthy but doesn't equal second._uuid, so uuid check fails
            // Then falls through to id/authority check which passes
            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(true);
        });

        test('should return false when _uuid exists on first but not second and id/auth differ', () => {
            const first = {
                id: 'patient-1',
                resourceType: 'Patient',
                _uuid: 'uuid-only-first',
                _sourceAssigningAuthority: 'auth-1'
            };
            const second = {
                id: 'patient-2',
                resourceType: 'Patient',
                _uuid: undefined,
                _sourceAssigningAuthority: 'auth-2'
            };

            const result = ResourceComparer.isSameResourceByIdAndSecurityTag({ first, second });
            expect(result).toBe(false);
        });
    });
});
