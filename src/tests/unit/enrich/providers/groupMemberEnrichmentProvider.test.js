const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { GroupMemberEnrichmentProvider } = require('../../../../enrich/providers/groupMemberEnrichmentProvider');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../utils/contextDataBuilder');

/**
 * B7 - Surface ClickHouse read failures instead of masking them as quantity=0.
 *
 * Previously, a ClickHouse read error during Group enrichment returned
 * quantity: 0 with a 200 OK, silently reporting an empty Group. These tests
 * verify the error now propagates so the request fails loudly.
 */
describe('GroupMemberEnrichmentProvider read-failure surfacing (B7)', () => {
    let mockClickHouseClientManager;
    let mockConfigManager;
    let provider;

    const parsedArgs = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };
    const groupResource = { resourceType: 'Group', id: 'group-1', member: [{ entity: { reference: 'Patient/1' } }] };

    beforeEach(() => {
        mockClickHouseClientManager = {
            queryAsync: jest.fn()
        };
        mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };
        provider = new GroupMemberEnrichmentProvider({
            clickHouseClientManager: mockClickHouseClientManager,
            configManager: mockConfigManager
        });
    });

    test('enrichAsync propagates a ClickHouse read error (does not return quantity=0)', async () => {
        mockClickHouseClientManager.queryAsync.mockRejectedValue(new Error('ClickHouse read timeout'));

        await expect(
            provider.enrichAsync({ resources: [{ ...groupResource }], parsedArgs })
        ).rejects.toThrow('ClickHouse read timeout');
    });

    test('enrichBundleEntriesAsync propagates a ClickHouse read error', async () => {
        mockClickHouseClientManager.queryAsync.mockRejectedValue(new Error('ClickHouse read timeout'));

        await expect(
            provider.enrichBundleEntriesAsync({
                entries: [{ resource: { ...groupResource } }],
                parsedArgs
            })
        ).rejects.toThrow('ClickHouse read timeout');
    });

    test('on success, sets quantity from the count and strips member array', async () => {
        mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '5' }]);

        const [enriched] = await provider.enrichAsync({
            resources: [{ ...groupResource }],
            parsedArgs
        });

        expect(enriched.quantity).toBe(5);
        expect(enriched.member).toBeUndefined();
    });

    test('a genuinely empty Group still reports quantity=0 (only errors are surfaced)', async () => {
        // No rows returned => legitimately zero members, not an error
        mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

        const [enriched] = await provider.enrichAsync({
            resources: [{ ...groupResource }],
            parsedArgs
        });

        expect(enriched.quantity).toBe(0);
        expect(enriched.member).toBeUndefined();
    });

    test('skips enrichment (no query) when external storage header is absent', async () => {
        const result = await provider.enrichAsync({
            resources: [{ ...groupResource }],
            parsedArgs: { headers: {} }
        });

        expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        // Returned unchanged
        expect(result[0].member).toBeDefined();
    });
});
