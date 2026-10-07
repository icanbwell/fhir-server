const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');
const { EnrichmentManager } = require('../../../enrich/enrich');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { IdEnrichmentProvider } = require('../../../enrich/providers/idEnrichmentProvider');

/**
 * Security tests for EnrichmentManager.
 *
 * 1. CRITICAL: RethrownError must not include resources/parsedArgs - leaks PHI in error messages
 * 2. Providers run in order and output feeds into next
 * 3. Error handling doesn't leak resource data
 * 4. A provider returning no resources surfaces as an error instead of silently empty results
 * 5. Real providers keep meta.security while enriching
 */

describe('EnrichmentManager', () => {
    let mockParsedArgs;
    let mockEnrichmentContext;

    beforeEach(() => {
        mockParsedArgs = new ParsedArgs({ base_version: '4_0_0' });
        mockEnrichmentContext = { scope: 'patient/*.read' };
    });

    describe('enrichAsync', () => {
        test('providers run in order and output of one feeds into next', async () => {
            const initialResources = [{ id: '1', resourceType: 'Patient' }];
            const afterProvider1 = [{ id: '1', resourceType: 'Patient', enriched1: true }];
            const afterProvider2 = [{ id: '1', resourceType: 'Patient', enriched1: true, enriched2: true }];

            const provider1 = {
                enrichAsync: jestGlobal.fn().mockResolvedValue(afterProvider1)
            };
            const provider2 = {
                enrichAsync: jestGlobal.fn().mockResolvedValue(afterProvider2)
            };

            const manager = new EnrichmentManager({
                enrichmentProviders: [provider1, provider2]
            });

            const result = await manager.enrichAsync({
                resources: initialResources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(afterProvider2);
            // Provider 1 receives initial resources
            expect(provider1.enrichAsync).toHaveBeenCalledWith({
                resources: initialResources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
            // Provider 2 receives output from provider 1
            expect(provider2.enrichAsync).toHaveBeenCalledWith({
                resources: afterProvider1,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });
        });

        test('CRITICAL: error handling leaks PHI resource data in error args', async () => {
            // The RethrownError includes `resources` and `parsedArgs` in args.
            // If this error propagates to the client (via error handler), it could
            // expose PHI data and authentication context in error messages.
            const sensitiveResources = [
                { id: '1', resourceType: 'Patient', name: 'John Doe', ssn: '123-45-6789' }
            ];

            const failingProvider = {
                enrichAsync: jestGlobal.fn().mockRejectedValue(new Error('enrichment failed'))
            };

            const manager = new EnrichmentManager({
                enrichmentProviders: [failingProvider]
            });

            let thrownError;
            try {
                await manager.enrichAsync({
                    resources: sensitiveResources,
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                });
            } catch (e) {
                thrownError = e;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError.message).toBe('Error in enrichAsync()');
            // BUG: The error args contain the actual PHI resources.
            // A correct implementation should NOT include resource data in error args.
            // This test asserts CORRECT behavior: error should not contain resource data.
            expect(thrownError.args).not.toHaveProperty('resources');
        });

        test('provider returning undefined surfaces as an error instead of silently empty results', async () => {
            // Real providers iterate over `resources`, so the undefined handed on by the broken
            // provider makes the next provider throw; the manager must wrap and rethrow it.
            const brokenProvider = {
                enrichAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            const nextProvider = {
                enrichAsync: async ({ resources }) => {
                    for (const resource of resources) {
                        resource.enriched = true;
                    }
                    return resources;
                }
            };

            const manager = new EnrichmentManager({
                enrichmentProviders: [brokenProvider, nextProvider]
            });

            await expect(
                manager.enrichAsync({
                    resources: [{ id: '1', resourceType: 'Patient' }],
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow('Error in enrichAsync()');
        });

        test('real IdEnrichmentProvider rewrites id and keeps meta.security', async () => {
            const security = [{ system: 'https://www.icanbwell.com/access', code: 'bwell' }];
            const manager = new EnrichmentManager({
                enrichmentProviders: [new IdEnrichmentProvider()]
            });

            const result = await manager.enrichAsync({
                resources: [{ id: 'uuid-1', _sourceId: 'source-1', resourceType: 'Patient', meta: { security } }],
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result[0].id).toBe('source-1');
            expect(result[0].meta.security).toEqual(security);
        });

        test('single provider returns enriched resources successfully', async () => {
            const initialResources = [{ id: '1', resourceType: 'Observation' }];
            const enrichedResources = [{ id: '1', resourceType: 'Observation', enriched: true }];

            const provider = {
                enrichAsync: jestGlobal.fn().mockResolvedValue(enrichedResources)
            };

            const manager = new EnrichmentManager({
                enrichmentProviders: [provider]
            });

            const result = await manager.enrichAsync({
                resources: initialResources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(enrichedResources);
        });

        test('no providers returns resources unchanged', async () => {
            const initialResources = [{ id: '1', resourceType: 'Patient' }];

            const manager = new EnrichmentManager({
                enrichmentProviders: []
            });

            const result = await manager.enrichAsync({
                resources: initialResources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(initialResources);
        });
    });
});
