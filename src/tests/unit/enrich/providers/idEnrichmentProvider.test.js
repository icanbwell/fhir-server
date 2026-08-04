const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { IdEnrichmentProvider } = require('../../../../enrich/providers/idEnrichmentProvider');

describe('IdEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new IdEnrichmentProvider();
    });

    describe('enrichAsync', () => {
        test('sets resource.id to resource._sourceId when _sourceId is present', async () => {
            const resources = [
                { id: 'original-id', _sourceId: 'source-123' },
                { id: 'other-id', _sourceId: 'source-456' }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('source-123');
            expect(result[1].id).toBe('source-456');
        });

        test('does NOT modify resource.id when _sourceId is not present', async () => {
            const resources = [
                { id: 'original-id' }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('original-id');
        });

        test('does NOT modify resource.id when _sourceId is falsy (empty string)', async () => {
            const resources = [
                { id: 'original-id', _sourceId: '' }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('original-id');
        });

        test('does NOT modify resource.id when _sourceId is null', async () => {
            const resources = [
                { id: 'original-id', _sourceId: null }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('original-id');
        });

        test('does NOT modify resource.id when _sourceId is undefined', async () => {
            const resources = [
                { id: 'original-id', _sourceId: undefined }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('original-id');
        });

        test('handles multiple resources with mixed _sourceId presence', async () => {
            const resources = [
                { id: 'id-1', _sourceId: 'source-1' },
                { id: 'id-2' },
                { id: 'id-3', _sourceId: 'source-3' }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('source-1');
            expect(result[1].id).toBe('id-2');
            expect(result[2].id).toBe('source-3');
        });

        test('handles empty resources array', async () => {
            const resources = [];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result).toEqual([]);
        });

        test('returns the same resources array reference', async () => {
            const resources = [{ id: 'id-1', _sourceId: 'source-1' }];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result).toBe(resources);
        });

        test('overwrites existing id with _sourceId value', async () => {
            const resources = [
                { id: 'will-be-overwritten', _sourceId: 'new-source-id' }
            ];

            const result = await provider.enrichAsync({ resources, parsedArgs: {} });

            expect(result[0].id).toBe('new-source-id');
            expect(result[0].id).not.toBe('will-be-overwritten');
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('returns entries unchanged', async () => {
            const entries = [
                { resource: { id: '1', _sourceId: 'src-1' }, fullUrl: 'http://example.com/1' },
                { resource: { id: '2' }, fullUrl: 'http://example.com/2' }
            ];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });

            expect(result).toBe(entries);
            // Importantly, entries are NOT modified - enrichBundleEntriesAsync just returns them as-is
            expect(result[0].resource.id).toBe('1');
        });

        test('returns empty entries array', async () => {
            const entries = [];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });

            expect(result).toEqual([]);
        });
    });
});
