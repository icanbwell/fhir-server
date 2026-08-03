'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

const { SourceIdColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceIdColumnHandler');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');

describe('SourceIdColumnHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new SourceIdColumnHandler();
    });

    describe('preSaveAsync - _sourceId assignment', () => {
        test('sets _sourceId from resource.id when _sourceId is missing', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'patient-123'
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._sourceId).toBe('patient-123');
        });

        test('preserves existing _sourceId when already set', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'patient-123',
                _sourceId: 'original-source-id'
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._sourceId).toBe('original-source-id');
        });

        test('SECURITY: _sourceId set from resource.id without tenant validation - cross-tenant collision', async () => {
            const tenantAResource = {
                resourceType: 'Patient',
                id: 'shared-id',
                _sourceId: undefined
            };
            const tenantBResource = {
                resourceType: 'Patient',
                id: 'shared-id',
                _sourceId: undefined
            };

            const resultA = await handler.preSaveAsync({ resource: tenantAResource });
            const resultB = await handler.preSaveAsync({ resource: tenantBResource });

            // Two different tenants with same resource id get same _sourceId
            // This enables cross-tenant lookups via _sourceId
            expect(resultA._sourceId).toBe(resultB._sourceId);
        });
    });

    describe('preSaveAsync - sourceId identifier stripping', () => {
        test('removes sourceId identifiers from resource', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _sourceId: 'existing',
                identifier: [
                    { system: IdentifierSystem.sourceId, value: 'old-source-id' },
                    { system: 'http://other-system', value: 'keep-this' }
                ]
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.identifier).toHaveLength(1);
            expect(result.identifier[0].system).toBe('http://other-system');
        });

        test('deletes identifier array on plain objects when filtering leaves it empty', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'p1',
                _sourceId: 'existing',
                identifier: [
                    { system: IdentifierSystem.sourceId, value: 'only-source-id' }
                ]
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.identifier).toBeUndefined();
        });

        test('SECURITY: attacker can set _sourceId to collide with another tenants resource id', async () => {
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _sourceId: 'victim-tenant-resource-id'
            };

            const result = await handler.preSaveAsync({ resource });

            // _sourceId is preserved as-is — no validation that this id belongs to the same tenant
            expect(result._sourceId).toBe('victim-tenant-resource-id');
        });
    });

    describe('preSaveAsync - falsy _sourceId values', () => {
        test('empty string _sourceId is treated as falsy, gets overwritten with id', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'patient-456',
                _sourceId: ''
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._sourceId).toBe('patient-456');
        });

        test('null _sourceId gets overwritten with id', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'patient-789',
                _sourceId: null
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._sourceId).toBe('patient-789');
        });
    });
});
