const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock assertTypeEquals as no-op
jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

// Mock ParsedArgs
jest.mock('../../../operations/query/parsedArgs', () => ({
    ParsedArgs: class ParsedArgs {}
}));

// Mock Resource and BundleEntry
jest.mock('../../../fhir/classes/4_0_0/resources/resource', () => class Resource {});
jest.mock('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry', () => class BundleEntry {});

// Mock RethrownError
jest.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args }) {
            super(message);
            this.originalError = error;
            this.args = args;
        }
    }
}));

const { EnrichmentManager } = require('../../../enrich/enrich');
const { RethrownError } = require('../../../utils/rethrownError');

describe('EnrichmentManager', () => {
    let enrichmentManager;
    let mockParsedArgs;
    let mockEnrichmentContext;

    beforeEach(() => {
        mockParsedArgs = { base_version: '4_0_0' };
        mockEnrichmentContext = { scope: 'patient/*.read' };
    });

    describe('enrichAsync', () => {
        test('providers run in order and output of one feeds into next', async () => {
            const initialResources = [{ id: '1', resourceType: 'Patient' }];
            const afterProvider1 = [{ id: '1', resourceType: 'Patient', enriched1: true }];
            const afterProvider2 = [{ id: '1', resourceType: 'Patient', enriched1: true, enriched2: true }];

            const provider1 = {
                enrichAsync: jest.fn().mockResolvedValue(afterProvider1)
            };
            const provider2 = {
                enrichAsync: jest.fn().mockResolvedValue(afterProvider2)
            };

            enrichmentManager = new EnrichmentManager({
                enrichmentProviders: [provider1, provider2]
            });

            const result = await enrichmentManager.enrichAsync({
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

        test('CRITICAL: RethrownError leaks PHI resource data in error args', async () => {
            // The RethrownError includes `resources` and `parsedArgs` in args.
            // If this error propagates to the client (via error handler), it could
            // expose PHI data and authentication context in error messages.
            const sensitiveResources = [
                { id: '1', resourceType: 'Patient', name: 'John Doe', ssn: '123-45-6789' }
            ];

            const failingProvider = {
                enrichAsync: jest.fn().mockRejectedValue(new Error('enrichment failed'))
            };

            enrichmentManager = new EnrichmentManager({
                enrichmentProviders: [failingProvider]
            });

            let thrownError;
            try {
                await enrichmentManager.enrichAsync({
                    resources: sensitiveResources,
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                });
            } catch (e) {
                thrownError = e;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError).toBeInstanceOf(RethrownError);
            // BUG: The error args contain the actual PHI resources.
            // A correct implementation should NOT include resource data in error args.
            // This test asserts CORRECT behavior: error should not contain resource data.
            expect(thrownError.args).not.toHaveProperty('resources');
        });

        test('BUG: provider returning undefined causes next provider to receive undefined resources', async () => {
            // If an enrichment provider returns undefined instead of the resources array,
            // the next provider receives undefined as resources, which either crashes
            // or silently produces empty results.
            const initialResources = [{ id: '1', resourceType: 'Patient' }];

            const brokenProvider = {
                enrichAsync: jest.fn().mockResolvedValue(undefined)
            };
            const nextProvider = {
                enrichAsync: jest.fn().mockResolvedValue([])
            };

            enrichmentManager = new EnrichmentManager({
                enrichmentProviders: [brokenProvider, nextProvider]
            });

            // BUG: The code should validate provider output, but it doesn't.
            // A correct implementation should throw or skip if provider returns undefined.
            // This test asserts CORRECT behavior: should throw or not pass undefined to next provider.
            await expect(
                enrichmentManager.enrichAsync({
                    resources: initialResources,
                    parsedArgs: mockParsedArgs,
                    enrichmentContext: mockEnrichmentContext
                })
            ).rejects.toThrow();
        });

        test('BUG: earlier provider can corrupt resources by removing security tags', async () => {
            // If an earlier provider removes security tags (meta.security) during enrichment,
            // later providers and the final output will be missing security context.
            // This could lead to data being served without proper access control metadata.
            const resourcesWithSecurityTags = [
                {
                    id: '1',
                    resourceType: 'Patient',
                    meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'bwell' }] }
                }
            ];
            const resourcesWithoutSecurityTags = [
                {
                    id: '1',
                    resourceType: 'Patient',
                    meta: {}
                }
            ];

            const corruptingProvider = {
                enrichAsync: jest.fn().mockResolvedValue(resourcesWithoutSecurityTags)
            };
            const nextProvider = {
                enrichAsync: jest.fn().mockResolvedValue(resourcesWithoutSecurityTags)
            };

            enrichmentManager = new EnrichmentManager({
                enrichmentProviders: [corruptingProvider, nextProvider]
            });

            const result = await enrichmentManager.enrichAsync({
                resources: resourcesWithSecurityTags,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            // BUG: Security tags have been stripped by the first provider.
            // A correct implementation should preserve or validate security tags
            // between provider executions.
            // This test asserts CORRECT behavior: security tags must be preserved.
            expect(result[0].meta.security).toBeDefined();
            expect(result[0].meta.security).toHaveLength(1);
            expect(result[0].meta.security[0].code).toBe('bwell');
        });

        test('single provider returns enriched resources successfully', async () => {
            const initialResources = [{ id: '1', resourceType: 'Observation' }];
            const enrichedResources = [{ id: '1', resourceType: 'Observation', enriched: true }];

            const provider = {
                enrichAsync: jest.fn().mockResolvedValue(enrichedResources)
            };

            enrichmentManager = new EnrichmentManager({
                enrichmentProviders: [provider]
            });

            const result = await enrichmentManager.enrichAsync({
                resources: initialResources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(enrichedResources);
        });

        test('no providers returns resources unchanged', async () => {
            const initialResources = [{ id: '1', resourceType: 'Patient' }];

            enrichmentManager = new EnrichmentManager({
                enrichmentProviders: []
            });

            const result = await enrichmentManager.enrichAsync({
                resources: initialResources,
                parsedArgs: mockParsedArgs,
                enrichmentContext: mockEnrichmentContext
            });

            expect(result).toEqual(initialResources);
        });
    });
});
