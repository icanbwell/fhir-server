const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { MongoWithClickHouseStorageProvider } = require('../../../../dataLayer/providers/mongoWithClickHouseStorageProvider');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');
const { STORAGE_PROVIDER_TYPES } = require('../../../../dataLayer/providers/storageProviderTypes');
const { QueryFragments } = require('../../../../utils/clickHouse/queryFragments');
const { QueryParser } = require('../../../../dataLayer/providers/mongoWithClickHouse/queryParser');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../utils/contextDataBuilder');

const extraInfoWithHeader = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };

describe('MongoWithClickHouseStorageProvider', () => {
    let provider;
    let mockResourceLocator;
    let mockClickHouseClientManager;
    let mockMongoStorageProvider;
    let mockConfigManager;

    const withSecurityTags = (query) => ({
        ...query,
        '_access.test': 1,
        'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/owner', code: 'bwell' } }
    });

    beforeEach(() => {
        mockResourceLocator = {
            _resourceType: 'Group',
            _base_version: '4_0_0'
        };

        mockClickHouseClientManager = {
            queryAsync: jest.fn(),
            insertAsync: jest.fn()
        };

        mockMongoStorageProvider = {
            findAsync: jest.fn(),
            findOneAsync: jest.fn(),
            countAsync: jest.fn()
        };

        mockConfigManager = {
            clickHouseFallbackToMongo: false
        };

        provider = new MongoWithClickHouseStorageProvider({
            resourceLocator: mockResourceLocator,
            clickHouseClientManager: mockClickHouseClientManager,
            mongoStorageProvider: mockMongoStorageProvider,
            configManager: mockConfigManager
        });
    });

    describe('_isMemberQuery', () => {
        test.each([
            [{ 'member.entity._uuid': 'abc-123' }, true],
            [{ 'member.entity._sourceId': 'patient-1' }, true],
            [{ 'member.entity.reference': 'Patient/123' }, true],
            [{ member: 'Patient/123' }, true],
            [{ $and: [{ 'member.entity._uuid': 'abc' }] }, true],
            [{ $or: [{ 'member.entity.reference': 'Patient/1' }] }, true],
            [{ id: 'group-1' }, false],
            [{ name: 'Test Group' }, false],
            [{ type: 'person' }, false],
            [{ $and: [{ id: 'group-1' }, { name: 'test' }] }, false]
        ])('should detect member query: %p => %p', (query, expected) => {
            expect(provider._isMemberQuery(query)).toBe(expected);
        });
    });

    describe('QueryParser.extractMemberCriteria', () => {
        test.each([
            [
                { 'member.entity._uuid': 'uuid-123' },
                { memberUuid: 'uuid-123', memberSourceId: null, memberReference: null }
            ],
            [
                { 'member.entity._sourceId': 'Patient/123' },
                { memberUuid: null, memberSourceId: 'Patient/123', memberReference: null }
            ],
            [
                { 'member.entity.reference': 'Patient/456' },
                { memberUuid: null, memberSourceId: null, memberReference: 'Patient/456' }
            ]
        ])('should extract criteria from %p', (query, expected) => {
            expect(QueryParser.extractMemberCriteria(query)).toEqual(expected);
        });
    });

    describe('findAsync', () => {
        test('should route metadata queries to MongoDB', async () => {
            const query = { id: 'group-123', active: true };
            const mockCursor = {};
            mockMongoStorageProvider.findAsync.mockResolvedValue(mockCursor);

            const result = await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalled();
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('should route member queries to ClickHouse', async () => {
            const query = withSecurityTags({ 'member.entity._sourceId': 'Patient/123' });
            const mockCursor = {};

            mockClickHouseClientManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' },
                { group_id: 'group-2' }
            ]);
            mockMongoStorageProvider.findAsync.mockResolvedValue(mockCursor);

            await provider.findAsync({ query, options: {}, extraInfo: extraInfoWithHeader });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: { id: { $in: ['group-1', 'group-2'] } },
                    extraInfo: extraInfoWithHeader
                })
            );
        });
    });

    describe('getStorageType', () => {
        test('should return "mongo-with-clickhouse"', () => {
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE);
        });
    });

    // Helper function tests removed - these methods were refactored into:
    // - GroupMemberEventBuilder (for event construction)
    // - SecurityTagExtractor (for tag extraction)

    describe('Edge Cases', () => {
        test('should handle MongoDB operator unwrapping in member queries', async () => {
            const query = withSecurityTags({ 'member.entity._sourceId': { $in: ['Patient/1', 'Patient/2'] } });

            mockClickHouseClientManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' }
            ]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: extraInfoWithHeader });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
        });

        test('should fallback to MongoDB when no member criteria extracted', async () => {
            const query = { 'member.invalid': 'test' };
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: {} });

            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalled();
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('should pass limit option to ClickHouse queries', async () => {
            const query = withSecurityTags({ 'member.entity._sourceId': 'Patient/123' });
            const options = { limit: 50 };

            mockClickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ group_id: 'group-1' }]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options, extraInfo: extraInfoWithHeader });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            const pageQueryCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(pageQueryCall.query_params.limit).toBe(50);
        });

        test('should use default limit of 100 when not specified', async () => {
            const query = withSecurityTags({ 'member.entity._sourceId': 'Patient/123' });
            const options = {};

            mockClickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ group_id: 'group-1' }]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options, extraInfo: extraInfoWithHeader });

            const pageQueryCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(pageQueryCall.query_params.limit).toBe(100);
        });

        test('should handle nested $and/$or queries', async () => {
            const query = withSecurityTags({
                $and: [{ 'member.entity._sourceId': 'Patient/123' }]
            });

            mockClickHouseClientManager.queryAsync.mockResolvedValue([
                { group_id: 'group-1' }
            ]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: extraInfoWithHeader });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
        });

        test('should handle empty ClickHouse result set', async () => {
            const query = withSecurityTags({ 'member.entity._sourceId': 'Patient/nonexistent' });

            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: extraInfoWithHeader });

            expect(mockMongoStorageProvider.findAsync).toHaveBeenCalledWith({
                query: { id: { $in: [] } },
                options: {},
                extraInfo: extraInfoWithHeader
            });
        });
    });

    describe('Error Handling', () => {
        test('should propagate ClickHouse query errors', async () => {
            const query = { 'member.entity._sourceId': 'Patient/123' };
            const error = new Error('ClickHouse connection failed');

            mockClickHouseClientManager.queryAsync.mockRejectedValue(error);

            await expect(
                provider.findAsync({ query, options: {}, extraInfo: extraInfoWithHeader })
            ).rejects.toThrow();
        });

        test('should propagate MongoDB query errors', async () => {
            const query = { id: 'group-1' };
            const error = new Error('MongoDB connection failed');

            mockMongoStorageProvider.findAsync.mockRejectedValue(error);

            await expect(
                provider.findAsync({ query, options: {}, extraInfo: {} })
            ).rejects.toThrow();
        });
    });

    describe('Constructor', () => {
        test('should initialize with required dependencies', () => {
            expect(provider.resourceLocator).toBe(mockResourceLocator);
            expect(provider.clickHouseClientManager).toBe(mockClickHouseClientManager);
            expect(provider.mongoStorageProvider).toBe(mockMongoStorageProvider);
            expect(provider.configManager).toBe(mockConfigManager);
        });
    });

    describe('QueryParser.extractSecurityTags', () => {
        test.each([
            [
                '$elemMatch access tag',
                { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'client1' } } },
                { accessTags: ['client1'], ownerTags: [] }
            ],
            [
                '$elemMatch owner tag',
                { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/owner', code: 'bwell' } } },
                { accessTags: [], ownerTags: ['bwell'] }
            ],
            [
                '_access.* index format',
                { '_access.client1': 1, '_access.client2': 1 },
                { accessTags: ['client1', 'client2'], ownerTags: [] }
            ],
            [
                'wildcard as literal',
                { '_access.*': 1 },
                { accessTags: ['*'], ownerTags: [] }
            ],
            [
                'no security tags',
                { 'member.entity.reference': 'Patient/123' },
                { accessTags: [], ownerTags: [] }
            ],
            [
                '$in operator',
                { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: { $in: ['c1', 'c2'] } } } },
                { accessTags: ['c1', 'c2'], ownerTags: [] }
            ],
            [
                '$eq operator',
                { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: { $eq: 'client1' } } } },
                { accessTags: ['client1'], ownerTags: [] }
            ]
        ])('%s', (_, query, expected) => {
            const result = QueryParser.extractSecurityTags(query);
            expect(result.accessTags).toEqual(expect.arrayContaining(expected.accessTags));
            expect(result.ownerTags).toEqual(expect.arrayContaining(expected.ownerTags));
            expect(result.accessTags.length).toBe(expected.accessTags.length);
            expect(result.ownerTags.length).toBe(expected.ownerTags.length);
        });

        test('deduplicates tags', () => {
            const query = { $and: [{ '_access.client1': 1 }, { '_access.client1': 1 }] };
            const { accessTags } = QueryParser.extractSecurityTags(query);
            expect(accessTags).toEqual(['client1']);
        });

        test('extracts from nested $and/$or', () => {
            const query = {
                $or: [
                    { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'c1' } } },
                    { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'c2' } } }
                ]
            };
            const { accessTags } = QueryParser.extractSecurityTags(query);
            expect(accessTags).toEqual(expect.arrayContaining(['c1', 'c2']));
        });

        test('ignores _access fields with non-1 values', () => {
            const query = { '_access.client1': 1, '_access.client2': 0 };
            const { accessTags } = QueryParser.extractSecurityTags(query);
            expect(accessTags).toEqual(['client1']);
        });
    });

    describe('Security Validation', () => {
        test.each([
            ['accessTags', []],
            ['ownerTags', []]
        ])('QueryFragments.where%s throws on empty array', (method, input) => {
            const func = method === 'accessTags' ? QueryFragments.whereAccessTags : QueryFragments.whereOwnerTags;
            expect(() => func(input)).toThrow('Security violation');
        });

        test('succeeds with valid security tags', async () => {
            const query = withSecurityTags({ 'member.entity._sourceId': 'Patient/test' });
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ group_id: 'group-1' }]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await provider.findAsync({ query, options: {}, extraInfo: extraInfoWithHeader });
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
        });
    });

    describe('getCurrentMembersWithCountAsync tenant scope', () => {
        // Note: the shared ServerError base rewrites the prototype, so instanceof/class
        // matching is unreliable. Assert on statusCode + message, matching repo convention.
        test('rejects with 403 when no tags and no full access (fail closed)', async () => {
            const err = await provider
                .getCurrentMembersWithCountAsync('group-1', {}, { hasFullAccess: false, accessTags: [], ownerTags: [] })
                .catch(e => e);

            expect(err.statusCode).toBe(403);
            expect(err.message).toContain('Cross-tenant access denied');
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('rejects with 403 when securityContext omitted (safe default)', async () => {
            const err = await provider.getCurrentMembersWithCountAsync('group-1', {}).catch(e => e);

            expect(err.statusCode).toBe(403);
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('admin with full access bypasses tag filtering and runs queries', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '2' }]);

            await provider.getCurrentMembersWithCountAsync('group-1', {}, { hasFullAccess: true });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalled();
            const rosterCall = mockClickHouseClientManager.queryAsync.mock.calls[1][0];
            expect(rosterCall.query).not.toContain('hasAny(access_tags');
        });

        test('threads accessTags into the roster query params', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '1' }]);

            await provider.getCurrentMembersWithCountAsync('group-1', {}, { accessTags: ['clientA'] });

            const rosterCall = mockClickHouseClientManager.queryAsync.mock.calls[1][0];
            expect(rosterCall.query_params.accessTags).toEqual(['clientA']);
        });

        test('threads accessTags into BOTH count and roster queries (a leaked count is a leak too)', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '1' }]);

            await provider.getCurrentMembersWithCountAsync('group-1', {}, { accessTags: ['clientA'] });

            // Promise.all runs left-to-right: call 0 = count, call 1 = roster
            const countCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            const rosterCall = mockClickHouseClientManager.queryAsync.mock.calls[1][0];
            expect(countCall.query_params.accessTags).toEqual(['clientA']);
            expect(rosterCall.query_params.accessTags).toEqual(['clientA']);
        });

        test('owner-only non-admin scope filters both queries and carries no accessTags param', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '1' }]);

            await provider.getCurrentMembersWithCountAsync('group-1', {}, { ownerTags: ['bwell'] });

            const countCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            const rosterCall = mockClickHouseClientManager.queryAsync.mock.calls[1][0];
            expect(countCall.query_params.ownerTags).toEqual(['bwell']);
            expect(rosterCall.query_params.ownerTags).toEqual(['bwell']);
            expect(countCall.query_params.accessTags).toBeUndefined();
            expect(rosterCall.query_params.accessTags).toBeUndefined();
        });

        test('rejects with 403 when accessTags is a bare string (malformed input fails closed)', async () => {
            const err = await provider
                .getCurrentMembersWithCountAsync('group-1', {}, { accessTags: 'clientA' })
                .catch(e => e);

            expect(err.statusCode).toBe(403);
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });
    });

    describe('getActiveMembersPageAsync tenant scope', () => {
        test('rejects with 403 when no tags and no full access (fail closed)', async () => {
            const err = await provider
                .getActiveMembersPageAsync('group-1', {}, { hasFullAccess: false, accessTags: [], ownerTags: [] })
                .catch(e => e);

            expect(err.statusCode).toBe(403);
            expect(err.message).toContain('Cross-tenant access denied');
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('rejects with 403 when securityContext omitted (safe default)', async () => {
            const err = await provider.getActiveMembersPageAsync('group-1', {}).catch(e => e);

            expect(err.statusCode).toBe(403);
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('runs only the roster query (no count) and returns members', async () => {
            const rows = [{ entity_reference: 'Patient/1', entity_type: 'Patient', inactive: 0 }];
            mockClickHouseClientManager.queryAsync.mockResolvedValue(rows);

            const members = await provider.getActiveMembersPageAsync('group-1', { limit: 50 }, { accessTags: ['clientA'] });

            expect(members).toEqual(rows);
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            const rosterCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(rosterCall.query_params.limit).toBe(50);
            expect(rosterCall.query_params.accessTags).toEqual(['clientA']);
        });

        test('threads the seek cursor and owner tags into the roster query', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([]);

            await provider.getActiveMembersPageAsync(
                'group-1',
                { limit: 10, afterReference: 'Patient/5' },
                { ownerTags: ['bwell'] }
            );

            const rosterCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(rosterCall.query_params.afterReference).toBe('Patient/5');
            expect(rosterCall.query_params.ownerTags).toEqual(['bwell']);
            expect(rosterCall.query_params.accessTags).toBeUndefined();
        });
    });

    describe('getActiveMemberCountAsync tenant scope', () => {
        test('rejects with 403 when no tags and no full access (fail closed)', async () => {
            const err = await provider.getActiveMemberCountAsync('group-1', { hasFullAccess: false }).catch(e => e);

            expect(err.statusCode).toBe(403);
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('runs and threads accessTags into the count query params', async () => {
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ count: '3' }]);

            const count = await provider.getActiveMemberCountAsync('group-1', { accessTags: ['clientA'] });

            expect(count).toBe(3);
            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            const countCall = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(countCall.query_params.accessTags).toEqual(['clientA']);
        });
    });
});
