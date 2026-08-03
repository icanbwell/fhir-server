'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock assertType before importing the module under test
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

const { ResourcePreparer } = require('../../../../operations/common/resourcePreparer');

function createMockDeps() {
    return {
        scopesManager: {
            getScopes: jestObj.fn()
        },
        accessIndexManager: {
            getAccessIndex: jestObj.fn()
        },
        enrichmentManager: {
            enrichAsync: jestObj.fn()
        },
        resourceManager: {
            getResourceType: jestObj.fn()
        },
        identifierEnrichmentProvider: {
            enrichIdentifierList: jestObj.fn()
        },
        compositionSectionFilterEnrichmentProvider: {
            enrichAsync: jestObj.fn()
        }
    };
}

describe('ResourcePreparer', () => {
    let resourcePreparer;
    let mockDeps;

    beforeEach(() => {
        mockDeps = createMockDeps();
        resourcePreparer = new ResourcePreparer(mockDeps);
    });

    describe('constructor', () => {
        test('assigns all dependencies', () => {
            expect(resourcePreparer.scopesManager).toBe(mockDeps.scopesManager);
            expect(resourcePreparer.accessIndexManager).toBe(mockDeps.accessIndexManager);
            expect(resourcePreparer.enrichmentManager).toBe(mockDeps.enrichmentManager);
            expect(resourcePreparer.resourceManager).toBe(mockDeps.resourceManager);
            expect(resourcePreparer.identifierEnrichmentProvider).toBe(mockDeps.identifierEnrichmentProvider);
            expect(resourcePreparer.compositionSectionFilterEnrichmentProvider).toBe(mockDeps.compositionSectionFilterEnrichmentProvider);
        });
    });

    describe('selectSpecificElements', () => {
        test('returns only requested elements plus resourceType', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['name', 'id'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                name: [{ family: 'Smith' }],
                birthDate: '1990-01-01',
                gender: 'male'
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('123');
            expect(result.name).toEqual([{ family: 'Smith' }]);
            expect(result.birthDate).toBeUndefined();
            expect(result.gender).toBeUndefined();
        });

        test('always includes resourceType even if not in elements list', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                name: [{ family: 'Smith' }]
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('123');
            expect(result.name).toBeUndefined();
        });

        test('enriches identifier when identifier is in elements list', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['identifier'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                identifier: [{ system: 'http://example.com', value: '123' }]
            };

            resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            expect(mockDeps.identifierEnrichmentProvider.enrichIdentifierList).toHaveBeenCalledWith(element);
        });

        test('does not enrich identifier when not in elements list', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['name'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                name: [{ family: 'Smith' }],
                identifier: [{ system: 'http://example.com', value: '123' }]
            };

            resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            expect(mockDeps.identifierEnrichmentProvider.enrichIdentifierList).not.toHaveBeenCalled();
        });

        test('preserves _uuid if present on element', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                _uuid: 'some-uuid',
                name: [{ family: 'Smith' }]
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            expect(result._uuid).toBe('some-uuid');
        });

        test('does not include _uuid if not present on element', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123'
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            expect(result._uuid).toBeUndefined();
        });

        test('adds id and url for Library resourceType (CQL hack)', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['name'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Library',
                id: 'lib-1',
                url: 'http://example.com/Library/lib-1',
                name: 'MyLibrary',
                content: [{ data: 'base64...' }]
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Library'
            });

            expect(result.id).toBe('lib-1');
            expect(result.url).toBe('http://example.com/Library/lib-1');
            expect(result.name).toBe('MyLibrary');
            expect(result.content).toBeUndefined();
        });

        test('does not add id/url for non-Library resourceType', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['name'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                url: 'http://example.com',
                name: [{ family: 'Smith' }]
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            // id and url were not in the elements list, so they should not be included
            expect(result.id).toBeUndefined();
            expect(result.url).toBeUndefined();
            expect(result.name).toEqual([{ family: 'Smith' }]);
        });
    });

    describe('prepareResourceAsync', () => {
        test('uses selectSpecificElements and compositionSectionFilter when _elements is set and not GraphQL', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id', 'name'] } };
                    }
                    if (key === '_isGraphQLRequest') {
                        return null;
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                name: [{ family: 'Smith' }],
                birthDate: '1990-01-01'
            };

            const filteredElement = { resourceType: 'Patient', id: '123', name: [{ family: 'Smith' }] };
            mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync.mockResolvedValue([filteredElement]);

            const result = await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext: undefined
            });

            expect(mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync).toHaveBeenCalled();
            expect(mockDeps.enrichmentManager.enrichAsync).not.toHaveBeenCalled();
            expect(result).toEqual([filteredElement]);
        });

        test('uses enrichmentManager when _elements is not set', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return null;
                    }
                    if (key === '_isGraphQLRequest') {
                        return null;
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                name: [{ family: 'Smith' }]
            };

            const enrichedElement = { ...element, enriched: true };
            mockDeps.enrichmentManager.enrichAsync.mockResolvedValue([enrichedElement]);

            const result = await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext: undefined
            });

            expect(mockDeps.enrichmentManager.enrichAsync).toHaveBeenCalledWith({
                resources: [element],
                parsedArgs,
                enrichmentContext: undefined
            });
            expect(result).toEqual([enrichedElement]);
        });

        test('uses enrichmentManager when _isGraphQLRequest is set even with _elements', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id'] } };
                    }
                    if (key === '_isGraphQLRequest') {
                        return true;
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '123',
                name: [{ family: 'Smith' }]
            };

            const enrichedElement = { ...element, enriched: true };
            mockDeps.enrichmentManager.enrichAsync.mockResolvedValue([enrichedElement]);

            const result = await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext: undefined
            });

            expect(mockDeps.enrichmentManager.enrichAsync).toHaveBeenCalled();
            expect(result).toEqual([enrichedElement]);
        });

        test('passes enrichmentContext to enrichmentManager', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockReturnValue(null)
            };
            const element = { resourceType: 'Patient', id: '123' };
            const enrichmentContext = { someContext: true };

            mockDeps.enrichmentManager.enrichAsync.mockResolvedValue([element]);

            await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext
            });

            expect(mockDeps.enrichmentManager.enrichAsync).toHaveBeenCalledWith({
                resources: [element],
                parsedArgs,
                enrichmentContext
            });
        });
    });
});
