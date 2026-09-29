'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
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
    CLOUD_EVENT: { SOURCE: 'https://www.icanbwell.com/fhir-server' }
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

const { PatientPersonManualLinkingEventProducer } = require('../../../utils/patientPersonManualLinkingEventProducer');

describe('PatientPersonManualLinkingEventProducer', () => {
    let producer;
    let mockKafkaClient;
    let mockConfigManager;

    beforeEach(() => {
        mockKafkaClient = { sendCloudEventMessageAsync: jestObj.fn().mockResolvedValue(undefined) };
        mockConfigManager = { kafkaEnablePersonPatientManualLinkingEvents: true };
        producer = new PatientPersonManualLinkingEventProducer({
            kafkaClient: mockKafkaClient,
            patientPersonLinkEventTopic: 'link-events',
            configManager: mockConfigManager
        });
    });

    test('constructor stores dependencies', () => {
        expect(producer.kafkaClient).toBe(mockKafkaClient);
        expect(producer.patientPersonLinkEventTopic).toBe('link-events');
        expect(producer.configManager).toBe(mockConfigManager);
    });

    test('produceEventAsync sends cloud event to kafka for linking', async () => {
        await producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: true
        });

        expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalledWith({
            topic: 'link-events',
            messages: [expect.objectContaining({
                key: 'person-123'
            })]
        });
    });

    test('produceEventAsync sends cloud event to kafka for unlinking', async () => {
        await producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: false
        });

        expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalledWith({
            topic: 'link-events',
            messages: [expect.objectContaining({
                key: 'person-123'
            })]
        });
    });

    test('produceEventAsync filters out undefined headers', async () => {
        await producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: true
        });

        const call = mockKafkaClient.sendCloudEventMessageAsync.mock.calls[0][0];
        const headers = call.messages[0].headers;
        expect(headers.undef).toBeUndefined();
        expect(headers['ce-type']).toBeDefined();
    });

    test('produceEventAsync does nothing when kafkaEnablePersonPatientManualLinkingEvents is false', async () => {
        mockConfigManager.kafkaEnablePersonPatientManualLinkingEvents = false;

        await producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: true
        });

        expect(mockKafkaClient.sendCloudEventMessageAsync).not.toHaveBeenCalled();
    });

    test('produceEventAsync throws RethrownError on failure', async () => {
        mockKafkaClient.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka error'));

        await expect(producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: true
        })).rejects.toThrow('Error in PatientPersonManualLinkingEventProducer.produceEventAsync():');
    });

    test('_createCloudEvent builds correct cloud event for linking', () => {
        const event = producer._createCloudEvent({
            operationType: 'PatientPersonManuallyLinked',
            personId: 'person-123',
            patientId: 'patient-456'
        });

        expect(event.source).toBe('https://www.icanbwell.com/fhir-server');
        expect(event.type).toBe('PatientPersonManuallyLinked');
        expect(event.datacontenttype).toBe('application/json;charset=utf-8');
        const data = JSON.parse(event.data);
        expect(data.personId).toBe('person-123');
        expect(data.patientId).toBe('patient-456');
    });

    test('_createCloudEvent builds correct cloud event for unlinking', () => {
        const event = producer._createCloudEvent({
            operationType: 'PatientPersonManuallyUnlinked',
            personId: 'person-789',
            patientId: 'patient-012'
        });

        expect(event.type).toBe('PatientPersonManuallyUnlinked');
        const data = JSON.parse(event.data);
        expect(data.personId).toBe('person-789');
        expect(data.patientId).toBe('patient-012');
    });

    test('produceEventAsync uses PatientPersonManuallyLinked as operationType when isLinking is true', async () => {
        const { Kafka } = require('cloudevents');

        await producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: true
        });

        const binaryCall = Kafka.binary.mock.calls[0][0];
        expect(binaryCall.type).toBe('PatientPersonManuallyLinked');
    });

    test('produceEventAsync uses PatientPersonManuallyUnlinked as operationType when isLinking is false', async () => {
        const { Kafka } = require('cloudevents');
        Kafka.binary.mockClear();

        await producer.produceEventAsync({
            personId: 'person-123',
            patientId: 'patient-456',
            isLinking: false
        });

        const binaryCall = Kafka.binary.mock.calls[0][0];
        expect(binaryCall.type).toBe('PatientPersonManuallyUnlinked');
    });
});
