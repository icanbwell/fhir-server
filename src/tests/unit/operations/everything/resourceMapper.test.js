'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ResourceMapper, UuidOnlyMapper } = require('../../../../operations/everything/resourceMapper');

describe('ResourceMapper', () => {
    describe('base ResourceMapper', () => {
        test('returns resource unchanged (identity mapper)', () => {
            const mapper = new ResourceMapper();
            const resource = {
                resourceType: 'Patient',
                id: 'patient-123',
                _uuid: 'urn:uuid:abc-def',
                name: [{ family: 'Smith' }],
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'tenant-a' }] }
            };

            const result = mapper.map(resource);

            expect(result).toBe(resource);
            expect(result.name[0].family).toBe('Smith');
            expect(result.meta.security[0].code).toBe('tenant-a');
        });

        test('preserves all fields including internal ones', () => {
            const mapper = new ResourceMapper();
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'urn:uuid:internal-uuid',
                _sourceId: 'source-id-123',
                _sourceAssigningAuthority: 'tenant-a',
                status: 'final'
            };

            const result = mapper.map(resource);

            expect(result._uuid).toBe('urn:uuid:internal-uuid');
            expect(result._sourceId).toBe('source-id-123');
            expect(result._sourceAssigningAuthority).toBe('tenant-a');
        });
    });

    describe('UuidOnlyMapper', () => {
        test('returns only resourceType and id (from _uuid)', () => {
            const mapper = new UuidOnlyMapper();
            const resource = {
                resourceType: 'Patient',
                id: 'patient-123',
                _uuid: 'urn:uuid:secret-internal-uuid',
                name: [{ family: 'Smith' }],
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'tenant-a' }] }
            };

            const result = mapper.map(resource);

            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('urn:uuid:secret-internal-uuid');
            expect(result.name).toBeUndefined();
            expect(result.meta).toBeUndefined();
        });

        test('SECURITY: exposes internal _uuid as the id field', () => {
            const mapper = new UuidOnlyMapper();
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'urn:uuid:cross-tenant-targetable-uuid',
                subject: { reference: 'Patient/123' }
            };

            const result = mapper.map(resource);

            // This mapper intentionally exposes _uuid as id
            // This is used for _includeUuidOnly=true in $everything
            // SECURITY CONCERN: _uuid values can be used for cross-tenant targeting
            // The correct behavior depends on whether the caller has authorization
            expect(result.id).toBe('urn:uuid:cross-tenant-targetable-uuid');
            expect(result.subject).toBeUndefined();
        });

        test('strips all clinical data from the response', () => {
            const mapper = new UuidOnlyMapper();
            const resource = {
                resourceType: 'Condition',
                id: 'cond-1',
                _uuid: 'urn:uuid:cond-uuid',
                code: { coding: [{ system: 'http://snomed.info/sct', code: '73211009', display: 'Diabetes' }] },
                subject: { reference: 'Patient/123' },
                clinicalStatus: { coding: [{ code: 'active' }] },
                verificationStatus: { coding: [{ code: 'confirmed' }] }
            };

            const result = mapper.map(resource);

            expect(Object.keys(result)).toEqual(['resourceType', 'id']);
            expect(result.code).toBeUndefined();
            expect(result.subject).toBeUndefined();
            expect(result.clinicalStatus).toBeUndefined();
        });

        test('handles resource with missing _uuid gracefully', () => {
            const mapper = new UuidOnlyMapper();
            const resource = {
                resourceType: 'Patient',
                id: 'patient-no-uuid'
            };

            const result = mapper.map(resource);

            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBeUndefined();
        });

        test('handles resource with null _uuid', () => {
            const mapper = new UuidOnlyMapper();
            const resource = {
                resourceType: 'Patient',
                id: 'patient-1',
                _uuid: null
            };

            const result = mapper.map(resource);

            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBeNull();
        });
    });
});
