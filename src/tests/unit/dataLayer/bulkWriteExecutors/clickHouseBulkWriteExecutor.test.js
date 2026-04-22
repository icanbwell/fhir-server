'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { ClickHouseBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../../../constants/clickHouseConstants');

describe('ClickHouseBulkWriteExecutor', () => {
    let executor;
    let mockRepository;
    let mockSchemaRegistry;
    let mockPostSaveProcessor;
    let testSchema;

    beforeEach(() => {
        testSchema = {
            resourceType: 'TestResource',
            tableName: 'fhir.fhir_test',
            writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT,
            fireChangeEvents: true,
            fieldExtractor: { extract: (r) => ({ id: r.id }) }
        };

        mockRepository = {
            insertAsync: jestGlobal.fn().mockResolvedValue({ insertedCount: 2 })
        };

        mockSchemaRegistry = {
            hasSchema: jestGlobal.fn().mockReturnValue(true),
            getSchema: jestGlobal.fn().mockReturnValue(testSchema)
        };

        mockPostSaveProcessor = {
            afterSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };

        executor = new ClickHouseBulkWriteExecutor({
            genericClickHouseRepository: mockRepository,
            schemaRegistry: mockSchemaRegistry,
            postSaveProcessor: mockPostSaveProcessor,
            maxRetries: 0,
            initialRetryDelayMs: 0
        });
    });

    function makeEntry (overrides = {}) {
        return {
            id: 'test-id',
            uuid: 'test-uuid',
            sourceAssigningAuthority: 'test-saa',
            resourceType: 'TestResource',
            isCreateOperation: true,
            isUpdateOperation: false,
            resource: { id: 'test-id', resourceType: 'TestResource' },
            contextData: null,
            ...overrides
        };
    }

    describe('canHandle', () => {
        test('returns true for registered SYNC_DIRECT resource', () => {
            expect(executor.canHandle('TestResource')).toBe(true);
        });

        test('returns false for unregistered resource', () => {
            mockSchemaRegistry.hasSchema.mockReturnValue(false);
            expect(executor.canHandle('Unknown')).toBe(false);
        });

        test('returns false for non-SYNC_DIRECT write strategy', () => {
            mockSchemaRegistry.getSchema.mockReturnValue({
                ...testSchema,
                writeStrategy: 'other-strategy'
            });
            expect(executor.canHandle('TestResource')).toBe(false);
        });
    });

    describe('executeBulkAsync — happy path', () => {
        test('inserts resources and returns MergeResultEntries', async () => {
            const operations = [makeEntry({ id: 'r1', uuid: 'u1' }), makeEntry({ id: 'r2', uuid: 'u2' })];
            const requestInfo = { requestId: 'req-1' };

            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            expect(mockRepository.insertAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                resources: operations.map(op => op.resource)
            });
            expect(result.mergeResultEntries).toHaveLength(2);
            expect(result.mergeResultEntries[0].created).toBe(true);
            expect(result.mergeResultEntries[0].id).toBe('r1');
            expect(result.mergeResult).toBeNull();
            expect(result.error).toBeNull();
        });

        test('fires change events when fireChangeEvents is true', async () => {
            const operations = [makeEntry()];
            const requestInfo = { requestId: 'req-1' };

            await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'TestResource',
                doc: operations[0].resource,
                contextData: null
            });
        });

        test('skips change events when fireChangeEvents is false', async () => {
            mockSchemaRegistry.getSchema.mockReturnValue({
                ...testSchema,
                fireChangeEvents: false
            });

            const operations = [makeEntry()];
            await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0'
            });

            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
        });

        test('uses U event type for update operations', async () => {
            const operations = [makeEntry({ isCreateOperation: false, isUpdateOperation: true })];
            await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0'
            });

            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'U' })
            );
        });
    });

    describe('executeBulkAsync — error path', () => {
        test('all entries get error MergeResultEntries on insert failure', async () => {
            mockRepository.insertAsync.mockRejectedValue(new Error('ClickHouse unavailable'));

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' }), makeEntry({ id: 'r2', uuid: 'u2' })];
            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0'
            });

            expect(result.error).toBeInstanceOf(Error);
            expect(result.mergeResultEntries).toHaveLength(2);
            expect(result.mergeResultEntries[0].created).toBe(false);
            expect(result.mergeResultEntries[0].issue).toBeDefined();
            expect(result.mergeResultEntries[0].issue.severity).toBe('error');
            expect(result.mergeResultEntries[0].issue.code).toBe('exception');
            expect(result.mergeResultEntries[0].issue.expression).toEqual(['TestResource/u1']);
        });

        test('change events not fired on error', async () => {
            mockRepository.insertAsync.mockRejectedValue(new Error('fail'));

            await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: [makeEntry()],
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0'
            });

            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
        });
    });

    describe('executeBulkAsync — retry and fallback on failure', () => {
        let mockFallbackExecutor;

        beforeEach(() => {
            mockFallbackExecutor = {
                executeBulkAsync: jestGlobal.fn().mockResolvedValue({
                    resourceType: 'TestResource',
                    mergeResult: null,
                    mergeResultEntries: [{ id: 'r1', created: true }],
                    error: null
                })
            };
        });

        test('succeeds on retry without falling back', async () => {
            mockRepository.insertAsync
                .mockRejectedValueOnce(new Error('transient failure'))
                .mockRejectedValueOnce(new Error('transient failure'))
                .mockResolvedValueOnce({ insertedCount: 1 });

            const executorWithFallback = new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: mockRepository,
                schemaRegistry: mockSchemaRegistry,
                postSaveProcessor: mockPostSaveProcessor,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 2,
                initialRetryDelayMs: 0
            });

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            const result = await executorWithFallback.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-retry-2' },
                base_version: '4_0_0'
            });

            expect(mockRepository.insertAsync).toHaveBeenCalledTimes(3);
            expect(mockFallbackExecutor.executeBulkAsync).not.toHaveBeenCalled();
            expect(result.mergeResultEntries[0].created).toBe(true);
        });

        test('delegates to fallback after all retries exhausted', async () => {
            mockRepository.insertAsync.mockRejectedValue(new Error('ClickHouse unavailable'));

            const executorWithFallback = new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: mockRepository,
                schemaRegistry: mockSchemaRegistry,
                postSaveProcessor: mockPostSaveProcessor,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 0,
                initialRetryDelayMs: 0
            });

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            const params = {
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-fb-1' },
                base_version: '4_0_0',
                useHistoryCollection: false,
                maintainOrder: true,
                isAccessLogOperation: false,
                insertOneHistoryFn: jestGlobal.fn()
            };

            const result = await executorWithFallback.executeBulkAsync(params);

            expect(mockRepository.insertAsync).toHaveBeenCalledTimes(1);
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledTimes(1);
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledWith(params);
            expect(result.error).toBeNull();
        });

        test('returns error entries when no fallback and ClickHouse fails', async () => {
            mockRepository.insertAsync.mockRejectedValue(new Error('ClickHouse unavailable'));

            const executorNoFallback = new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: mockRepository,
                schemaRegistry: mockSchemaRegistry,
                postSaveProcessor: mockPostSaveProcessor,
                maxRetries: 0,
                initialRetryDelayMs: 0
            });

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            const result = await executorNoFallback.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-fb-4' },
                base_version: '4_0_0'
            });

            expect(result.error).toBeInstanceOf(Error);
            expect(result.mergeResultEntries[0].issue).toBeDefined();
        });
    });

    describe('constructor validation', () => {
        test('throws when genericClickHouseRepository is null', () => {
            expect(() => new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: null,
                schemaRegistry: mockSchemaRegistry,
                postSaveProcessor: mockPostSaveProcessor
            })).toThrow();
        });

        test('throws when schemaRegistry is null', () => {
            expect(() => new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: mockRepository,
                schemaRegistry: null,
                postSaveProcessor: mockPostSaveProcessor
            })).toThrow();
        });

        test('throws when postSaveProcessor is null', () => {
            expect(() => new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: mockRepository,
                schemaRegistry: mockSchemaRegistry,
                postSaveProcessor: null
            })).toThrow();
        });
    });
});
