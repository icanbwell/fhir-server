'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn(() => 'mock-uuid')
}));

jestObj.mock('../../../../../utils/kafkaClientV2', () => ({
    KafkaClientV2: class KafkaClientV2 {}
}));

jestObj.mock('../../../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { BulkImportEventProducer } = require('../../../../../operations/asyncJobs/bulkImport/bulkImportEventProducer');

describe('BulkImportEventProducer', () => {
    let producer;
    let mockKafkaClientV2;
    let mockConfigManager;

    beforeEach(() => {
        mockKafkaClientV2 = {
            sendMessagesAsync: jestObj.fn().mockResolvedValue(undefined),
            sendCloudEventMessageAsync: jestObj.fn().mockResolvedValue(undefined)
        };
        mockConfigManager = {
            kafkaV2EnableEvents: true,
            kafkaBulkImportEventTopic: 'import-events',
            kafkaBulkImportRangeProgressTopic: 'import-range-progress',
            bulkImportRangeSizeMb: 1
        };
        producer = new BulkImportEventProducer({
            kafkaClientV2: mockKafkaClientV2,
            configManager: mockConfigManager
        });
    });

    test('constructor stores dependencies', () => {
        expect(producer.kafkaClientV2).toBe(mockKafkaClientV2);
        expect(producer.configManager).toBe(mockConfigManager);
    });

    test('calculateByteRanges splits file into correct ranges', () => {
        const ranges = producer.calculateByteRanges(3 * 1024 * 1024);
        expect(ranges).toHaveLength(3);
        expect(ranges[0]).toEqual({ start: 0, end: 1048576 });
        expect(ranges[1]).toEqual({ start: 1048576, end: 2097152 });
        expect(ranges[2]).toEqual({ start: 2097152, end: 3145728 });
    });

    test('calculateByteRanges handles file smaller than range', () => {
        const ranges = producer.calculateByteRanges(500000);
        expect(ranges).toHaveLength(1);
        expect(ranges[0]).toEqual({ start: 0, end: 500000 });
    });

    test('calculateByteRanges handles exact multiple', () => {
        const ranges = producer.calculateByteRanges(2 * 1024 * 1024);
        expect(ranges).toHaveLength(2);
    });

    test('publishImportEventsAsync returns 0 when kafka disabled', async () => {
        mockConfigManager.kafkaV2EnableEvents = false;
        const result = await producer.publishImportEventsAsync({
            taskId: 't1', inputs: [{ url: 'f.ndjson', fileSize: 1000 }],
            requestId: 'r1', scope: 's', user: 'u'
        });
        expect(result).toBe(0);
    });

    test('message keys include task ID and range index', async () => {
        await producer.publishImportEventsAsync({
            taskId: 'task-004',
            inputs: [{ url: 's3://bucket/file.ndjson', fileSize: 3 * 1024 * 1024 }],
            requestId: 'req-004', scope: 'user/*.write', user: 'test-user'
        });

        const { messages } = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
        expect(messages[0].key).toBe('task-004-0-0');
        expect(messages[1].key).toBe('task-004-0-1');
        expect(messages[2].key).toBe('task-004-0-2');
    });

    test('CloudEvent envelope has required fields', async () => {
        await producer.publishImportEventsAsync({
            taskId: 'task-005',
            inputs: [{ url: 's3://bucket/file.ndjson', fileSize: 100 }],
            requestId: 'req-005', scope: 'user/*.write', user: 'test-user'
        });

        const { messages } = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
        const event = JSON.parse(messages[0].value);
        expect(event.specversion).toBe('1.0');
        expect(event.id).toBeDefined();
        expect(event.source).toBe('https://www.icanbwell.com/fhir-server');
        expect(event.type).toBe('ImportRangeRequested');
        expect(event.datacontenttype).toBe('application/json');
    });

    test('calculateTotalRangeCount sums ranges across every input file', () => {
        // 3MB + 0.5MB + exactly 2MB at a 1MB range size -> 3 + 1 + 2 ranges.
        const total = producer.calculateTotalRangeCount([
            { url: 'a.ndjson', fileSize: 3 * 1024 * 1024 },
            { url: 'b.ndjson', fileSize: 500000 },
            { url: 'c.ndjson', fileSize: 2 * 1024 * 1024 }
        ]);
        expect(total).toBe(6);
    });

    test('publishImportEventsAsync stamps every message with the task-wide taskTotalRanges, distinct from each message\'s own per-file totalRanges', async () => {
        // File A: 3 ranges, file B: 1 range -- task-wide total is 4, but neither file's own
        // totalRanges equals that, so a bug conflating the two would be immediately observable.
        const inputs = [
            { url: 'a.ndjson', fileSize: 3 * 1024 * 1024 },
            { url: 'b.ndjson', fileSize: 500000 }
        ];

        await producer.publishImportEventsAsync({
            taskId: 't1', inputs, requestId: 'r1', scope: 's', user: 'u'
        });

        const sentMessages = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages
            .map((m) => JSON.parse(m.value).data);

        expect(sentMessages).toHaveLength(4);
        for (const message of sentMessages) {
            expect(message.taskTotalRanges).toBe(4);
        }

        const fileARanges = sentMessages.filter((m) => m.filepath === 'a.ndjson');
        const fileBRanges = sentMessages.filter((m) => m.filepath === 'b.ndjson');
        expect(fileARanges.every((m) => m.totalRanges === 3)).toBe(true);
        expect(fileBRanges.every((m) => m.totalRanges === 1)).toBe(true);
    });

    describe('publishRangeProgressEventAsync', () => {
        test('does nothing when kafka is disabled', async () => {
            mockConfigManager.kafkaV2EnableEvents = false;
            await producer.publishRangeProgressEventAsync({
                type: 'ImportRangeStarted',
                data: { taskId: 't1', filepath: 'a.ndjson', rangeIndex: 0, taskTotalRanges: 1 }
            });
            expect(mockKafkaClientV2.sendCloudEventMessageAsync).not.toHaveBeenCalled();
        });

        test('publishes a CloudEvent of the given type onto the range-progress topic, keyed by taskId', async () => {
            await producer.publishRangeProgressEventAsync({
                type: 'ImportRangeCompleted',
                data: {
                    taskId: 't1', filepath: 'a.ndjson', rangeIndex: 0, taskTotalRanges: 1,
                    resultUri: 's3://bucket/result.ndjson', errorUri: null
                }
            });

            expect(mockKafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            const { topic, messages } = mockKafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0];
            expect(topic).toBe('import-range-progress');
            expect(messages).toHaveLength(1);
            expect(messages[0].key).toBe('t1');

            const cloudEvent = JSON.parse(messages[0].value);
            expect(cloudEvent.type).toBe('ImportRangeCompleted');
            expect(cloudEvent.data).toEqual({
                taskId: 't1', filepath: 'a.ndjson', rangeIndex: 0, taskTotalRanges: 1,
                resultUri: 's3://bucket/result.ndjson', errorUri: null
            });
        });

        test('propagates a Kafka send failure rather than swallowing it', async () => {
            mockKafkaClientV2.sendCloudEventMessageAsync.mockRejectedValueOnce(new Error('broker unavailable'));
            await expect(producer.publishRangeProgressEventAsync({
                type: 'ImportRangeFailed',
                data: { taskId: 't1', filepath: 'a.ndjson', rangeIndex: 0, taskTotalRanges: 1, errorMessage: 'boom' }
            })).rejects.toThrow('broker unavailable');
        });

    });
});
