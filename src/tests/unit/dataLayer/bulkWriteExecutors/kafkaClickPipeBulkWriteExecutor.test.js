'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { KafkaClickPipeBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/kafkaClickPipeBulkWriteExecutor');
const { BulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/bulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../../../constants/clickHouseConstants');
const { CompressionTypes, KafkaJSNonRetriableError, KafkaJSConnectionError } = require('kafkajs');
const { createErrorFromCode } = require('kafkajs/src/protocol/error');

// What kafkajs actually throws for a broker rejection: the protocol error (with
// `type`) wrapped in KafkaJSNonRetriableError as `cause`.
const MESSAGE_TOO_LARGE_CODE = 10;
const messageTooLargeError = () => {
    const protocolError = createErrorFromCode(MESSAGE_TOO_LARGE_CODE);
    return new KafkaJSNonRetriableError(protocolError, { cause: protocolError });
};

describe('KafkaClickPipeBulkWriteExecutor', () => {
    let executor;
    let mockKafkaClientV2;
    let mockSchemaRegistry;
    let testSchema;

    beforeEach(() => {
        testSchema = {
            resourceType: 'TestResource',
            tableName: 'fhir.fhir_test',
            writeStrategy: WRITE_STRATEGIES.KAFKA_CLICKPIPE,
            kafkaTopic: 'fhir.test.stream',
            fireChangeEvents: false,
            // mirrors the real extractor: flat row keyed by column names
            fieldExtractor: { extract: (r) => ({ _uuid: r.id, resource: r }) }
        };

        mockKafkaClientV2 = {
            sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };

        mockSchemaRegistry = {
            hasSchema: jestGlobal.fn().mockReturnValue(true),
            getSchema: jestGlobal.fn().mockReturnValue(testSchema)
        };

        executor = new KafkaClickPipeBulkWriteExecutor({
            kafkaClientV2: mockKafkaClientV2,
            schemaRegistry: mockSchemaRegistry
        });
    });

    function makeEntry (overrides = {}) {
        const id = overrides.id || 'test-id';
        return {
            id,
            uuid: 'test-uuid',
            sourceAssigningAuthority: 'test-saa',
            resourceType: 'TestResource',
            isCreateOperation: true,
            isUpdateOperation: false,
            resource: { id, resourceType: 'TestResource' },
            contextData: null,
            ...overrides
        };
    }

    describe('canHandle', () => {
        test('returns true for registered KAFKA_CLICKPIPE resource', () => {
            expect(executor.canHandle('TestResource')).toBe(true);
        });

        test('returns false for unregistered resource', () => {
            mockSchemaRegistry.hasSchema.mockReturnValue(false);
            expect(executor.canHandle('Unknown')).toBe(false);
        });

        test('returns false for SYNC_DIRECT write strategy', () => {
            mockSchemaRegistry.getSchema.mockReturnValue({
                ...testSchema,
                writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT
            });
            expect(executor.canHandle('TestResource')).toBe(false);
        });
    });

    describe('executeBulkAsync — happy path', () => {
        test('produces one message per operation to the schema topic', async () => {
            const operations = [
                makeEntry({ id: 'r1', uuid: 'u1' }),
                makeEntry({ id: 'r2', uuid: 'u2', isCreateOperation: false, isUpdateOperation: true })
            ];
            const requestInfo = { requestId: 'req-1' };

            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo,
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            const [{ topic, messages }] = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls[0];
            expect(topic).toBe('fhir.test.stream');
            expect(messages).toHaveLength(2);
            expect(messages[0]).toEqual({
                key: 'u1',
                value: JSON.stringify({ _uuid: 'r1', resource: operations[0].resource }),
                headers: { version: 'R4', requestId: 'req-1' }
            });
            // value is the same flat row the direct path would insert
            expect(JSON.parse(messages[1].value)).toEqual({ _uuid: 'r2', resource: operations[1].resource });

            expect(result.mergeResultEntries).toHaveLength(2);
            expect(result.mergeResultEntries[0].created).toBe(true);
            expect(result.mergeResultEntries[0].updated).toBe(false);
            expect(result.mergeResultEntries[0].id).toBe('r1');
            expect(result.mergeResultEntries[1].updated).toBe(true);
            expect(result.mergeResult).toBeNull();
            expect(result.error).toBeNull();
        });
    });

    describe('executeBulkAsync — fallback path', () => {
        let mockFallbackExecutor;

        beforeEach(() => {
            mockFallbackExecutor = new BulkWriteExecutor();
            mockFallbackExecutor.executeBulkAsync = jestGlobal.fn().mockResolvedValue({
                resourceType: 'TestResource',
                mergeResult: null,
                mergeResultEntries: [{ id: 'r1', created: true }],
                error: null
            });
        });

        test('delegates entire batch to fallback after all retries exhausted', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka unavailable'));

            const executorWithFallback = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 0,
                initialRetryDelayMs: 0
            });

            const params = {
                resourceType: 'TestResource',
                operations: [makeEntry({ id: 'r1', uuid: 'u1' })],
                requestInfo: { requestId: 'req-fb-1' },
                base_version: '4_0_0',
                useHistoryCollection: false,
                maintainOrder: true,
                isAccessLogOperation: false,
                insertOneHistoryFn: jestGlobal.fn()
            };

            const result = await executorWithFallback.executeBulkAsync(params);

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledTimes(1);
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledWith(params);
            expect(result.error).toBeNull();
            expect(result.mergeResultEntries).toEqual([{ id: 'r1', created: true }]);
        });

        test('succeeds on retry without falling back', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync
                .mockRejectedValueOnce(new Error('transient broker error'))
                .mockRejectedValueOnce(new Error('transient broker error'))
                .mockResolvedValueOnce(undefined);

            const executorWithFallback = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 2,
                initialRetryDelayMs: 10
            });

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            const result = await executorWithFallback.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-retry-1' },
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
            expect(mockFallbackExecutor.executeBulkAsync).not.toHaveBeenCalled();
            expect(result.mergeResultEntries[0].created).toBe(true);
            expect(result.error).toBeNull();
        });

        test('routes to fallback when extraction throws (bad resource)', async () => {
            const executorWithFallback = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor
            });
            testSchema.fieldExtractor = {
                extract: () => { throw new Error('recorded is required'); }
            };

            await executorWithFallback.executeBulkAsync({
                resourceType: 'TestResource',
                operations: [makeEntry()],
                requestInfo: { requestId: 'req-fb-2' },
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledTimes(1);
        });
    });

    describe('executeBulkAsync — compression', () => {
        test('sends uncompressed by default', async () => {
            await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: [makeEntry()],
                requestInfo: { requestId: 'req-comp-1' },
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].compression).toBe(CompressionTypes.None);
        });

        test('passes the configured compression on every chunk', async () => {
            const zstdExecutor = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                batchSize: 1,
                compression: CompressionTypes.ZSTD
            });

            await zstdExecutor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: [makeEntry({ id: 'r1' }), makeEntry({ id: 'r2' })],
                requestInfo: { requestId: 'req-comp-2' },
                base_version: '4_0_0'
            });

            const compressions = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls.map(([arg]) => arg.compression);
            expect(compressions).toEqual([CompressionTypes.ZSTD, CompressionTypes.ZSTD]);
        });
    });

    describe('executeBulkAsync — chunking', () => {
        const makeEntries = (n) => Array.from({ length: n }, (_, i) => makeEntry({ id: `r${i}`, uuid: `u${i}` }));

        test('defaults to chunks of 50 messages per produce call', async () => {
            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: makeEntries(120),
                requestInfo: { requestId: 'req-chunk-1' },
                base_version: '4_0_0'
            });

            const sizes = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls.map(([arg]) => arg.messages.length);
            expect(sizes).toEqual([50, 50, 20]);
            expect(result.mergeResultEntries.map((e) => e.id)).toEqual(makeEntries(120).map((e) => e.id));
            expect(result.error).toBeNull();
        });

        test('falls back only the chunk rejected with MESSAGE_TOO_LARGE and keeps the others on Kafka', async () => {
            const mockFallbackExecutor = new BulkWriteExecutor();
            mockFallbackExecutor.executeBulkAsync = jestGlobal.fn().mockImplementation(({ operations }) => ({
                resourceType: 'TestResource',
                mergeResult: null,
                mergeResultEntries: operations.map((op) => ({ id: op.id, created: true, fromFallback: true })),
                error: null
            }));
            mockKafkaClientV2.sendCloudEventMessageAsync
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(messageTooLargeError())
                .mockResolvedValueOnce(undefined);

            // maxRetries > 0: a chunk-specific rejection must not be retried
            const chunkedExecutor = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 3,
                initialRetryDelayMs: 0,
                batchSize: 2
            });

            const result = await chunkedExecutor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: makeEntries(5),
                requestInfo: { requestId: 'req-chunk-2' },
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledTimes(1);
            expect(mockFallbackExecutor.executeBulkAsync.mock.calls[0][0].operations.map((o) => o.id)).toEqual(['r2', 'r3']);
            expect(result.mergeResultEntries.map((e) => [e.id, !!e.fromFallback])).toEqual([
                ['r0', false], ['r1', false], ['r2', true], ['r3', true], ['r4', false]
            ]);
            expect(result.error).toBeNull();
        });

        test('once Kafka is unavailable, remaining chunks go straight to the fallback without being produced', async () => {
            const mockFallbackExecutor = new BulkWriteExecutor();
            mockFallbackExecutor.executeBulkAsync = jestGlobal.fn().mockImplementation(({ operations }) => ({
                resourceType: 'TestResource',
                mergeResult: null,
                mergeResultEntries: operations.map((op) => ({ id: op.id, created: true, fromFallback: true })),
                error: null
            }));
            mockKafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(
                new KafkaJSConnectionError('Connection timeout')
            );

            const chunkedExecutor = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor,
                maxRetries: 2,
                initialRetryDelayMs: 0,
                batchSize: 2
            });

            const result = await chunkedExecutor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: makeEntries(5),
                requestInfo: { requestId: 'req-chunk-unavailable' },
                base_version: '4_0_0'
            });

            // one retry cycle (initial + 2 retries) for the first chunk only
            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(3);
            expect(mockFallbackExecutor.executeBulkAsync.mock.calls.map(([arg]) => arg.operations.map((o) => o.id))).toEqual([
                ['r0', 'r1'], ['r2', 'r3'], ['r4']
            ]);
            expect(result.mergeResultEntries.every((e) => e.fromFallback)).toBe(true);
            expect(result.error).toBeNull();
        });

        test('an extraction failure falls back that chunk only and keeps producing the rest', async () => {
            const mockFallbackExecutor = new BulkWriteExecutor();
            mockFallbackExecutor.executeBulkAsync = jestGlobal.fn().mockImplementation(({ operations }) => ({
                resourceType: 'TestResource',
                mergeResult: null,
                mergeResultEntries: operations.map((op) => ({ id: op.id, created: true, fromFallback: true })),
                error: null
            }));
            testSchema.fieldExtractor = {
                extract: (r) => {
                    if (r.id === 'r0') throw new Error('recorded is required');
                    return { _uuid: r.id };
                }
            };

            const chunkedExecutor = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor,
                batchSize: 1
            });

            await chunkedExecutor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: makeEntries(3),
                requestInfo: { requestId: 'req-chunk-extract' },
                base_version: '4_0_0'
            });

            expect(mockFallbackExecutor.executeBulkAsync.mock.calls.map(([arg]) => arg.operations[0].id)).toEqual(['r0']);
            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
        });

        test('without fallback, Kafka unavailable marks every remaining chunk failed without producing it', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync
                .mockRejectedValueOnce(new Error('Kafka unavailable'))
                .mockResolvedValueOnce(undefined);

            const chunkedExecutor = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                maxRetries: 0,
                initialRetryDelayMs: 0,
                batchSize: 2
            });

            const result = await chunkedExecutor.executeBulkAsync({
                resourceType: 'TestResource',
                operations: makeEntries(3),
                requestInfo: { requestId: 'req-chunk-3' },
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            expect(result.error).toBeInstanceOf(Error);
            expect(result.mergeResultEntries.map((e) => !!e.issue)).toEqual([true, true, true]);
        });
    });

    describe('executeBulkAsync — no fallback', () => {
        test('returns error entries when produce fails and no fallback set', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka unavailable'));

            const executorNoFallback = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                maxRetries: 0,
                initialRetryDelayMs: 0
            });

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            const result = await executorNoFallback.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-nofb-1' },
                base_version: '4_0_0'
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            expect(result.error).toBeInstanceOf(Error);
            expect(result.mergeResultEntries).toHaveLength(1);
            expect(result.mergeResultEntries[0].created).toBe(false);
            expect(result.mergeResultEntries[0].issue).toBeDefined();
            expect(result.mergeResultEntries[0].issue.severity).toBe('error');
            expect(result.mergeResultEntries[0].issue.code).toBe('exception');
            expect(result.mergeResultEntries[0].issue.expression).toEqual(['TestResource/u1']);
        });
    });

    describe('constructor validation', () => {
        test('throws when kafkaClientV2 is null', () => {
            expect(() => new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: null,
                schemaRegistry: mockSchemaRegistry
            })).toThrow();
        });

        test('throws when schemaRegistry is null', () => {
            expect(() => new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: null
            })).toThrow();
        });

        test('throws when batchSize is not a positive integer', () => {
            expect(() => new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                batchSize: 0
            })).toThrow();
        });

        test('throws when fallbackExecutor is not a BulkWriteExecutor', () => {
            expect(() => new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: {}
            })).toThrow();
        });
    });
});
