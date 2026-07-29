'use strict';

/**
 * Bug-hunting tests for ClickHouseBulkWriteExecutor
 *
 * Targets:
 * 1. Post-save error swallowing: change event failures are silently logged but never surface
 * 2. Empty operations array: no guard against empty array passed to insertAsync
 * 3. Null resource in operations: operations.map(op => op.resource) passes undefined to ClickHouse
 * 4. Post-save events fire sequentially: one slow event blocks all subsequent events
 */
const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

const { ClickHouseBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor');
const { BulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/bulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../../../constants/clickHouseConstants');

describe('ClickHouseBulkWriteExecutor — Bug Detection', () => {
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
            insertAsync: jestGlobal.fn().mockResolvedValue({ insertedCount: 0 })
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

    function makeEntry(overrides = {}) {
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

    describe('BUG: Empty operations array sent to ClickHouse', () => {
        /**
         * BUG: No guard against empty operations array.
         * Line 101: operations.map(op => op.resource) produces [].
         * This sends an empty insert to ClickHouse, which may:
         * - Waste a network round-trip
         * - Cause errors on some ClickHouse versions that reject empty inserts
         */
        test('empty operations array calls insertAsync with empty resources array', async () => {
            const operations = [];
            const requestInfo = { requestId: 'req-empty' };

            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            // BUG: insertAsync is called with an empty resources array
            // A well-designed executor should short-circuit on empty input
            expect(mockRepository.insertAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                resources: []
            });
            expect(result.mergeResultEntries).toHaveLength(0);
            expect(result.error).toBeNull();
        });
    });

    describe('BUG: Null/undefined resource in operation entry', () => {
        /**
         * BUG: Line 101: operations.map(op => op.resource) does not filter nulls.
         * If an operation entry has resource: null or resource: undefined,
         * the array passed to insertAsync contains null/undefined values.
         * ClickHouse will either crash or insert garbage.
         */
        test('operation with null resource passes null to insertAsync', async () => {
            const operations = [
                makeEntry({ id: 'r1', uuid: 'u1', resource: null }),
                makeEntry({ id: 'r2', uuid: 'u2' })
            ];
            const requestInfo = { requestId: 'req-null-resource' };

            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            // BUG PROOF: insertAsync receives [null, {id: 'test-id', ...}]
            // No validation prevents null resources from reaching ClickHouse
            expect(mockRepository.insertAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                resources: [null, { id: 'test-id', resourceType: 'TestResource' }]
            });
            // The operation "succeeds" from the executor's perspective
            expect(result.error).toBeNull();
            expect(result.mergeResultEntries).toHaveLength(2);
        });

        test('operation with undefined resource passes undefined to insertAsync', async () => {
            const operations = [
                makeEntry({ id: 'r1', uuid: 'u1', resource: undefined })
            ];
            const requestInfo = { requestId: 'req-undef-resource' };

            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            // BUG PROOF: insertAsync receives [undefined]
            expect(mockRepository.insertAsync).toHaveBeenCalledWith({
                resourceType: 'TestResource',
                resources: [undefined]
            });
            expect(result.error).toBeNull();
        });
    });

    describe('BUG: Post-save event error is swallowed silently', () => {
        /**
         * BUG: Lines 185-199: If postSaveProcessor.afterSaveAsync throws,
         * the error is caught and logged but NOT propagated.
         * This means change events can silently fail — downstream systems
         * (Kafka consumers, audit logs) never receive the event.
         *
         * The result returned to the caller shows success (error: null),
         * even though some post-save operations failed.
         */
        test('post-save failure should propagate error to caller', async () => {
            mockPostSaveProcessor.afterSaveAsync.mockRejectedValue(
                new Error('Kafka broker unavailable')
            );

            const operations = [
                makeEntry({ id: 'r1', uuid: 'u1' }),
                makeEntry({ id: 'r2', uuid: 'u2' })
            ];
            const requestInfo = { requestId: 'req-post-save-fail' };

            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Post-save failures should NOT be silently swallowed.
            // The error should be propagated to the caller so downstream systems
            // (Kafka consumers, audit logs) are aware of the failure.
            expect(result.error).not.toBeNull();
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledTimes(2);
        });

        test('first post-save failure does not prevent second from being attempted', async () => {
            // First call throws, second succeeds
            mockPostSaveProcessor.afterSaveAsync
                .mockRejectedValueOnce(new Error('transient failure'))
                .mockResolvedValueOnce(undefined);

            const operations = [
                makeEntry({ id: 'r1', uuid: 'u1' }),
                makeEntry({ id: 'r2', uuid: 'u2' })
            ];

            await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-partial' },
                base_version: '4_0_0'
            });

            // Both events attempted despite first failure (sequential processing)
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledTimes(2);
        });
    });

    describe('BUG: Fallback executor receives same operations that may have been partially committed', () => {
        /**
         * Scenario: retryWithBackoff throws after retries. The error is caught.
         * If a fallback executor is configured, ALL operations are delegated to it.
         *
         * However, ClickHouse inserts are documented as "all-or-nothing" (line 73),
         * so this should be safe IF that guarantee holds. But if ClickHouse partially
         * commits (e.g., network timeout after server-side commit), fallback creates duplicates.
         *
         * This is a design concern more than a clear bug, but worth testing the flow.
         */
        test('fallback should only receive uncommitted operations after ClickHouse timeout', async () => {
            // Simulate: ClickHouse timeout (server may have committed)
            mockRepository.insertAsync.mockRejectedValue(new Error('ETIMEDOUT'));

            const mockFallbackExecutor = new BulkWriteExecutor();
            mockFallbackExecutor.executeBulkAsync = jestGlobal.fn().mockResolvedValue({
                resourceType: 'TestResource',
                mergeResult: null,
                mergeResultEntries: [{ id: 'r1', created: true }],
                error: null
            });

            const executorWithFallback = new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: mockRepository,
                schemaRegistry: mockSchemaRegistry,
                postSaveProcessor: mockPostSaveProcessor,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 0,
                initialRetryDelayMs: 0
            });

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            await executorWithFallback.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-timeout' },
                base_version: '4_0_0'
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Fallback should NOT receive operations that may have already been committed.
            // On timeout, ClickHouse may have committed the data. Sending all ops to fallback
            // risks duplicates. The fallback should either:
            // - Not be called (and instead return an error to the caller), OR
            // - Only receive operations verified as uncommitted
            expect(mockFallbackExecutor.executeBulkAsync).not.toHaveBeenCalled();
        });
    });
});
