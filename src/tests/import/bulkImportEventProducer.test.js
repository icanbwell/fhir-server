const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { BulkImportEventProducer } = require('../../operations/import/bulkImportEventProducer');
const { MockKafkaClientV2 } = require('../mocks/mockKafkaClientV2');
const { ConfigManager } = require('../../utils/configManager');

describe('BulkImportEventProducer', () => {
    let producer;
    let kafkaClientV2;

    beforeEach(() => {
        process.env.ENABLE_EVENTS_KAFKA_V2 = '1';
        const configManager = new ConfigManager();
        kafkaClientV2 = new MockKafkaClientV2({ configManager });
        producer = new BulkImportEventProducer({ kafkaClientV2, configManager });
    });

    afterEach(() => {
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
    });

    test('calculateByteRanges splits a file into correct ranges', () => {
        const fileSize = 250 * 1024 * 1024; // 250MB
        const ranges = producer.calculateByteRanges(fileSize);

        expect(ranges).toHaveLength(3);
        expect(ranges[0]).toEqual({ start: 0, end: 100 * 1024 * 1024 });
        expect(ranges[1]).toEqual({ start: 100 * 1024 * 1024, end: 200 * 1024 * 1024 });
        expect(ranges[2]).toEqual({ start: 200 * 1024 * 1024, end: 250 * 1024 * 1024 });
    });

    test('calculateByteRanges returns single range for small file', () => {
        const fileSize = 50 * 1024 * 1024; // 50MB
        const ranges = producer.calculateByteRanges(fileSize);

        expect(ranges).toHaveLength(1);
        expect(ranges[0]).toEqual({ start: 0, end: 50 * 1024 * 1024 });
    });

    test('calculateByteRanges returns single range for exact range-size file', () => {
        const fileSize = 100 * 1024 * 1024; // exactly 100MB
        const ranges = producer.calculateByteRanges(fileSize);

        expect(ranges).toHaveLength(1);
        expect(ranges[0]).toEqual({ start: 0, end: 100 * 1024 * 1024 });
    });

    test('publishImportEventsAsync sends one message per byte range', async () => {
        const count = await producer.publishImportEventsAsync({
            taskId: 'task-001',
            inputs: [
                { url: 's3://bucket/Patient.ndjson', fileSize: 250 * 1024 * 1024 }
            ],
            requestId: 'req-001',
            scope: 'user/*.write',
            user: 'test-user'
        });

        expect(count).toBe(3);
        const messages = kafkaClientV2.getCloudEventMessages();
        expect(messages).toHaveLength(3);

        const event0 = JSON.parse(messages[0].value);
        expect(event0.type).toBe('ImportRangeRequested');
        expect(event0.data.taskId).toBe('task-001');
        expect(event0.data.filepath).toBe('s3://bucket/Patient.ndjson');
        expect(event0.data.byteRangeStart).toBe(0);
        expect(event0.data.byteRangeEnd).toBe(100 * 1024 * 1024);
        expect(event0.data.rangeIndex).toBe(0);
        expect(event0.data.totalRanges).toBe(3);
        expect(event0.data.requestId).toBe('req-001');

        const event2 = JSON.parse(messages[2].value);
        expect(event2.data.rangeIndex).toBe(2);
        expect(event2.data.byteRangeStart).toBe(200 * 1024 * 1024);
        expect(event2.data.byteRangeEnd).toBe(250 * 1024 * 1024);
    });

    test('publishImportEventsAsync handles multiple files', async () => {
        const count = await producer.publishImportEventsAsync({
            taskId: 'task-002',
            inputs: [
                { url: 's3://bucket/Patient.ndjson', fileSize: 100 * 1024 * 1024 },
                { url: 's3://bucket/Condition.ndjson', fileSize: 200 * 1024 * 1024 }
            ],
            requestId: 'req-002',
            scope: 'user/*.write',
            user: 'test-user'
        });

        // 1 range for 100MB file + 2 ranges for 200MB file = 3
        expect(count).toBe(3);
        const messages = kafkaClientV2.getCloudEventMessages();
        expect(messages).toHaveLength(3);

        const event0 = JSON.parse(messages[0].value);
        expect(event0.data.filepath).toBe('s3://bucket/Patient.ndjson');
        expect(event0.data.totalRanges).toBe(1);

        const event1 = JSON.parse(messages[1].value);
        expect(event1.data.filepath).toBe('s3://bucket/Condition.ndjson');
        expect(event1.data.totalRanges).toBe(2);
    });

    test('publishImportEventsAsync returns 0 for empty inputs', async () => {
        const count = await producer.publishImportEventsAsync({
            taskId: 'task-003',
            inputs: [],
            requestId: 'req-003',
            scope: 'user/*.write',
            user: 'test-user'
        });

        expect(count).toBe(0);
        expect(kafkaClientV2.getCloudEventMessages()).toHaveLength(0);
    });

    test('message keys include task ID and range index', async () => {
        await producer.publishImportEventsAsync({
            taskId: 'task-004',
            inputs: [
                { url: 's3://bucket/file.ndjson', fileSize: 250 * 1024 * 1024 }
            ],
            requestId: 'req-004',
            scope: 'user/*.write',
            user: 'test-user'
        });

        const messages = kafkaClientV2.getCloudEventMessages();
        expect(messages[0].key).toBe('task-004-0-0');
        expect(messages[1].key).toBe('task-004-0-1');
        expect(messages[2].key).toBe('task-004-0-2');
    });

    test('CloudEvent envelope has required fields', async () => {
        await producer.publishImportEventsAsync({
            taskId: 'task-005',
            inputs: [
                { url: 's3://bucket/file.ndjson', fileSize: 100 * 1024 * 1024 }
            ],
            requestId: 'req-005',
            scope: 'user/*.write',
            user: 'test-user'
        });

        const event = JSON.parse(kafkaClientV2.getCloudEventMessages()[0].value);
        expect(event.specversion).toBe('1.0');
        expect(event.id).toBeDefined();
        expect(event.source).toBe('https://www.icanbwell.com/fhir-server');
        expect(event.type).toBe('ImportRangeRequested');
        expect(event.datacontenttype).toBe('application/json');
    });

    test('publishImportEventsAsync skips sending when Kafka v2 events are disabled', async () => {
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        const configManager = new ConfigManager();
        const disabledKafka = new MockKafkaClientV2({ configManager });
        const disabledProducer = new BulkImportEventProducer({ kafkaClientV2: disabledKafka, configManager });

        const count = await disabledProducer.publishImportEventsAsync({
            taskId: 'task-disabled',
            inputs: [
                { url: 's3://bucket/Patient.ndjson', fileSize: 250 * 1024 * 1024 }
            ],
            requestId: 'req-disabled',
            scope: 'user/*.write',
            user: 'test-user'
        });

        expect(count).toBe(0);
        expect(disabledKafka.getCloudEventMessages()).toHaveLength(0);
    });
});
