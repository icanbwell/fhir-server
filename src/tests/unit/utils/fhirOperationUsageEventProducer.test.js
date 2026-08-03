'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn(() => 'mock-uuid-456')
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

jestObj.mock('../../../constants', () => ({
    CLOUD_EVENT: { SOURCE: 'fhir-server' }
}));

jestObj.mock('cloudevents', () => ({
    CloudEvent: class CloudEvent {
        constructor(payload) { Object.assign(this, payload); }
    },
    Kafka: {
        binary: jestObj.fn((event) => ({
            body: JSON.stringify(event.data),
            headers: { 'ce-type': event.type, 'ce-source': event.source, undef: undefined }
        }))
    }
}));

const { FhirOperationUsageEventProducer } = require('../../../utils/fhirOperationUsageEventProducer');

describe('FhirOperationUsageEventProducer', () => {
    let producer;
    let mockKafkaClient;
    let mockConfigManager;

    beforeEach(() => {
        mockKafkaClient = { sendCloudEventMessageAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockConfigManager = { kafkaEnableFhirOperationUsageEvents: true };
        producer = new FhirOperationUsageEventProducer({
            kafkaClient: mockKafkaClient,
            fhirOperationAccessEventTopic: 'operation-events',
            configManager: mockConfigManager
        });
    });

    test('constructor stores dependencies', () => {
        expect(producer.kafkaClient).toBe(mockKafkaClient);
        expect(producer.fhirOperationAccessEventTopic).toBe('operation-events');
        expect(producer.configManager).toBe(mockConfigManager);
    });

    test('produce sends cloud event to kafka', async () => {
        await producer.produce({
            operationType: 'AccessedEverything',
            managingOrganization: 'org-1',
            bwellFhirPersonId: 'person-1',
            clientFhirPersonId: 'client-1'
        });

        expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalledWith({
            topic: 'operation-events',
            messages: [expect.objectContaining({
                key: 'mock-uuid-456'
            })]
        });
    });

    test('produce filters out undefined headers', async () => {
        await producer.produce({
            operationType: 'AccessedEverything',
            managingOrganization: 'org-1',
            bwellFhirPersonId: 'person-1',
            clientFhirPersonId: 'client-1'
        });

        const call = mockKafkaClient.sendCloudEventMessageAsync.mock.calls[0][0];
        const headers = call.messages[0].headers;
        expect(headers.undef).toBeUndefined();
        expect(headers['ce-type']).toBeDefined();
    });

    test('produce does nothing when kafkaEnableFhirOperationUsageEvents is false', async () => {
        mockConfigManager.kafkaEnableFhirOperationUsageEvents = false;

        await producer.produce({
            operationType: 'AccessedEverything',
            managingOrganization: 'org-1',
            bwellFhirPersonId: 'person-1',
            clientFhirPersonId: 'client-1'
        });

        expect(mockKafkaClient.sendCloudEventMessageAsync).not.toHaveBeenCalled();
    });

    test('produce throws RethrownError on failure', async () => {
        mockKafkaClient.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka error'));

        await expect(producer.produce({
            operationType: 'AccessedEverything',
            managingOrganization: 'org-1',
            bwellFhirPersonId: 'person-1',
            clientFhirPersonId: 'client-1'
        })).rejects.toThrow('Error in FhirOperationUsageEventProducer.produce():');
    });

    test('_createCloudEvent builds correct cloud event', () => {
        const event = producer._createCloudEvent({
            operationType: 'AccessedEverything',
            managingOrganization: 'org-1',
            bwellFhirPersonId: 'person-1',
            clientFhirPersonId: 'client-1',
            event_integrations: ['analytics']
        });

        expect(event.source).toBe('fhir-server');
        expect(event.type).toBe('AccessedEverything');
        expect(event.datacontenttype).toBe('application/json;charset=utf-8');
        expect(event.integrations).toBe(JSON.stringify(['analytics']));
        const data = JSON.parse(event.data);
        expect(data.managingOrganization).toBe('org-1');
        expect(data.bwellFhirPersonId).toBe('person-1');
    });
});
