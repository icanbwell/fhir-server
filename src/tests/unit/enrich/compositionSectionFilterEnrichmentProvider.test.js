const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the utility function
const mockFilterCompositionSensitiveSections = jestObj.fn();
jestObj.mock('../../../utils/compositionSectionFilter', () => ({
    filterCompositionSensitiveSections: mockFilterCompositionSensitiveSections
}));

jestObj.mock('../../../constants', () => ({
    AUTH_USER_TYPES: {
        delegatedUser: 'delegatedUser',
        cmsPartnerUser: 'cms-partner'
    }
}));

const { CompositionSectionFilterEnrichmentProvider } = require(
    '../../../enrich/providers/compositionSectionFilterEnrichmentProvider'
);

describe('CompositionSectionFilterEnrichmentProvider', () => {
    let provider;
    let mockConfigManager;

    beforeEach(() => {
        mockFilterCompositionSensitiveSections.mockReset();

        mockConfigManager = {
            enableDelegatedAccessDetection: true
        };

        provider = new CompositionSectionFilterEnrichmentProvider({ configManager: mockConfigManager });
    });

    describe('getDeniedSensitiveCategorySet', () => {
        test('returns null when enrichmentContext is undefined', () => {
            const result = provider.getDeniedSensitiveCategorySet(undefined);

            expect(result).toBeNull();
        });

        test('returns null when actor is undefined', () => {
            const result = provider.getDeniedSensitiveCategorySet({ actor: undefined });

            expect(result).toBeNull();
        });

        test('returns null when actor._filteringRules is undefined', () => {
            const result = provider.getDeniedSensitiveCategorySet({ actor: {} });

            expect(result).toBeNull();
        });

        test('returns Set from deniedSensitiveCategories', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health', 'substance-abuse']
                    }
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            expect(result).toBeInstanceOf(Set);
            expect(result.has('mental-health')).toBe(true);
            expect(result.has('substance-abuse')).toBe(true);
            expect(result.size).toBe(2);
        });

        test('returns empty Set when deniedSensitiveCategories is empty array', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: []
                    }
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        test('returns empty Set when deniedSensitiveCategories is undefined', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {}
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });
    });

    describe('enrichAsync', () => {
        test('returns resources unchanged when enableDelegatedAccessDetection is false', async () => {
            mockConfigManager.enableDelegatedAccessDetection = false;
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = { userType: 'delegatedUser' };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(result).toBe(resources);
            expect(mockFilterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('returns resources unchanged when userType is not delegatedUser', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = { userType: 'some-other-type' };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(result).toBe(resources);
            expect(mockFilterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('returns resources unchanged when enrichmentContext is undefined', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext: undefined });

            expect(result).toBe(resources);
            expect(mockFilterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('returns resources unchanged when deniedSensitiveCategorySet is null', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {} // no _filteringRules
            };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(result).toBe(resources);
            expect(mockFilterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('calls filterCompositionSensitiveSections for Composition resources', async () => {
            const resource = { resourceType: 'Composition', section: [{ title: 'test' }] };
            const resources = [resource];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health']
                    }
                }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledWith(
                resource,
                expect.any(Set)
            );
        });

        test('does not call filter for non-Composition resources', async () => {
            const resources = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Observation', id: '2' }
            ];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health']
                    }
                }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(mockFilterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('processes contained Composition resources recursively', async () => {
            const containedComposition = { resourceType: 'Composition', section: [{ title: 'inner' }] };
            const resource = {
                resourceType: 'Patient',
                contained: [containedComposition]
            };
            const resources = [resource];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health']
                    }
                }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledWith(
                containedComposition,
                expect.any(Set)
            );
        });

        test('processes multiple Composition resources in array', async () => {
            const comp1 = { resourceType: 'Composition', section: [{ title: 'a' }] };
            const comp2 = { resourceType: 'Composition', section: [{ title: 'b' }] };
            const resources = [comp1, comp2];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['substance-abuse']
                    }
                }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledTimes(2);
        });

        test('skips resources without contained property', async () => {
            const resource = { resourceType: 'Patient', id: '1' };
            const resources = [resource];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health']
                    }
                }
            };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(result).toEqual([resource]);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('processes entries with resources', async () => {
            const composition = { resourceType: 'Composition', section: [{ title: 'test' }] };
            const entries = [{ resource: composition }];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health']
                    }
                }
            };

            const result = await provider.enrichBundleEntriesAsync({
                entries,
                parsedArgs: {},
                enrichmentContext
            });

            expect(result).toBe(entries);
            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledWith(
                composition,
                expect.any(Set)
            );
        });

        test('skips entries without resource property', async () => {
            const entries = [{ search: { mode: 'match' } }];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['mental-health']
                    }
                }
            };

            const result = await provider.enrichBundleEntriesAsync({
                entries,
                parsedArgs: {},
                enrichmentContext
            });

            expect(result).toBe(entries);
            expect(mockFilterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('processes multiple entries', async () => {
            const comp1 = { resourceType: 'Composition', section: [{ title: 'a' }] };
            const patient = { resourceType: 'Patient', id: '1' };
            const entries = [
                { resource: comp1 },
                { resource: patient }
            ];
            const enrichmentContext = {
                userType: 'delegatedUser',
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['substance-abuse']
                    }
                }
            };

            await provider.enrichBundleEntriesAsync({
                entries,
                parsedArgs: {},
                enrichmentContext
            });

            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
            expect(mockFilterCompositionSensitiveSections).toHaveBeenCalledWith(comp1, expect.any(Set));
        });
    });
});
