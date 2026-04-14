'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { ClickHouseStorageProvider } = require('../../../../dataLayer/providers/clickHouseStorageProvider');
const { STORAGE_PROVIDER_TYPES } = require('../../../../dataLayer/providers/storageProviderTypes');
const { RESOURCE_COLUMN_TYPES } = require('../../../../constants/clickHouseConstants');

describe('ClickHouseStorageProvider', () => {
    let provider;
    let mockRepository;
    let mockSchemaRegistry;
    let testSchema;

    beforeEach(() => {
        testSchema = {
            tableName: 'fhir.fhir_test',
            fhirResourceColumn: '_fhir_resource',
            fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
            requiredFilters: [],
            maxRangeDays: null,
            fieldMappings: {}
        };

        mockRepository = {
            searchAsync: jestGlobal.fn().mockResolvedValue({ rows: [], hasMore: false }),
            findByIdAsync: jestGlobal.fn().mockResolvedValue(null),
            countAsync: jestGlobal.fn().mockResolvedValue(0),
            insertAsync: jestGlobal.fn().mockResolvedValue({ insertedCount: 0 })
        };

        mockSchemaRegistry = {
            getSchema: jestGlobal.fn().mockReturnValue(testSchema)
        };

        provider = new ClickHouseStorageProvider({
            resourceLocator: {},
            clickHouseClientManager: {},
            configManager: {},
            genericClickHouseRepository: mockRepository,
            resourceType: 'TestResource',
            schemaRegistry: mockSchemaRegistry
        });
    });

    describe('getStorageType', () => {
        test('returns CLICKHOUSE storage type', () => {
            expect(provider.getStorageType()).toBe(STORAGE_PROVIDER_TYPES.CLICKHOUSE);
        });
    });

    describe('findAsync', () => {
        test('returns ClickHouseDatabaseCursor with results', async () => {
            const fhirDoc = { resourceType: 'TestResource', id: 'test-1' };
            mockRepository.searchAsync.mockResolvedValue({
                rows: [{ _fhir_resource: JSON.stringify(fhirDoc) }],
                hasMore: false
            });

            const cursor = await provider.findAsync({ query: {}, options: { limit: 10 } });

            expect(mockRepository.searchAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                mongoQuery: {},
                options: { limit: 10, skip: undefined }
            });
            expect(await cursor.hasNext()).toBe(true);
            const docs = await cursor.toArrayAsync();
            expect(docs[0].id).toBe('test-1');
        });

        test('sets hasMore on cursor when more results exist', async () => {
            mockRepository.searchAsync.mockResolvedValue({
                rows: [{ _fhir_resource: '{"id":"1"}' }],
                hasMore: true
            });

            const cursor = await provider.findAsync({ query: {} });
            expect(cursor._hasMore).toBe(true);
        });

        test('returns empty cursor for no results', async () => {
            const cursor = await provider.findAsync({ query: {} });
            expect(await cursor.hasNext()).toBe(false);
        });
    });

    describe('findOneAsync', () => {
        test('uses findByIdAsync when query has id', async () => {
            const row = { _fhir_resource: JSON.stringify({ id: 'found', resourceType: 'TestResource' }) };
            mockRepository.findByIdAsync.mockResolvedValue(row);

            const result = await provider.findOneAsync({ query: { id: 'found' } });

            expect(mockRepository.findByIdAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                id: 'found'
            });
            expect(result.id).toBe('found');
        });

        test('returns null when findByIdAsync finds nothing', async () => {
            mockRepository.findByIdAsync.mockResolvedValue(null);
            const result = await provider.findOneAsync({ query: { id: 'missing' } });
            expect(result).toBeNull();
        });

        test('falls back to searchAsync with limit 1 for non-id queries', async () => {
            mockRepository.searchAsync.mockResolvedValue({
                rows: [{ _fhir_resource: JSON.stringify({ id: 'search-hit' }) }],
                hasMore: false
            });

            const result = await provider.findOneAsync({ query: { status: 'final' } });

            expect(mockRepository.searchAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                mongoQuery: { status: 'final' },
                options: { limit: 1 }
            });
            expect(result.id).toBe('search-hit');
        });

        test('returns null from search when no results', async () => {
            mockRepository.searchAsync.mockResolvedValue({ rows: [], hasMore: false });
            const result = await provider.findOneAsync({ query: { status: 'final' } });
            expect(result).toBeNull();
        });
    });

    describe('countAsync', () => {
        test('delegates to repository.countAsync', async () => {
            mockRepository.countAsync.mockResolvedValue(42);
            const count = await provider.countAsync({ query: { status: 'final' } });
            expect(count).toBe(42);
            expect(mockRepository.countAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                mongoQuery: { status: 'final' }
            });
        });
    });

    describe('upsertAsync', () => {
        test('delegates to repository.insertAsync (append-only)', async () => {
            mockRepository.insertAsync.mockResolvedValue({ insertedCount: 3 });
            const result = await provider.upsertAsync({
                resources: [{ id: '1' }, { id: '2' }, { id: '3' }]
            });
            expect(result).toEqual({ acknowledged: true, insertedCount: 3 });
            expect(mockRepository.insertAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                resources: [{ id: '1' }, { id: '2' }, { id: '3' }]
            });
        });
    });
});
