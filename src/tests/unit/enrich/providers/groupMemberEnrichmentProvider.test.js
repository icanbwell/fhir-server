const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../operations/common/logging', () => ({
    logDebug: jestObj.fn(),
    logError: jestObj.fn()
}));

jestObj.mock('../../../../constants/clickHouseConstants', () => ({
    TABLES: {
        GROUP_MEMBER_EVENTS: 'group_member_events'
    }
}));

jestObj.mock('../../../../utils/clickHouse/queryFragments', () => ({
    QueryFragments: {
        argMaxWithTieBreaker: jestObj.fn(() => 'argMax(event_type, version)'),
        whereGroupId: jestObj.fn(() => 'WHERE group_id = {groupId:String}'),
        groupByEntityReference: jestObj.fn(() => 'GROUP BY entity_reference'),
        activeMembers: jestObj.fn(() => "latest_event_type = 'add'")
    }
}));

jestObj.mock('../../../../utils/contextDataBuilder', () => ({
    USE_EXTERNAL_STORAGE_HEADER: 'useexternalstorage'
}));

jestObj.mock('../../../../utils/isTrue', () => ({
    isTrue: jestObj.fn((val) => String(val).toLowerCase() === 'true' || String(val).toLowerCase() === '1')
}));

const { GroupMemberEnrichmentProvider } = require('../../../../enrich/providers/groupMemberEnrichmentProvider');
const { logDebug, logError } = require('../../../../operations/common/logging');

