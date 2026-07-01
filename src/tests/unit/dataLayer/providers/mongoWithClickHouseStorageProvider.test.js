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

    /**
     * Admin-exempt fail-closed tenant filtering on the ClickHouse read path.
     *
     * The full-access signal must be derived authoritatively from the caller's
     * SCOPE (via ScopesManager), not inferred from whether the built query
     * carried tag predicates. A wildcard admin's query legitimately carries no
     * tags, so tag-based inference would wrongly deny them.
     */
    describe('admin-exempt tenant filtering', () => {
        // Minimal ScopesManager fake honoring the wildcard contract:
        // access/*.* => access code '*'. Only structural behavior we depend on.
        const fakeScopesManager = {
            getAccessCodesFromScopes: (action, user, scope) => {
                const codes = [];
                for (const s of (scope || '').split(' ')) {
                    if (s.startsWith('access/')) {
                        const [tag, type] = s.replace('access/', '').split('.');
                        if (type === '*' || type === action) {
                            codes.push(tag);
                        }
                    }
                }
                return codes;
            }
        };

        const buildProvider = () => new MongoWithClickHouseStorageProvider({
            resourceLocator: mockResourceLocator,
            clickHouseClientManager: mockClickHouseClientManager,
            mongoStorageProvider: mockMongoStorageProvider,
            configManager: mockConfigManager,
            scopesManager: fakeScopesManager
        });

        test('_callerHasFullAccess is true for a wildcard (access/*.*) scope', () => {
            const p = buildProvider();
            expect(p._callerHasFullAccess({ scope: 'access/*.* user/*.read', user: 'admin' })).toBe(true);
        });

        test('_callerHasFullAccess is false for a tenant-scoped caller', () => {
            const p = buildProvider();
            expect(p._callerHasFullAccess({ scope: 'access/client1.* user/*.read', user: 'u1' })).toBe(false);
        });

        test('_callerHasFullAccess is false when no scopesManager is wired', () => {
            expect(provider._callerHasFullAccess({ scope: 'access/*.*', user: 'admin' })).toBe(false);
        });

        test('wildcard admin with NO query tags is NOT denied; ClickHouse is queried without a tenant predicate', async () => {
            const p = buildProvider();
            // Wildcard admin => upstream added no meta.security predicate => query has no tags.
            const query = { 'member.entity._sourceId': 'Patient/123' };
            const adminExtraInfo = {
                headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
                scope: 'access/*.* user/*.read',
                user: 'admin'
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ group_id: 'group-1' }]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await p.findAsync({ query, options: {}, extraInfo: adminExtraInfo });

            expect(mockClickHouseClientManager.queryAsync).toHaveBeenCalledTimes(1);
            const executed = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            // No tenant predicate and no deny clause for a legitimate full-access admin
            expect(executed.query).not.toContain('1 = 0');
            expect(executed.query).not.toContain('access_tags');
            expect(executed.query).not.toContain('owner_tags');
        });

        test('genuinely unscoped non-admin (no tags, no full access) is denied with 403', async () => {
            const p = buildProvider();
            const query = { 'member.entity._sourceId': 'Patient/123' };
            const unscopedExtraInfo = {
                headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
                scope: 'user/*.read', // no access/* scope => no tags, not full access
                user: 'u1'
            };

            await expect(
                p.findAsync({ query, options: {}, extraInfo: unscopedExtraInfo })
            ).rejects.toMatchObject({ statusCode: 403 });
            // Denied before touching ClickHouse
            expect(mockClickHouseClientManager.queryAsync).not.toHaveBeenCalled();
        });

        test('tenant-scoped caller still gets the access tag filter', async () => {
            const p = buildProvider();
            const query = withSecurityTags({ 'member.entity._sourceId': 'Patient/123' });
            const scopedExtraInfo = {
                headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
                scope: 'access/client1.* user/*.read',
                user: 'u1'
            };
            mockClickHouseClientManager.queryAsync.mockResolvedValue([{ group_id: 'group-1' }]);
            mockMongoStorageProvider.findAsync.mockResolvedValue({});

            await p.findAsync({ query, options: {}, extraInfo: scopedExtraInfo });

            const executed = mockClickHouseClientManager.queryAsync.mock.calls[0][0];
            expect(executed.query).toContain('hasAny(argMaxMerge(');
        });
    });
});
