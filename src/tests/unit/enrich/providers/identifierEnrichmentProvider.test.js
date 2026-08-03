const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType to avoid real type checking in tests
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');

describe('IdentifierEnrichmentProvider', () => {
    let provider;
    let mockFhirTypesManager;

    beforeEach(() => {
        mockFhirTypesManager = {
            getDataForField: jestObj.fn()
        };
        // Make the mock appear as an instance of FhirTypesManager
        const { FhirTypesManager } = require('../../../../fhir/fhirTypesManager');
        Object.setPrototypeOf(mockFhirTypesManager, FhirTypesManager.prototype);

        provider = new IdentifierEnrichmentProvider({ fhirTypesManager: mockFhirTypesManager });
    });

    describe('constructor', () => {
        test('stores fhirTypesManager as instance property', () => {
            expect(provider.fhirTypesManager).toBe(mockFhirTypesManager);
        });
    });

    describe('enrichIdentifierList', () => {
        test('adds sourceId identifier when resource has _sourceId and no existing sourceId identifier', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'source-123',
                _uuid: 'uuid-456',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toContainEqual({
                id: 'sourceId',
                system: IdentifierSystem.sourceId,
                value: 'source-123'
            });
        });

        test('adds uuid identifier when resource has _uuid and no existing uuid identifier', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'source-123',
                _uuid: 'uuid-456',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toContainEqual({
                id: 'uuid',
                system: IdentifierSystem.uuid,
                value: 'uuid-456'
            });
        });

        test('updates existing sourceId identifier when value differs', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'new-source-id',
                identifier: [
                    { id: 'sourceId', system: IdentifierSystem.sourceId, value: 'old-source-id' }
                ]
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier[0].value).toBe('new-source-id');
        });

        test('updates existing uuid identifier when value differs', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _uuid: 'new-uuid',
                identifier: [
                    { id: 'uuid', system: IdentifierSystem.uuid, value: 'old-uuid' }
                ]
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier[0].value).toBe('new-uuid');
        });

        test('does NOT modify existing sourceId identifier when value matches', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'same-value',
                identifier: [
                    { id: 'sourceId', system: IdentifierSystem.sourceId, value: 'same-value' }
                ]
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toHaveLength(1);
            expect(resource.identifier[0].value).toBe('same-value');
        });

        test('does NOT modify existing uuid identifier when value matches', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _uuid: 'same-uuid',
                identifier: [
                    { id: 'uuid', system: IdentifierSystem.uuid, value: 'same-uuid' }
                ]
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toHaveLength(1);
            expect(resource.identifier[0].value).toBe('same-uuid');
        });

        test('does nothing when resource is null', () => {
            provider.enrichIdentifierList(null);
            // Should not throw
        });

        test('does nothing when resource is undefined', () => {
            provider.enrichIdentifierList(undefined);
            // Should not throw
        });

        test('does nothing when resource is not an object', () => {
            provider.enrichIdentifierList('string');
            // Should not throw
        });

        test('does nothing when resource has no resourceType', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = { _sourceId: 'source-1', _uuid: 'uuid-1', identifier: [] };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toEqual([]);
        });

        test('does nothing when identifier field type is not found', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue(null);
            const resource = {
                resourceType: 'Binary',
                _sourceId: 'source-1',
                _uuid: 'uuid-1',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toEqual([]);
        });

        test('does nothing when identifier field max is not *', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '1' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'source-1',
                _uuid: 'uuid-1',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toEqual([]);
        });

        test('creates identifier array on resource when resource has no identifier field', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'source-1',
                _uuid: 'uuid-1'
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toHaveLength(2);
            expect(resource.identifier).toContainEqual({
                id: 'sourceId',
                system: IdentifierSystem.sourceId,
                value: 'source-1'
            });
            expect(resource.identifier).toContainEqual({
                id: 'uuid',
                system: IdentifierSystem.uuid,
                value: 'uuid-1'
            });
        });

        test('does NOT add sourceId when _sourceId is missing', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toHaveLength(1);
            expect(resource.identifier[0].system).toBe(IdentifierSystem.uuid);
        });

        test('does NOT add uuid when _uuid is missing', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'source-1',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toHaveLength(1);
            expect(resource.identifier[0].system).toBe(IdentifierSystem.sourceId);
        });

        test('does NOT set identifier when neither _sourceId nor _uuid are present', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Patient',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            // identifier array is empty so the `if (identifiers.length > 0)` check is false
            // and resource.identifier is not re-assigned... but it's already []
            expect(resource.identifier).toEqual([]);
        });

        test('preserves existing non-system identifiers', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const existingIdentifier = { system: 'http://custom.system', value: 'custom-val' };
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'source-1',
                _uuid: 'uuid-1',
                identifier: [existingIdentifier]
            };

            provider.enrichIdentifierList(resource);

            expect(resource.identifier).toHaveLength(3);
            expect(resource.identifier[0]).toBe(existingIdentifier);
        });

        test('calls getDataForField with correct args', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resource = {
                resourceType: 'Observation',
                _sourceId: 'source-1',
                identifier: []
            };

            provider.enrichIdentifierList(resource);

            expect(mockFhirTypesManager.getDataForField).toHaveBeenCalledWith({
                resourceType: 'Observation',
                field: 'identifier'
            });
        });
    });

    describe('enrichAsync', () => {
        test('calls enrichIdentifierList for each resource', async () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resources = [
                { resourceType: 'Patient', _sourceId: 'src-1', _uuid: 'uuid-1', identifier: [] },
                { resourceType: 'Observation', _sourceId: 'src-2', _uuid: 'uuid-2', identifier: [] }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].identifier).toContainEqual(expect.objectContaining({ value: 'src-1' }));
            expect(result[1].identifier).toContainEqual(expect.objectContaining({ value: 'src-2' }));
        });

        test('processes contained resources recursively', async () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resources = [{
                resourceType: 'Patient',
                _sourceId: 'parent-src',
                _uuid: 'parent-uuid',
                identifier: [],
                contained: [
                    {
                        resourceType: 'Observation',
                        _sourceId: 'child-src',
                        _uuid: 'child-uuid',
                        identifier: []
                    }
                ]
            }];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].contained[0].identifier).toContainEqual(
                expect.objectContaining({ value: 'child-src' })
            );
        });

        test('does NOT recurse into contained when it is empty', async () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const resources = [{
                resourceType: 'Patient',
                _sourceId: 'src',
                identifier: [],
                contained: []
            }];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].contained).toEqual([]);
        });

        test('returns the resources array', async () => {
            mockFhirTypesManager.getDataForField.mockReturnValue(null);
            const resources = [{ resourceType: 'Patient' }];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result).toBe(resources);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('enriches each entry resource', async () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });
            const entries = [
                { resource: { resourceType: 'Patient', _sourceId: 'src-1', _uuid: 'uuid-1', identifier: [] } }
            ];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });

            expect(result[0].resource.identifier).toContainEqual(
                expect.objectContaining({ system: IdentifierSystem.sourceId, value: 'src-1' })
            );
        });

        test('skips entries without resource', async () => {
            const entries = [
                { resource: { resourceType: 'Patient', _sourceId: 'src-1', identifier: [] } },
                { fullUrl: 'http://example.com' }
            ];
            mockFhirTypesManager.getDataForField.mockReturnValue({ code: 'Identifier', min: 0, max: '*' });

            // The code checks `if (entry.resource)` so entries without resource are skipped
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });

            expect(result).toHaveLength(2);
            expect(result[0].resource.identifier).toContainEqual(
                expect.objectContaining({ value: 'src-1' })
            );
        });

        test('handles empty entries array', async () => {
            const entries = [];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });

            expect(result).toEqual([]);
        });
    });
});
