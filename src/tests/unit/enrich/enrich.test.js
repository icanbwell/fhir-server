const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn((condition, message) => {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    })
}));

const { EnrichmentManager } = require('../../../enrich/enrich');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');

describe('EnrichmentManager', () => {
    let mockParsedArgs;
    let mockEnrichmentContext;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockParsedArgs = { base_version: '4_0_0', resourceType: 'Patient' };
        mockEnrichmentContext = { userType: 'practitioner', actor: { reference: 'Practitioner/1' } };
    });

    describe('constructor', () => {
        test('stores enrichmentProviders array', () => {
            const providers = [{ enrichAsync: jestObj.fn() }];
            const manager = new EnrichmentManager({ enrichmentProviders: providers });

            expect(manager.enrichmentProviders).toBe(providers);
        });

        test('stores empty array when no providers given', () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });

            expect(manager.enrichmentProviders).toEqual([]);
        });
    });

    describe('enrichAsync', () => {
        test('calls assertTypeEquals on parsedArgs', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });

            await manager.enrichAsync({
                resources: [],
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(assertTypeEquals).toHaveBeenCalledWith(mockParsedArgs, expect.anything());
        });

        test('returns resources unchanged when no providers exist', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });
            const resources = [{ id: '1', resourceType: 'Patient' }];

            const result = await manager.enrichAsync({
                resources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(resources);
        });

        test('single provider enriches resources', async () => {
            const enrichedResources = [{ id: '1', resourceType: 'Patient', enriched: true }];
            const provider = {
                enrichAsync: jestObj.fn().mockResolvedValue(enrichedResources)
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });
            const resources = [{ id: '1', resourceType: 'Patient' }];

            const result = await manager.enrichAsync({
                resources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(enrichedResources);
            expect(provider.enrichAsync).toHaveBeenCalledWith({
                resources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
        });

        test('multiple providers are chained - output of one feeds to next', async () => {
            const initial = [{ id: '1', resourceType: 'Patient' }];
            const afterFirst = [{ id: '1', resourceType: 'Patient', step1: true }];
            const afterSecond = [{ id: '1', resourceType: 'Patient', step1: true, step2: true }];

            const provider1 = { enrichAsync: jestObj.fn().mockResolvedValue(afterFirst) };
            const provider2 = { enrichAsync: jestObj.fn().mockResolvedValue(afterSecond) };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider1, provider2] });

            const result = await manager.enrichAsync({
                resources: initial,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(afterSecond);
            expect(provider1.enrichAsync).toHaveBeenCalledWith({
                resources: initial,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
            expect(provider2.enrichAsync).toHaveBeenCalledWith({
                resources: afterFirst,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
        });

        test('three providers execute in order', async () => {
            const callOrder = [];
            const makeProvider = (name, result) => ({
                enrichAsync: jestObj.fn().mockImplementation(async () => {
                    callOrder.push(name);
                    return result;
                })
            });

            const p1 = makeProvider('p1', [{ id: '1', step: 1 }]);
            const p2 = makeProvider('p2', [{ id: '1', step: 2 }]);
            const p3 = makeProvider('p3', [{ id: '1', step: 3 }]);

            const manager = new EnrichmentManager({ enrichmentProviders: [p1, p2, p3] });

            await manager.enrichAsync({
                resources: [{ id: '1' }],
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(callOrder).toEqual(['p1', 'p2', 'p3']);
        });

        test('wraps provider error in RethrownError', async () => {
            const originalError = new Error('provider failed');
            const provider = {
                enrichAsync: jestObj.fn().mockRejectedValue(originalError)
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });

            await expect(
                manager.enrichAsync({
                    resources: [{ id: '1' }],
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow('Error in enrichAsync()');
        });

        test('error retains original error information', async () => {
            const originalError = new Error('connection timeout');
            const provider = {
                enrichAsync: jestObj.fn().mockRejectedValue(originalError)
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });

            try {
                await manager.enrichAsync({
                    resources: [{ id: '1' }],
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                });
                expect(true).toBe(false); // Should not reach
            } catch (e) {
                expect(e.message).toBe('Error in enrichAsync()');
                // RethrownError stores the nested error
                expect(e.nested || e.original_error).toBeDefined();
            }
        });

        test('passes enrichmentContext to provider', async () => {
            const provider = {
                enrichAsync: jestObj.fn().mockResolvedValue([])
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });
            const context = { userType: 'patient', actor: { reference: 'Patient/123' } };

            await manager.enrichAsync({
                resources: [],
                parsedArgs: mockParsedArgs,
                enrichmentContext: context
            });

            expect(provider.enrichAsync).toHaveBeenCalledWith(
                expect.objectContaining({ enrichmentContext: context })
            );
        });

        test('handles undefined enrichmentContext', async () => {
            const provider = {
                enrichAsync: jestObj.fn().mockResolvedValue([{ id: '1' }])
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });

            const result = await manager.enrichAsync({
                resources: [{ id: '1' }],
                parsedArgs: mockParsedArgs,
                enrichmentContext: undefined
            });

            expect(result).toEqual([{ id: '1' }]);
            expect(provider.enrichAsync).toHaveBeenCalledWith(
                expect.objectContaining({ enrichmentContext: undefined })
            );
        });

        test('second provider error still wraps in RethrownError', async () => {
            const provider1 = {
                enrichAsync: jestObj.fn().mockResolvedValue([{ id: '1', step1: true }])
            };
            const provider2 = {
                enrichAsync: jestObj.fn().mockRejectedValue(new Error('second failed'))
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider1, provider2] });

            await expect(
                manager.enrichAsync({
                    resources: [{ id: '1' }],
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow('Error in enrichAsync()');

            // First provider was called successfully
            expect(provider1.enrichAsync).toHaveBeenCalled();
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('validates entries is not null', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });

            await expect(
                manager.enrichBundleEntriesAsync({
                    entries: null,
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow();
        });

        test('validates entries is not undefined', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });

            await expect(
                manager.enrichBundleEntriesAsync({
                    entries: undefined,
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow();
        });

        test('validates entries is an array', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });

            await expect(
                manager.enrichBundleEntriesAsync({
                    entries: 'not-an-array',
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow();
        });

        test('returns entries unchanged when no providers exist', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });
            const entries = [{ resource: { id: '1', resourceType: 'Patient' } }];

            const result = await manager.enrichBundleEntriesAsync({
                entries,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(entries);
        });

        test('single provider enriches bundle entries', async () => {
            const enrichedEntries = [{ resource: { id: '1' }, enriched: true }];
            const provider = {
                enrichBundleEntriesAsync: jestObj.fn().mockResolvedValue(enrichedEntries)
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });
            const entries = [{ resource: { id: '1' } }];

            const result = await manager.enrichBundleEntriesAsync({
                entries,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(enrichedEntries);
            expect(provider.enrichBundleEntriesAsync).toHaveBeenCalledWith({
                entries,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
        });

        test('multiple providers are chained for bundle entries', async () => {
            const initial = [{ resource: { id: '1' } }];
            const afterFirst = [{ resource: { id: '1' }, step1: true }];
            const afterSecond = [{ resource: { id: '1' }, step1: true, step2: true }];

            const provider1 = { enrichBundleEntriesAsync: jestObj.fn().mockResolvedValue(afterFirst) };
            const provider2 = { enrichBundleEntriesAsync: jestObj.fn().mockResolvedValue(afterSecond) };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider1, provider2] });

            const result = await manager.enrichBundleEntriesAsync({
                entries: initial,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(afterSecond);
            expect(provider1.enrichBundleEntriesAsync).toHaveBeenCalledWith({
                entries: initial,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
            expect(provider2.enrichBundleEntriesAsync).toHaveBeenCalledWith({
                entries: afterFirst,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
        });

        test('wraps provider error in RethrownError', async () => {
            const provider = {
                enrichBundleEntriesAsync: jestObj.fn().mockRejectedValue(new Error('bundle enrich failed'))
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });

            await expect(
                manager.enrichBundleEntriesAsync({
                    entries: [{ resource: { id: '1' } }],
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow('Error in enrichBundleEntriesAsync()');
        });

        test('validation error is wrapped in RethrownError', async () => {
            const manager = new EnrichmentManager({ enrichmentProviders: [] });

            // assertIsValid throws on null entries, which gets caught and rethrown
            await expect(
                manager.enrichBundleEntriesAsync({
                    entries: null,
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow('Error in enrichBundleEntriesAsync()');
        });

        test('passes enrichmentContext to bundle entry provider', async () => {
            const provider = {
                enrichBundleEntriesAsync: jestObj.fn().mockResolvedValue([])
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });
            const context = { userType: 'system', actor: null };

            await manager.enrichBundleEntriesAsync({
                entries: [],
                parsedArgs: mockParsedArgs,
                enrichmentContext: context
            });

            expect(provider.enrichBundleEntriesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ enrichmentContext: context })
            );
        });

        test('empty entries array with providers still calls providers', async () => {
            const provider = {
                enrichBundleEntriesAsync: jestObj.fn().mockResolvedValue([])
            };
            const manager = new EnrichmentManager({ enrichmentProviders: [provider] });

            const result = await manager.enrichBundleEntriesAsync({
                entries: [],
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual([]);
            expect(provider.enrichBundleEntriesAsync).toHaveBeenCalled();
        });
    });
});
