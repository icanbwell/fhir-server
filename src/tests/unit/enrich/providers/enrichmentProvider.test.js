const { describe, test, expect } = require('@jest/globals');

const { EnrichmentProvider } = require('../../../../enrich/providers/enrichmentProvider');

describe('EnrichmentProvider', () => {
    describe('enrichAsync', () => {
        test('throws Not Implemented error when called directly', async () => {
            const provider = new EnrichmentProvider();

            await expect(
                provider.enrichAsync({
                    resources: [],
                    parsedArgs: {},
                    enrichmentContext: undefined
                })
            ).rejects.toThrow('Not Implemented');
        });

        test('throws Not Implemented error with resources provided', async () => {
            const provider = new EnrichmentProvider();
            const resources = [{ id: '1', resourceType: 'Patient' }];

            await expect(
                provider.enrichAsync({
                    resources,
                    parsedArgs: { base_version: '4_0_0' },
                    enrichmentContext: { userType: 'practitioner', actor: null }
                })
            ).rejects.toThrow('Not Implemented');
        });

        test('throws an Error instance (not just a string)', async () => {
            const provider = new EnrichmentProvider();

            try {
                await provider.enrichAsync({
                    resources: [],
                    parsedArgs: {},
                    enrichmentContext: undefined
                });
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBeInstanceOf(Error);
                expect(e.message).toBe('Not Implemented');
            }
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('throws Not Implemented error when called directly', async () => {
            const provider = new EnrichmentProvider();

            await expect(
                provider.enrichBundleEntriesAsync({
                    entries: [],
                    parsedArgs: {},
                    enrichmentContext: undefined
                })
            ).rejects.toThrow('Not Implemented');
        });

        test('throws Not Implemented error with entries provided', async () => {
            const provider = new EnrichmentProvider();
            const entries = [{ resource: { id: '1', resourceType: 'Patient' } }];

            await expect(
                provider.enrichBundleEntriesAsync({
                    entries,
                    parsedArgs: { base_version: '4_0_0' },
                    enrichmentContext: { userType: 'patient', actor: { reference: 'Patient/1' } }
                })
            ).rejects.toThrow('Not Implemented');
        });

        test('throws an Error instance (not just a string)', async () => {
            const provider = new EnrichmentProvider();

            try {
                await provider.enrichBundleEntriesAsync({
                    entries: [],
                    parsedArgs: {},
                    enrichmentContext: undefined
                });
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(e).toBeInstanceOf(Error);
                expect(e.message).toBe('Not Implemented');
            }
        });
    });

    describe('subclass behavior', () => {
        test('subclass can override enrichAsync without error', async () => {
            class MyProvider extends EnrichmentProvider {
                async enrichAsync({ resources }) {
                    return resources.map(r => ({ ...r, enriched: true }));
                }
            }

            const provider = new MyProvider();
            const resources = [{ id: '1', resourceType: 'Patient' }];

            const result = await provider.enrichAsync({
                resources,
                parsedArgs: {},
                enrichmentContext: undefined
            });

            expect(result).toEqual([{ id: '1', resourceType: 'Patient', enriched: true }]);
        });

        test('subclass can override enrichBundleEntriesAsync without error', async () => {
            class MyProvider extends EnrichmentProvider {
                async enrichBundleEntriesAsync({ entries }) {
                    return entries.map(e => ({ ...e, processed: true }));
                }
            }

            const provider = new MyProvider();
            const entries = [{ resource: { id: '1' } }];

            const result = await provider.enrichBundleEntriesAsync({
                entries,
                parsedArgs: {},
                enrichmentContext: undefined
            });

            expect(result).toEqual([{ resource: { id: '1' }, processed: true }]);
        });

        test('subclass that does not override enrichAsync still throws Not Implemented', async () => {
            class PartialProvider extends EnrichmentProvider {
                async enrichBundleEntriesAsync({ entries }) {
                    return entries;
                }
            }

            const provider = new PartialProvider();

            await expect(
                provider.enrichAsync({ resources: [], parsedArgs: {}, enrichmentContext: undefined })
            ).rejects.toThrow('Not Implemented');
        });

        test('subclass that does not override enrichBundleEntriesAsync still throws Not Implemented', async () => {
            class PartialProvider extends EnrichmentProvider {
                async enrichAsync({ resources }) {
                    return resources;
                }
            }

            const provider = new PartialProvider();

            await expect(
                provider.enrichBundleEntriesAsync({ entries: [], parsedArgs: {}, enrichmentContext: undefined })
            ).rejects.toThrow('Not Implemented');
        });
    });
});