describe('GroupMemberEnrichmentProvider', () => {
    let provider;
    let mockClickHouseClientManager;
    let mockConfigManager;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockClickHouseClientManager = {
            queryAsync: jestObj.fn()
        };

        mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group', 'Patient']
        };

        provider = new GroupMemberEnrichmentProvider({
            clickHouseClientManager: mockClickHouseClientManager,
            configManager: mockConfigManager
        });
    });

    describe('isEnabled', () => {
        test('returns true when ClickHouse is enabled and Group is in configured resources', () => {
            expect(provider.isEnabled()).toBe(true);
        });

        test('returns false when ClickHouse is disabled', () => {
            mockConfigManager.enableClickHouse = false;
            expect(provider.isEnabled()).toBe(false);
        });

        test('returns false when Group is not in mongoWithClickHouseResources', () => {
            mockConfigManager.mongoWithClickHouseResources = ['Patient'];
            expect(provider.isEnabled()).toBe(false);
        });

        test('returns false when mongoWithClickHouseResources is empty', () => {
            mockConfigManager.mongoWithClickHouseResources = [];
            expect(provider.isEnabled()).toBe(false);
        });
    });

    describe('enrichAsync', () => {
        const baseParsedArgs = {
            headers: { useexternalstorage: 'true' }
        };

        test('returns resources unchanged when not enabled', async () => {
            mockConfigManager.enableClickHouse = false;
            const resources = [{ resourceType: 'Group', id: 'group1', member: [{ entity: { reference: 'Patient/1' } }] }];

            const result = await provider.enrichAsync({ resources, parsedArgs: baseParsedArgs });

            expect(result).toEqual(resources);
        });

        test('returns resources unchanged when external storage header is not set', async () => {
            const resources = [{ resourceType: 'Group', id: 'group1', member: [{ entity: { reference: 'Patient/1' } }] }];
            const parsedArgs = { headers: {} };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result).toEqual(resources);
        });

        test('returns resources unchanged when headers is undefined', async () => {
            const resources = [{ resourceType: 'Group', id: 'group1' }];
            const parsedArgs = {};

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result).toEqual(resources);
        });

        test('enriches Group resources by removing member array and adding quantity', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '5' }]);

            const resources = [{
                resourceType: 'Group',
                id: 'group1',
                member: [{ entity: { reference: 'Patient/1' } }],
                name: 'Test Group'
            }];

            const result = await provider.enrichAsync({
                resources,
                parsedArgs: baseParsedArgs,
                enrichmentContext: { securityContext: { hasFullAccess: true } }
            });

            expect(result).toHaveLength(1);
            expect(result[0].member).toBeUndefined();
            expect(result[0].quantity).toBe(5);
            expect(result[0].name).toBe('Test Group');
            expect(result[0].id).toBe('group1');
        });

        test('does not enrich non-Group resources', async () => {
            const resources = [{
                resourceType: 'Patient',
                id: 'patient1',
                name: [{ family: 'Smith' }]
            }];

            const result = await provider.enrichAsync({ resources, parsedArgs: baseParsedArgs });

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(resources[0]);
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('handles mixed resources (Group and non-Group)', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '3' }]);

            const resources = [
                { resourceType: 'Group', id: 'group1', member: [{ entity: { reference: 'Patient/1' } }] },
                { resourceType: 'Patient', id: 'patient1' }
            ];

            const result = await provider.enrichAsync({
                resources,
                parsedArgs: baseParsedArgs,
                enrichmentContext: { securityContext: { hasFullAccess: true } }
            });

            expect(result).toHaveLength(2);
            expect(result[0].member).toBeUndefined();
            expect(result[0].quantity).toBe(3);
            expect(result[1]).toEqual(resources[1]);
        });

        test('returns resources unchanged on error and logs the error', async () => {
            mockClickHouseClientManager.queryAsync.mockRejectedValue(new Error('Connection failed'));

            const resources = [{ resourceType: 'Group', id: 'group1', member: [] }];

            const result = await provider.enrichAsync({ resources, parsedArgs: baseParsedArgs });

            // On error in the outer try/catch, returns resources unchanged
            // But the inner _enrichGroupResource catch will strip member and set quantity=0
            // The outer catch only triggers if Promise.all itself fails (which it won't since
            // _enrichGroupResource has its own try/catch)
            expect(result).toHaveLength(1);
            expect(result[0].member).toBeUndefined();
            expect(result[0].quantity).toBe(0);
        });

        test('sets quantity to 0 when ClickHouse returns empty rows', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const resources = [{ resourceType: 'Group', id: 'group1', member: [] }];

            const result = await provider.enrichAsync({ resources, parsedArgs: baseParsedArgs });

            expect(result[0].quantity).toBe(0);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        const baseParsedArgs = {
            headers: { useexternalstorage: 'true' }
        };

        test('returns entries unchanged when not enabled', async () => {
            mockConfigManager.enableClickHouse = false;
            const entries = [{ resource: { resourceType: 'Group', id: 'g1', member: [] } }];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: baseParsedArgs });

            expect(result).toEqual(entries);
        });

        test('returns entries unchanged when external storage header is not set', async () => {
            const entries = [{ resource: { resourceType: 'Group', id: 'g1', member: [] } }];
            const parsedArgs = { headers: {} };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result).toEqual(entries);
        });

        test('enriches Group entries by removing member and adding quantity', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '10' }]);

            const entries = [{
                resource: {
                    resourceType: 'Group',
                    id: 'group1',
                    member: [{ entity: { reference: 'Patient/1' } }],
                    name: 'Bundle Group'
                }
            }];

            const result = await provider.enrichBundleEntriesAsync({
                entries,
                parsedArgs: baseParsedArgs,
                enrichmentContext: { securityContext: { hasFullAccess: true } }
            });

            expect(result).toHaveLength(1);
            expect(result[0].resource.member).toBeUndefined();
            expect(result[0].resource.quantity).toBe(10);
            expect(result[0].resource.name).toBe('Bundle Group');
        });

        test('does not enrich non-Group entries', async () => {
            const entries = [{
                resource: { resourceType: 'Patient', id: 'p1' }
            }];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: baseParsedArgs });

            expect(result[0].resource).toEqual({ resourceType: 'Patient', id: 'p1' });
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('skips entries without a resource', async () => {
            const entries = [{ search: { mode: 'match' } }];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: baseParsedArgs });

            expect(result).toEqual(entries);
        });

        test('returns entries unchanged on error and logs the error', async () => {
            mockClickHouseClientManager.queryAsync.mockRejectedValue(new Error('ClickHouse down'));

            const entries = [{ resource: { resourceType: 'Group', id: 'g1', member: [] } }];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs: baseParsedArgs });

            // The inner _enrichGroupResource has its own try/catch
            expect(result).toHaveLength(1);
            expect(result[0].resource.member).toBeUndefined();
            expect(result[0].resource.quantity).toBe(0);
        });
    });

    describe('_enrichGroupResource', () => {
        test('removes member array and sets quantity from ClickHouse count', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '42' }]);

            const resource = {
                resourceType: 'Group',
                id: 'group1',
                member: [{ entity: { reference: 'Patient/1' } }, { entity: { reference: 'Patient/2' } }],
                type: 'person',
                actual: true
            };

            const result = await provider._enrichGroupResource(resource, { hasFullAccess: true });

            expect(result.member).toBeUndefined();
            expect(result.quantity).toBe(42);
            expect(result.type).toBe('person');
            expect(result.actual).toBe(true);
            expect(result.id).toBe('group1');
        });

        test('does not mutate the original resource', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '1' }]);

            const resource = {
                resourceType: 'Group',
                id: 'group1',
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            await provider._enrichGroupResource(resource, { hasFullAccess: true });

            // Original should still have member
            expect(resource.member).toBeDefined();
        });

        test('on ClickHouse error, strips member and sets quantity to 0', async () => {
            mockClickHouseClientManager.queryAsync.mockRejectedValue(new Error('Query failed'));

            const resource = {
                resourceType: 'Group',
                id: 'group1',
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            const result = await provider._enrichGroupResource(resource, { hasFullAccess: true });

            expect(result.member).toBeUndefined();
            expect(result.quantity).toBe(0);
            expect(logError).toHaveBeenCalled();
        });

        test('logs debug information during enrichment', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '7' }]);

            const resource = {
                resourceType: 'Group',
                id: 'group1',
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            await provider._enrichGroupResource(resource, { hasFullAccess: true });

            expect(logDebug).toHaveBeenCalledWith('Enriching Group resource', expect.objectContaining({
                groupId: 'group1',
                memberCount: 7,
                hadMemberArray: true
            }));
        });
    });

    describe('_getMemberCount', () => {
        test('returns parsed integer count from ClickHouse query', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '15' }]);

            const count = await provider._getMemberCount('group-123', { hasFullAccess: true });

            expect(count).toBe(15);
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    query_params: { groupId: 'group-123' }
                })
            );
        });

        test('returns 0 when query returns empty results', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            const count = await provider._getMemberCount('group-empty', { hasFullAccess: true });

            expect(count).toBe(0);
        });

        test('returns 0 on query error', async () => {
            mockClickHouseClientManager.queryAsync.mockRejectedValue(new Error('Timeout'));

            const count = await provider._getMemberCount('group-error', { hasFullAccess: true });

            expect(count).toBe(0);
            expect(logError).toHaveBeenCalledWith('Error querying member count from ClickHouse', expect.objectContaining({
                error: 'Timeout',
                groupId: 'group-error'
            }));
        });

        test('passes correct SQL query structure', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '0' }]);

            await provider._getMemberCount('group-abc', { hasFullAccess: true });

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('SELECT count() as count');
            expect(callArgs.query).toContain('group_member_events');
            expect(callArgs.query_params).toEqual({ groupId: 'group-abc' });
        });
    });

    describe('_getMemberCount tenant filtering (EA-2335)', () => {
        test('applies access tags filter when provided', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '5' }]);

            const securityContext = {
                accessTags: ['client-a', 'client-b'],
                ownerTags: [],
                hasFullAccess: false
            };

            const count = await provider._getMemberCount('group-1', securityContext);

            expect(count).toBe(5);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('hasAny(argMaxMerge(access_tags)');
            expect(callArgs.query_params.accessTags).toEqual(['client-a', 'client-b']);
        });

        test('applies owner tags filter when provided', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '3' }]);

            const securityContext = {
                accessTags: [],
                ownerTags: ['bwell', 'healthsystem'],
                hasFullAccess: false
            };

            const count = await provider._getMemberCount('group-2', securityContext);

            expect(count).toBe(3);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('hasAny(argMaxMerge(owner_tags)');
            expect(callArgs.query_params.ownerTags).toEqual(['bwell', 'healthsystem']);
        });

        test('applies both access and owner tags when both provided', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '2' }]);

            const securityContext = {
                accessTags: ['client-a'],
                ownerTags: ['bwell'],
                hasFullAccess: false
            };

            const count = await provider._getMemberCount('group-3', securityContext);

            expect(count).toBe(2);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).toContain('hasAny(argMaxMerge(access_tags)');
            expect(callArgs.query).toContain('hasAny(argMaxMerge(owner_tags)');
            expect(callArgs.query_params.accessTags).toEqual(['client-a']);
            expect(callArgs.query_params.ownerTags).toEqual(['bwell']);
        });

        test('bypasses tag filtering for admin (hasFullAccess)', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '100' }]);

            const securityContext = {
                accessTags: [],
                ownerTags: [],
                hasFullAccess: true
            };

            const count = await provider._getMemberCount('group-admin', securityContext);

            expect(count).toBe(100);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query).not.toContain('hasAny(argMaxMerge(access_tags)');
            expect(callArgs.query).not.toContain('hasAny(argMaxMerge(owner_tags)');
            expect(callArgs.query_params.accessTags).toBeUndefined();
            expect(callArgs.query_params.ownerTags).toBeUndefined();
        });

        test('handles empty securityContext (defense in depth)', async () => {
            // Fail closed: when no security tags and not admin, return 0 without querying
            // This prevents leaking cross-tenant member counts when securityContext is empty
            const count = await provider._getMemberCount('group-4', {});

            expect(count).toBe(0);
            // Should NOT call ClickHouse at all - fail closed before querying
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('handles null/undefined securityContext gracefully', async () => {
            // Fail closed: null context is coerced to {}, which triggers fail-closed guard
            const count = await provider._getMemberCount('group-5', null);

            expect(count).toBe(0);
            // Should NOT call ClickHouse - fail closed
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('handles undefined securityContext parameter', async () => {
            // Fail closed: undefined uses default parameter value {}, which triggers fail-closed guard
            const count = await provider._getMemberCount('group-6');

            expect(count).toBe(0);
            // Should NOT call ClickHouse - fail closed
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('uses GROUP_MEMBER_CURRENT table with FINAL', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '10' }]);

            const securityContext = {
                accessTags: ['client-a'],
                ownerTags: [],
                hasFullAccess: false
            };

            await provider._getMemberCount('group-7', securityContext);

            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            // Should use the materialized view with FINAL for efficiency
            expect(callArgs.query).toContain('FINAL');
        });

        test('logs security context information', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '8' }]);

            const securityContext = {
                accessTags: ['client-x'],
                ownerTags: ['org-y'],
                hasFullAccess: false
            };

            await provider._getMemberCount('group-8', securityContext);

            expect(logDebug).toHaveBeenCalledWith(
                'ClickHouse member count query result',
                expect.objectContaining({
                    groupId: 'group-8',
                    hasSecurityContext: true,
                    accessTagsCount: 1,
                    ownerTagsCount: 1,
                    hasFullAccess: false
                })
            );
        });
    });

    describe('enrichAsync with security context (EA-2335)', () => {
        const baseParsedArgs = {
            headers: { useexternalstorage: 'true' }
        };

        test('passes securityContext to _getMemberCount', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '5' }]);

            const resources = [{
                resourceType: 'Group',
                id: 'group1',
                member: [{ entity: { reference: 'Patient/1' } }]
            }];

            const enrichmentContext = {
                userType: 'admin',
                actor: 'user-1',
                securityContext: {
                    accessTags: ['client-a'],
                    ownerTags: [],
                    hasFullAccess: false
                }
            };

            const result = await provider.enrichAsync({
                resources,
                parsedArgs: baseParsedArgs,
                enrichmentContext
            });

            expect(result[0].quantity).toBe(5);
            const callArgs = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(callArgs.query_params.accessTags).toEqual(['client-a']);
        });

        test('handles missing enrichmentContext gracefully', async () => {
            const resources = [{
                resourceType: 'Group',
                id: 'group2',
                member: []
            }];

            const result = await provider.enrichAsync({
                resources,
                parsedArgs: baseParsedArgs,
                enrichmentContext: undefined
            });

            // Fail closed: no enrichmentContext → no security tags → quantity = 0
            expect(result[0].quantity).toBe(0);
            expect(result[0].member).toBeUndefined();
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('handles enrichmentContext without securityContext', async () => {
            const resources = [{
                resourceType: 'Group',
                id: 'group3',
                member: []
            }];

            const enrichmentContext = {
                userType: 'admin',
                actor: 'user-1'
                // No securityContext field
            };

            const result = await provider.enrichAsync({
                resources,
                parsedArgs: baseParsedArgs,
                enrichmentContext
            });

            // Fail closed: no securityContext → no security tags → quantity = 0
            expect(result[0].quantity).toBe(0);
            expect(result[0].member).toBeUndefined();
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });
    });
});
