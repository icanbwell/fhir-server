'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

const { IdentifierEnrichmentProvider } = require('../../../enrich/providers/identifierEnrichmentProvider');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('IdentifierEnrichmentProvider', () => {
    const mockFhirTypesManager = {
        getDataForField: jestObj.fn(({ resourceType, field }) => {
            if (field === 'identifier') {
                return { max: '*' };
            }
            return null;
        })
    };

    let provider;

    beforeEach(() => {
        provider = new IdentifierEnrichmentProvider({ fhirTypesManager: mockFhirTypesManager });
        jestObj.clearAllMocks();
        mockFhirTypesManager.getDataForField.mockImplementation(({ resourceType, field }) => {
            if (field === 'identifier') return { max: '*' };
            return null;
        });
    });

    describe('enrichIdentifierList', () => {
        test('adds sourceId identifier when _sourceId exists and not in list', () => {
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'src-123',
                _uuid: 'uuid-456',
                identifier: []
            };
            provider.enrichIdentifierList(resource);
            expect(resource.identifier).toContainEqual({
                id: 'sourceId',
                system: IdentifierSystem.sourceId,
                value: 'src-123'
            });
        });

        test('adds uuid identifier when _uuid exists and not in list', () => {
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'src-123',
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

        test('updates existing sourceId identifier value if different', () => {
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'new-src',
                identifier: [{
                    id: 'sourceId',
                    system: IdentifierSystem.sourceId,
                    value: 'old-src'
                }]
            };
            provider.enrichIdentifierList(resource);
            expect(resource.identifier[0].value).toBe('new-src');
        });

        test('does not duplicate sourceId if already matches', () => {
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'src-123',
                identifier: [{
                    id: 'sourceId',
                    system: IdentifierSystem.sourceId,
                    value: 'src-123'
                }]
            };
            provider.enrichIdentifierList(resource);
            const sourceIdEntries = resource.identifier.filter(
                i => i.system === IdentifierSystem.sourceId
            );
            expect(sourceIdEntries).toHaveLength(1);
        });

        test('does nothing when resource has no resourceType', () => {
            const resource = { _sourceId: 'src', identifier: [] };
            provider.enrichIdentifierList(resource);
            expect(resource.identifier).toEqual([]);
        });

        test('does nothing when resource is null', () => {
            expect(() => provider.enrichIdentifierList(null)).not.toThrow();
        });

        test('does nothing when identifier field is not list type', () => {
            mockFhirTypesManager.getDataForField.mockReturnValue({ max: '1' });
            const resource = {
                resourceType: 'Binary',
                _sourceId: 'src-123',
                identifier: []
            };
            provider.enrichIdentifierList(resource);
            expect(resource.identifier).toEqual([]);
        });

        test('creates identifier array when resource has none', () => {
            const resource = {
                resourceType: 'Patient',
                _sourceId: 'src-123',
                _uuid: 'uuid-456'
            };
            provider.enrichIdentifierList(resource);
            expect(resource.identifier).toBeDefined();
            expect(resource.identifier.length).toBeGreaterThan(0);
        });
    });

    describe('enrichAsync', () => {
        test('enriches identifiers on each resource', async () => {
            const resources = [{
                resourceType: 'Patient',
                _sourceId: 'src-1',
                _uuid: 'uuid-1',
                identifier: []
            }];
            await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(resources[0].identifier.length).toBeGreaterThan(0);
        });

        test('recursively enriches contained resources', async () => {
            const resources = [{
                resourceType: 'Patient',
                _sourceId: 'src-1',
                _uuid: 'uuid-1',
                identifier: [],
                contained: [{
                    resourceType: 'Organization',
                    _sourceId: 'org-src',
                    _uuid: 'org-uuid',
                    identifier: []
                }]
            }];
            await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(resources[0].contained[0].identifier.length).toBeGreaterThan(0);
        });

        test('skips contained when empty', async () => {
            const resources = [{
                resourceType: 'Patient',
                _sourceId: 'src-1',
                identifier: [],
                contained: []
            }];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result[0].contained).toEqual([]);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('enriches resource in each entry', async () => {
            const entries = [{
                resource: {
                    resourceType: 'Patient',
                    _sourceId: 'src-1',
                    _uuid: 'uuid-1',
                    identifier: []
                }
            }];
            await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });
            expect(entries[0].resource.identifier.length).toBeGreaterThan(0);
        });

        test('skips entries without resource', async () => {
            const entries = [{ fullUrl: 'urn:uuid:123' }];
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });
            expect(result[0]).toEqual({ fullUrl: 'urn:uuid:123' });
        });
    });
});
