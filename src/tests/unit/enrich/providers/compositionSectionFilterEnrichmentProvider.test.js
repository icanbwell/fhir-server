const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/compositionSectionFilter', () => ({
    filterCompositionSensitiveSections: jestObj.fn()
}));

const { CompositionSectionFilterEnrichmentProvider } = require('../../../../enrich/providers/compositionSectionFilterEnrichmentProvider');
const { filterCompositionSensitiveSections } = require('../../../../utils/compositionSectionFilter');
const { AUTH_USER_TYPES, SENSITIVE_CATEGORY } = require('../../../../constants');

describe('CompositionSectionFilterEnrichmentProvider', () => {
    let provider;
    let mockConfigManager;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockConfigManager = {
            enableDelegatedAccessDetection: true
        };
        provider = new CompositionSectionFilterEnrichmentProvider({ configManager: mockConfigManager });
    });

    describe('constructor', () => {
        test('stores configManager as instance property', () => {
            expect(provider.configManager).toBe(mockConfigManager);
        });
    });

    describe('getDeniedSensitiveCategorySet', () => {
        test('returns null when enrichmentContext is undefined', () => {
            const result = provider.getDeniedSensitiveCategorySet(undefined);
            expect(result).toBeNull();
        });

        test('returns null when enrichmentContext has no actor', () => {
            const result = provider.getDeniedSensitiveCategorySet({});
            expect(result).toBeNull();
        });

        test('returns null when actor has no _filteringRules', () => {
            const result = provider.getDeniedSensitiveCategorySet({ actor: {} });
            expect(result).toBeNull();
        });

        test('returns Set from deniedSensitiveCategories, plus the hardcoded unclassified code', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['ETH', 'PSY', 'SDV']
                    }
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            expect(result).toBeInstanceOf(Set);
            expect(result.has('ETH')).toBe(true);
            expect(result.has('PSY')).toBe(true);
            expect(result.has('SDV')).toBe(true);
            expect(result.has(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE)).toBe(true);
            expect(result.size).toBe(4);
        });

        test('returns a Set containing only the hardcoded unclassified code when deniedSensitiveCategories is empty array (DCON-4892)', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: []
                    }
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(1);
            expect(result.has(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE)).toBe(true);
        });

        test('returns a Set containing only the hardcoded unclassified code when deniedSensitiveCategories is undefined (DCON-4892)', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {}
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(1);
            expect(result.has(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE)).toBe(true);
        });

        test('always folds in the hardcoded unclassified code regardless of what the grantor Consent denies -- mirrors DataSharingManager.updateQueryForDelegatedAccessSensitiveData (DCON-4892)', () => {
            const enrichmentContext = {
                actor: {
                    _filteringRules: {
                        deniedSensitiveCategories: ['some-other-category']
                    }
                }
            };

            const result = provider.getDeniedSensitiveCategorySet(enrichmentContext);

            // 'unclassified' is present even though the grantor's Consent never mentioned it.
            expect(result.has(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE)).toBe(true);
            expect(result.has('some-other-category')).toBe(true);
        });
    });

    describe('enrichAsync', () => {
        test('returns resources unchanged when enableDelegatedAccessDetection is false', async () => {
            mockConfigManager.enableDelegatedAccessDetection = false;
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).not.toHaveBeenCalled();
            expect(result).toBe(resources);
        });

        test('returns resources unchanged when userType is not delegatedUser', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = {
                userType: 'admin',
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).not.toHaveBeenCalled();
            expect(result).toBe(resources);
        });

        test('returns resources unchanged when enrichmentContext is undefined', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext: undefined });

            expect(filterCompositionSensitiveSections).not.toHaveBeenCalled();
            expect(result).toBe(resources);
        });

        test('returns resources unchanged when deniedSensitiveCategorySet is null (no filtering rules)', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: {}
            };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).not.toHaveBeenCalled();
            expect(result).toBe(resources);
        });

        test('calls filterCompositionSensitiveSections for Composition resources', async () => {
            const resource = { resourceType: 'Composition', section: [{ title: 'section1' }] };
            const resources = [resource];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH', 'PSY'] } }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
            expect(filterCompositionSensitiveSections).toHaveBeenCalledWith(
                resource,
                expect.any(Set)
            );
            // Verify the Set contains correct values
            const passedSet = filterCompositionSensitiveSections.mock.calls[0][1];
            expect(passedSet.has('ETH')).toBe(true);
            expect(passedSet.has('PSY')).toBe(true);
            expect(passedSet.has(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE)).toBe(true);
        });

        test('does NOT call filterCompositionSensitiveSections for non-Composition resources', async () => {
            const resources = [
                { resourceType: 'Patient' },
                { resourceType: 'Observation' }
            ];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).not.toHaveBeenCalled();
        });

        test('processes multiple Composition resources', async () => {
            const resources = [
                { resourceType: 'Composition', section: [] },
                { resourceType: 'Patient' },
                { resourceType: 'Composition', section: [{ title: 'sec' }] }
            ];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).toHaveBeenCalledTimes(2);
        });

        test('processes contained resources recursively', async () => {
            const containedComposition = { resourceType: 'Composition', section: [{ title: 'inner' }] };
            const resources = [{
                resourceType: 'Bundle',
                contained: [containedComposition]
            }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).toHaveBeenCalledWith(
                containedComposition,
                expect.any(Set)
            );
        });

        test('does NOT recurse into contained when it is empty', async () => {
            const resources = [{
                resourceType: 'Composition',
                section: [],
                contained: []
            }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            // Only called once for the parent Composition, not for contained
            expect(filterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
        });

        test('does NOT recurse when resource has no contained field', async () => {
            const resources = [{
                resourceType: 'Composition',
                section: []
            }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
        });

        test('handles resource being null/undefined in array', async () => {
            const resources = [null, undefined];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            // resource?.resourceType will be undefined so no filtering happens
            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).not.toHaveBeenCalled();
            expect(result).toBe(resources);
        });

        test('returns resources array reference', async () => {
            const resources = [{ resourceType: 'Composition', section: [] }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            const result = await provider.enrichAsync({ resources, parsedArgs: {}, enrichmentContext });

            expect(result).toBe(resources);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('enriches each entry resource', async () => {
            const entries = [
                { resource: { resourceType: 'Composition', section: [] } },
                { resource: { resourceType: 'Patient' } }
            ];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {}, enrichmentContext });

            expect(filterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
        });

        test('skips entries without resource', async () => {
            const entries = [
                { resource: { resourceType: 'Composition', section: [] } },
                { fullUrl: 'http://example.com' }
            ];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {}, enrichmentContext });

            expect(result).toHaveLength(2);
            expect(filterCompositionSensitiveSections).toHaveBeenCalledTimes(1);
        });

        test('handles empty entries array', async () => {
            const entries = [];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {}, enrichmentContext });

            expect(result).toEqual([]);
        });

        test('returns entries array reference', async () => {
            const entries = [{ resource: { resourceType: 'Patient' } }];
            const enrichmentContext = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { _filteringRules: { deniedSensitiveCategories: ['ETH'] } }
            };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {}, enrichmentContext });

            expect(result).toBe(entries);
        });
    });
});
