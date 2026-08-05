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
        mockKafkaClientV2 = { sendMessagesAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockConfigManager = {
            kafkaV2EnableEvents: true,
            kafkaBulkImportEventTopic: 'import-events',
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
});
