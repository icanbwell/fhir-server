const { describe, test, expect } = require('@jest/globals');
const { buildContextDataForHybridStorage, USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');

describe('buildContextDataForHybridStorage', () => {
    test('exports USE_EXTERNAL_MEMBER_STORAGE_HEADER constant', () => {
        expect(USE_EXTERNAL_MEMBER_STORAGE_HEADER).toBe('useexternalmemberstorage');
    });

    test('returns useExternalMemberStorage=true when header is present', () => {
        const requestInfo = {
            headers: { [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true' }
        };
        const result = buildContextDataForHybridStorage('Group', { id: 'g1', member: [] }, requestInfo);
        expect(result.useExternalMemberStorage).toBe(true);
    });

    test('returns useExternalMemberStorage=false when header is absent', () => {
        const requestInfo = { headers: {} };
        const result = buildContextDataForHybridStorage('Group', { id: 'g1', member: [] }, requestInfo);
        expect(result.useExternalMemberStorage).toBe(false);
    });

    test('returns useExternalMemberStorage=false when requestInfo is null', () => {
        const result = buildContextDataForHybridStorage('Group', { id: 'g1', member: [] }, null);
        expect(result.useExternalMemberStorage).toBe(false);
    });

    test('returns null for non-Group resources', () => {
        const requestInfo = { headers: { [USE_EXTERNAL_MEMBER_STORAGE_HEADER]: 'true' } };
        const result = buildContextDataForHybridStorage('Patient', { id: 'p1' }, requestInfo);
        expect(result).toBeNull();
    });
});
