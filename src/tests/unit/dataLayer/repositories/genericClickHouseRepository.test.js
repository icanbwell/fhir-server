'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { GenericClickHouseRepository } = require('../../../../dataLayer/repositories/genericClickHouseRepository');

describe('GenericClickHouseRepository', () => {
    let repository;
    let mockClientManager;
    let mockSchemaRegistry;
    let mockQueryParser;
    let mockQueryBuilder;
    let testSchema;

    beforeEach(() => {
        testSchema = {
            tableName: 'fhir.fhir_test_resource',
            fhirResourceColumn: '_fhir_resource',
            fieldExtractor: {
                extract: jestGlobal.fn((resource) => ({
                    id: resource.id,
                    _fhir_resource: JSON.stringify(resource)
                }))
            }
        };

        mockClientManager = {
            queryAsync: jestGlobal.fn().mockResolvedValue([]),
            insertAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };

        mockSchemaRegistry = {
            getSchema: jestGlobal.fn().mockReturnValue(testSchema)
        };

        mockQueryParser = {
            parse: jestGlobal.fn().mockReturnValue({
                fieldConditions: [],
                securityConditions: { accessTags: [], ownerTags: [] },
                paginationCursor: null
            })
        };

        mockQueryBuilder = {
            buildSearchQuery: jestGlobal.fn().mockReturnValue({
                query: 'SELECT * FROM test',
                query_params: {}
            }),
            buildCountQuery: jestGlobal.fn().mockReturnValue({
                query: 'SELECT count() AS cnt FROM test',
                query_params: {}
            }),
            buildFindByIdQuery: jestGlobal.fn().mockReturnValue({
                query: 'SELECT * FROM test WHERE id = {_id:String}',
                query_params: { _id: 'test-id' }
            }),
            validateRequiredFilters: jestGlobal.fn()
        };

        repository = new GenericClickHouseRepository({
            clickHouseClientManager: mockClientManager,
            schemaRegistry: mockSchemaRegistry,
            queryParser: mockQueryParser,
            queryBuilder: mockQueryBuilder
        });
    });

    describe('searchAsync', () => {
        test('delegates to parser → builder → clientManager', async () => {
            const mongoQuery = { status: 'final' };
            mockClientManager.queryAsync.mockResolvedValue([
                { _fhir_resource: '{"id":"1"}' }
            ]);

            const result = await repository.searchAsync({
                resourceType: 'TestResource',
                mongoQuery,
                options: { limit: 10 }
            });

            expect(mockSchemaRegistry.getSchema).toHaveBeenCalledWith('TestResource');
            expect(mockQueryParser.parse).toHaveBeenCalledWith(mongoQuery, testSchema);
            expect(mockQueryBuilder.validateRequiredFilters).toHaveBeenCalled();
            expect(mockQueryBuilder.buildSearchQuery).toHaveBeenCalled();
            expect(mockClientManager.queryAsync).toHaveBeenCalled();
            expect(result.rows).toHaveLength(1);
        });

        test('hasMore is true when more results exist (limit+1 pattern)', async () => {
            // With limit=2, repository queries for 3 (limit+1).
            // If 3 come back, hasMore=true and only 2 are returned.
            mockClientManager.queryAsync.mockResolvedValue([
                { _fhir_resource: '{"id":"1"}' },
                { _fhir_resource: '{"id":"2"}' },
                { _fhir_resource: '{"id":"3"}' }
            ]);

            const result = await repository.searchAsync({
                resourceType: 'TestResource',
                mongoQuery: {},
                options: { limit: 2 }
            });

            expect(result.hasMore).toBe(true);
            expect(result.rows).toHaveLength(2);
        });

        test('hasMore is false when all results fit (limit+1 pattern)', async () => {
            // With limit=2, repository queries for 3.
            // If only 2 come back, hasMore=false.
            mockClientManager.queryAsync.mockResolvedValue([
                { _fhir_resource: '{"id":"1"}' },
                { _fhir_resource: '{"id":"2"}' }
            ]);

            const result = await repository.searchAsync({
                resourceType: 'TestResource',
                mongoQuery: {},
                options: { limit: 10 }
            });

            expect(result.hasMore).toBe(false);
        });

        test('wraps ClickHouse errors in RethrownError', async () => {
            mockClientManager.queryAsync.mockRejectedValue(new Error('CH connection failed'));

            await expect(repository.searchAsync({
                resourceType: 'TestResource',
                mongoQuery: {}
            })).rejects.toThrow('Error searching TestResource in ClickHouse');
        });

        test('propagates required filter validation errors', async () => {
            const validationError = new Error('Required filter missing');
            validationError.statusCode = 400;
            mockQueryBuilder.validateRequiredFilters.mockImplementation(() => { throw validationError; });

            await expect(repository.searchAsync({
                resourceType: 'TestResource',
                mongoQuery: {}
            })).rejects.toThrow('Error searching TestResource in ClickHouse');
        });
    });

    describe('findByIdAsync', () => {
        test('returns row when found', async () => {
            mockClientManager.queryAsync.mockResolvedValue([
                { _fhir_resource: '{"id":"found"}' }
            ]);

            const result = await repository.findByIdAsync({
                resourceType: 'TestResource',
                id: 'found'
            });

            expect(result).toEqual({ _fhir_resource: '{"id":"found"}' });
            expect(mockQueryBuilder.buildFindByIdQuery).toHaveBeenCalledWith('found', testSchema, expect.any(Object));
        });

        test('returns null when not found', async () => {
            mockClientManager.queryAsync.mockResolvedValue([]);

            const result = await repository.findByIdAsync({
                resourceType: 'TestResource',
                id: 'missing'
            });

            expect(result).toBeNull();
        });

        test('wraps errors in RethrownError', async () => {
            mockClientManager.queryAsync.mockRejectedValue(new Error('timeout'));

            await expect(repository.findByIdAsync({
                resourceType: 'TestResource',
                id: 'err'
            })).rejects.toThrow('Error finding TestResource/err in ClickHouse');
        });
    });

    describe('countAsync', () => {
        test('returns count from query result', async () => {
            mockClientManager.queryAsync.mockResolvedValue([{ cnt: '42' }]);

            const count = await repository.countAsync({
                resourceType: 'TestResource',
                mongoQuery: {}
            });

            expect(count).toBe(42);
        });

        test('returns 0 when no results', async () => {
            mockClientManager.queryAsync.mockResolvedValue([]);

            const count = await repository.countAsync({
                resourceType: 'TestResource',
                mongoQuery: {}
            });

            expect(count).toBe(0);
        });

        test('wraps errors in RethrownError', async () => {
            mockClientManager.queryAsync.mockRejectedValue(new Error('fail'));

            await expect(repository.countAsync({
                resourceType: 'TestResource',
                mongoQuery: {}
            })).rejects.toThrow('Error counting TestResource in ClickHouse');
        });
    });

    describe('insertAsync', () => {
        test('calls fieldExtractor.extract for each resource and inserts', async () => {
            const resources = [
                { id: 'r1', resourceType: 'TestResource' },
                { id: 'r2', resourceType: 'TestResource' }
            ];

            const result = await repository.insertAsync({
                resourceType: 'TestResource',
                resources
            });

            expect(testSchema.fieldExtractor.extract).toHaveBeenCalledTimes(2);
            expect(mockClientManager.insertAsync).toHaveBeenCalledWith({
                table: 'fhir.fhir_test_resource',
                values: expect.arrayContaining([
                    expect.objectContaining({ id: 'r1' }),
                    expect.objectContaining({ id: 'r2' })
                ]),
                format: 'JSONEachRow'
            });
            expect(result.insertedCount).toBe(2);
        });

        test('returns insertedCount 0 for empty array', async () => {
            const result = await repository.insertAsync({
                resourceType: 'TestResource',
                resources: []
            });

            expect(result.insertedCount).toBe(0);
            expect(mockClientManager.insertAsync).not.toHaveBeenCalled();
        });

        test('wraps errors in RethrownError', async () => {
            mockClientManager.insertAsync.mockRejectedValue(new Error('insert failed'));

            await expect(repository.insertAsync({
                resourceType: 'TestResource',
                resources: [{ id: 'r1' }]
            })).rejects.toThrow('Error inserting TestResource into ClickHouse');
        });
    });
});
