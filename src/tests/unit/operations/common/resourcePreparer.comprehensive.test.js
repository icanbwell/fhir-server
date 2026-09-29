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
        scopesManager: {},
        accessIndexManager: {},
        enrichmentManager: {
            enrichAsync: jestObj.fn()
        },
        resourceManager: {},
        identifierEnrichmentProvider: {
            enrichIdentifierList: jestObj.fn()
        },
        compositionSectionFilterEnrichmentProvider: {
            enrichAsync: jestObj.fn()
        }
    };
}

describe('ResourcePreparer - comprehensive tests', () => {
    let resourcePreparer;
    let mockDeps;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockDeps = createMockDeps();
        resourcePreparer = new ResourcePreparer(mockDeps);
    });

    describe('selectSpecificElements - edge cases', () => {
        test('handles empty _elements values list (only resourceType returned)', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: [] } };
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

            // resourceType is always pushed into the values list
            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBeUndefined();
            expect(result.name).toBeUndefined();
        });

        test('handles element with no extra properties beyond resourceType', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Observation'
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Observation'
            });

            expect(result.resourceType).toBe('Observation');
            expect(result.id).toBeUndefined();
        });

        test('handles element with nested objects in requested fields', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['code', 'subject'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Observation',
                id: 'obs-1',
                code: { coding: [{ system: 'http://loinc.org', code: '12345-6' }] },
                subject: { reference: 'Patient/1' },
                value: { valueQuantity: { value: 42 } }
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Observation'
            });

            expect(result.code).toEqual({ coding: [{ system: 'http://loinc.org', code: '12345-6' }] });
            expect(result.subject).toEqual({ reference: 'Patient/1' });
            expect(result.value).toBeUndefined();
            expect(result.resourceType).toBe('Observation');
        });

        test('Library special case forces id and url even when not in elements list', () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['content'] } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Library',
                id: 'lib-cql',
                url: 'http://hl7.org/fhir/Library/cql-lib',
                content: [{ contentType: 'text/cql', data: 'base64data' }],
                status: 'active'
            };

            const result = resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Library'
            });

            expect(result.id).toBe('lib-cql');
            expect(result.url).toBe('http://hl7.org/fhir/Library/cql-lib');
            expect(result.content).toEqual([{ contentType: 'text/cql', data: 'base64data' }]);
            expect(result.status).toBeUndefined();
        });

        test('mutates the values array by pushing resourceType', () => {
            const values = ['id', 'name'];
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values } };
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Patient',
                id: '1',
                name: [{ family: 'Doe' }]
            };

            resourcePreparer.selectSpecificElements({
                parsedArgs,
                element,
                resourceType: 'Patient'
            });

            // The method pushes 'resourceType' onto the values array
            expect(values).toContain('resourceType');
        });
    });

    describe('prepareResourceAsync - edge cases', () => {
        test('returns array with single element when using enrichmentManager', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockReturnValue(null)
            };
            const element = { resourceType: 'Patient', id: '1' };
            mockDeps.enrichmentManager.enrichAsync.mockResolvedValue([element]);

            const result = await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext: undefined
            });

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
        });

        test('compositionSectionFilter receives the filtered element (not original)', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockImplementation((key) => {
                    if (key === '_elements') {
                        return { queryParameterValue: { values: ['id', 'section'] } };
                    }
                    if (key === '_isGraphQLRequest') {
                        return null;
                    }
                    return null;
                })
            };
            const element = {
                resourceType: 'Composition',
                id: 'comp-1',
                section: [{ title: 'Section 1' }],
                status: 'final',
                date: '2023-01-01'
            };

            const filteredElement = { resourceType: 'Composition', id: 'comp-1', section: [{ title: 'Section 1' }] };
            mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync.mockResolvedValue([filteredElement]);

            const result = await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Composition',
                enrichmentContext: { userType: 'patient' }
            });

            // The compositionSectionFilter should receive the already-filtered element
            const callArgs = mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync.mock.calls[0][0];
            expect(callArgs.resources[0].status).toBeUndefined();
            expect(callArgs.resources[0].date).toBeUndefined();
            expect(callArgs.enrichmentContext).toEqual({ userType: 'patient' });
            expect(result).toEqual([filteredElement]);
        });

        test('does not call compositionSectionFilter when _elements is not set', async () => {
            const parsedArgs = {
                get: jestObj.fn().mockReturnValue(null)
            };
            const element = { resourceType: 'Patient', id: '1' };
            mockDeps.enrichmentManager.enrichAsync.mockResolvedValue([element]);

            await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext: undefined
            });

            expect(mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync).not.toHaveBeenCalled();
        });

        test('both _elements path and enrichmentManager path called when _elements set and _isGraphQLRequest truthy', async () => {
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

            const filteredBySection = { resourceType: 'Patient', id: '123' };
            mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync.mockResolvedValue([filteredBySection]);

            const enrichedElement = { resourceType: 'Patient', id: '123', enriched: true };
            mockDeps.enrichmentManager.enrichAsync.mockResolvedValue([enrichedElement]);

            const result = await resourcePreparer.prepareResourceAsync({
                parsedArgs,
                element,
                resourceType: 'Patient',
                enrichmentContext: undefined
            });

            // Both should be called: first selectSpecificElements + compositionSectionFilter, then enrichmentManager
            expect(mockDeps.compositionSectionFilterEnrichmentProvider.enrichAsync).not.toHaveBeenCalled();
            expect(mockDeps.enrichmentManager.enrichAsync).toHaveBeenCalled();
            expect(result).toEqual([enrichedElement]);
        });
    });
});
