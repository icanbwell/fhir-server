const { describe, test, expect } = require('@jest/globals');
const { buildContextDataForHybridStorage, USE_EXTERNAL_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');

describe('buildContextDataForHybridStorage', () => {
    test('exports USE_EXTERNAL_STORAGE_HEADER constant', () => {
        expect(USE_EXTERNAL_STORAGE_HEADER).toBe('useexternalstorage');
    });

    test('returns useExternalStorage=true when header is present', () => {
        const requestInfo = {
            headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' }
        };
        const result = buildContextDataForHybridStorage('Group', { id: 'g1', member: [] }, requestInfo);
        expect(result.useExternalStorage).toBe(true);
    });

    test('returns useExternalStorage=false when header is absent', () => {
        const requestInfo = { headers: {} };
        const result = buildContextDataForHybridStorage('Group', { id: 'g1', member: [] }, requestInfo);
        expect(result.useExternalStorage).toBe(false);
    });

    test('returns useExternalStorage=false when requestInfo is null', () => {
        const result = buildContextDataForHybridStorage('Group', { id: 'g1', member: [] }, null);
        expect(result.useExternalStorage).toBe(false);
    });

    test('returns null for non-Group resources', () => {
        const requestInfo = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };
        const result = buildContextDataForHybridStorage('Patient', { id: 'p1' }, requestInfo);
        expect(result).toBeNull();
    });
});
