'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn(() => 'mock-uuid-123')
}));

jestObj.mock('../../../utils/kafkaClient', () => ({
    KafkaClient: class KafkaClient {}
}));

jestObj.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message }) { super(message); }
    }
}));

jestObj.mock('../../../fhir/classes/4_0_0/custom_resources/exportStatus', () => class ExportStatus {});

jestObj.mock('../../../constants', () => ({
    BULK_EXPORT_EVENT_STATUS_MAP: {
        'completed': 'BulkExportCompleted',
        'active': 'BulkExportStarted'
    }
}));

const { BulkExportEventProducer } = require('../../../utils/bulkExportEventProducer');

describe('BulkExportEventProducer', () => {
    let producer;
    let mockKafkaClient;
    let mockConfigManager;

    beforeEach(() => {
        mockKafkaClient = { sendMessagesAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockConfigManager = { kafkaEnableExportEvents: true };
        producer = new BulkExportEventProducer({
            kafkaClient: mockKafkaClient,
            fhirBulkExportEventTopic: 'export-events',
            configManager: mockConfigManager
        });
    });

    test('constructor stores dependencies', () => {
        expect(producer.kafkaClient).toBe(mockKafkaClient);
        expect(producer.fhirBulkExportEventTopic).toBe('export-events');
        expect(producer.configManager).toBe(mockConfigManager);
    });

    test('produce sends message to kafka', async () => {
        const resource = {
            id: 'export-1',
            meta: { source: 'test-source' },
            transactionTime: '2023-01-01',
            request: '/Patient/$export',
            status: 'completed'
        };

        await producer.produce({ resource, requestId: 'req-1' });

        expect(mockKafkaClient.sendMessagesAsync).toHaveBeenCalledWith('export-events', [
            expect.objectContaining({
                key: 'mock-uuid-123',
                fhirVersion: 'R4',
                requestId: 'req-1'
            })
        ]);
    });

    test('produce does nothing when kafkaEnableExportEvents is false', async () => {
        mockConfigManager.kafkaEnableExportEvents = false;
        const resource = {
            id: 'export-1',
            meta: { source: 's' },
            transactionTime: 't',
            request: 'r',
            status: 'completed'
        };

        await producer.produce({ resource, requestId: 'req-1' });

        expect(mockKafkaClient.sendMessagesAsync).not.toHaveBeenCalled();
    });

    test('produce throws RethrownError on kafka failure', async () => {
        mockKafkaClient.sendMessagesAsync.mockRejectedValue(new Error('Kafka down'));
        const resource = {
            id: 'export-1',
            meta: { source: 's' },
            transactionTime: 't',
            request: 'r',
            status: 'completed'
        };

        await expect(producer.produce({ resource, requestId: 'req-1' })).rejects.toThrow(
            'Error in BulkExportEventProducer.produce():'
        );
    });

    test('_createMessage builds correct message structure', () => {
        const resource = {
            id: 'export-2',
            meta: { source: 'my-source' },
            transactionTime: '2023-06-15',
            request: '/Observation/$export',
            status: 'active'
        };

        const msg = producer._createMessage({ resource, eventType: 'BulkExportStarted' });

        expect(msg.specversion).toBe('1.0');
        expect(msg.id).toBe('mock-uuid-123');
        expect(msg.source).toBe('my-source');
        expect(msg.type).toBe('BulkExportStarted');
        expect(msg.datacontenttype).toBe('application/json');
        expect(msg.data.exportJobId).toBe('export-2');
        expect(msg.data.status).toBe('active');
    });
});
