'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { KafkaClickPipeBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/kafkaClickPipeBulkWriteExecutor');
const { BulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/bulkWriteExecutor');
const { WRITE_STRATEGIES } = require('../../../../constants/clickHouseConstants');

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

        test('delegates entire batch to fallback when produce fails', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka unavailable'));

            const executorWithFallback = new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: mockFallbackExecutor
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

            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledTimes(1);
            expect(mockFallbackExecutor.executeBulkAsync).toHaveBeenCalledWith(params);
            expect(result.error).toBeNull();
            expect(result.mergeResultEntries).toEqual([{ id: 'r1', created: true }]);
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

    describe('executeBulkAsync — no fallback', () => {
        test('returns error entries when produce fails and no fallback set', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka unavailable'));

            const operations = [makeEntry({ id: 'r1', uuid: 'u1' })];
            const result = await executor.executeBulkAsync({
                resourceType: 'TestResource',
                operations,
                requestInfo: { requestId: 'req-nofb-1' },
                base_version: '4_0_0'
            });

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

        test('throws when fallbackExecutor is not a BulkWriteExecutor', () => {
            expect(() => new KafkaClickPipeBulkWriteExecutor({
                kafkaClientV2: mockKafkaClientV2,
                schemaRegistry: mockSchemaRegistry,
                fallbackExecutor: {}
            })).toThrow();
        });
    });
});
