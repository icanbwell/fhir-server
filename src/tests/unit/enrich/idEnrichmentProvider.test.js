'use strict';

const { describe, test, expect } = require('@jest/globals');
const { IdEnrichmentProvider } = require('../../../enrich/providers/idEnrichmentProvider');

describe('IdEnrichmentProvider', () => {
    const provider = new IdEnrichmentProvider();

    describe('enrichAsync', () => {
        test('replaces id with _sourceId when _sourceId exists', async () => {
            const resources = [
                { id: 'uuid-123', _sourceId: 'source-id-1', resourceType: 'Patient' }
            ];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result[0].id).toBe('source-id-1');
        });

        test('does not change id when _sourceId is absent', async () => {
            const resources = [
                { id: 'uuid-123', resourceType: 'Patient' }
            ];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result[0].id).toBe('uuid-123');
        });

        test('does not change id when _sourceId is null', async () => {
            const resources = [
                { id: 'uuid-123', _sourceId: null, resourceType: 'Patient' }
            ];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result[0].id).toBe('uuid-123');
        });

        test('does not change id when _sourceId is empty string', async () => {
            const resources = [
                { id: 'uuid-123', _sourceId: '', resourceType: 'Patient' }
            ];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result[0].id).toBe('uuid-123');
        });

        test('processes multiple resources', async () => {
            const resources = [
                { id: 'u1', _sourceId: 'src-1' },
                { id: 'u2', _sourceId: 'src-2' },
                { id: 'u3' }
            ];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result[0].id).toBe('src-1');
            expect(result[1].id).toBe('src-2');
            expect(result[2].id).toBe('u3');
        });

        test('returns same array reference', async () => {
            const resources = [{ id: 'u1', _sourceId: 's1' }];
            const result = await provider.enrichAsync({ resources, parsedArgs: {} });
            expect(result).toBe(resources);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('returns entries unchanged (pass-through)', async () => {
            const entries = [{ resource: { id: '1' } }];
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: {} });
            expect(result).toBe(entries);
        });
    });
});
