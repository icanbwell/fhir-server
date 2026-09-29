const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn().mockReturnValue('test-uuid-123')
}));
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        format: jestObj.fn().mockReturnValue('2024-01-15')
    };
    const momentFn = jestObj.fn().mockReturnValue(mockMoment);
    momentFn.utc = jestObj.fn().mockReturnValue(mockMoment);
    return momentFn;
});
jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jestObj.fn().mockResolvedValue(undefined),
    logSystemErrorAsync: jestObj.fn().mockResolvedValue(undefined)
}));
jestObj.mock('../../../fhir/classes/4_0_0/resources/auditEvent', () => {
    return jestObj.fn().mockImplementation((args) => ({ ...args, resourceType: 'AuditEvent' }));
});
jestObj.mock('../../../fhir/classes/4_0_0/complex_types/codeableConcept', () => {
    return jestObj.fn().mockImplementation((args) => args);
});
jestObj.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return jestObj.fn().mockImplementation((args) => args);
});
jestObj.mock('../../../fhir/classes/4_0_0/backbone_elements/auditEventAgent', () => {
    return jestObj.fn().mockImplementation((args) => args);
});
jestObj.mock('../../../fhir/classes/4_0_0/complex_types/reference', () => {
    return jestObj.fn().mockImplementation((args) => args);
});
jestObj.mock('../../../fhir/classes/4_0_0/backbone_elements/auditEventSource', () => {
    return jestObj.fn().mockImplementation((args) => args);
});
jestObj.mock('../../../fhir/classes/4_0_0/complex_types/period', () => {
    return jestObj.fn().mockImplementation((args) => args);
});
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

describe('ChangeEventProducer', () => {
    let ChangeEventProducer;
    let producer;
    let mockKafkaClient;
    let mockResourceManager;
    let mockConfigManager;
    let originalEnv;

    beforeEach(() => {
        jestObj.clearAllMocks();

        originalEnv = process.env.ENABLE_EVENTS_KAFKA;
        delete process.env.ENABLE_EVENTS_KAFKA;

        mockKafkaClient = {
            sendMessagesAsync: jestObj.fn().mockResolvedValue(undefined)
        };

        mockResourceManager = {};

        mockConfigManager = {
            kafkaEnabledResources: ['Patient', 'Consent', 'Observation'],
            postRequestBatchSize: 50
        };

        ChangeEventProducer = require('../../../utils/changeEventProducer').ChangeEventProducer;

        producer = new ChangeEventProducer({
            kafkaClient: mockKafkaClient,
            resourceManager: mockResourceManager,
            fhirResourceChangeTopic: 'fhir.resource.change',
            configManager: mockConfigManager
        });
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.ENABLE_EVENTS_KAFKA;
        } else {
            process.env.ENABLE_EVENTS_KAFKA = originalEnv;
        }
    });

    describe('constructor', () => {
        test('initializes with empty fhirResourceMessageMap', () => {
            expect(producer.getFhirResourceMessageMap().size).toBe(0);
        });

        test('stores kafkaClient', () => {
            expect(producer.kafkaClient).toBe(mockKafkaClient);
        });

        test('stores resourceManager', () => {
            expect(producer.resourceManager).toBe(mockResourceManager);
        });

        test('stores fhirResourceChangeTopic', () => {
            expect(producer.fhirResourceChangeTopic).toBe('fhir.resource.change');
        });

        test('stores configManager', () => {
            expect(producer.configManager).toBe(mockConfigManager);
        });
    });

    describe('getFhirResourceMessageMap', () => {
        test('returns the internal Map instance', () => {
            const map = producer.getFhirResourceMessageMap();
            expect(map).toBeInstanceOf(Map);
        });

        test('returns the same Map instance on repeated calls', () => {
            const map1 = producer.getFhirResourceMessageMap();
            const map2 = producer.getFhirResourceMessageMap();
            expect(map1).toBe(map2);
        });
    });

    describe('_createMessage', () => {
        test('creates AuditEvent with correct structure for Create event', () => {
            const message = producer._createMessage({
                requestId: 'req-123',
                id: 'patient-1',
                timestamp: '2024-01-15',
                eventType: 'C',
                resourceType: 'Patient',
                eventName: 'Patient Create',
                sourceType: 'bwell'
            });

            expect(message.action).toBe('C');
            expect(message.id).toBe('test-uuid-123');
            expect(message.resourceType).toBe('AuditEvent');
        });

        test('creates message with source.type when sourceType is provided', () => {
            const message = producer._createMessage({
                requestId: 'req-123',
                id: 'patient-1',
                timestamp: '2024-01-15',
                eventType: 'U',
                resourceType: 'Patient',
                eventName: 'Patient Change',
                sourceType: 'testSource'
            });

            expect(message.source.type).toBeDefined();
            expect(message.source.type.code).toBe('testSource');
            expect(message.source.type.system).toBe('https://www.icanbwell.com/sourceType');
        });

        test('does not set source.type when sourceType is falsy', () => {
            const message = producer._createMessage({
                requestId: 'req-123',
                id: 'patient-1',
                timestamp: '2024-01-15',
                eventType: 'C',
                resourceType: 'Patient',
                eventName: 'Patient Create',
                sourceType: undefined
            });

            expect(message.source.type).toBeUndefined();
        });

        test('sets agent reference to resourceType/id', () => {
            const message = producer._createMessage({
                requestId: 'req-123',
                id: 'obs-456',
                timestamp: '2024-01-15',
                eventType: 'U',
                resourceType: 'Observation',
                eventName: 'Observation Change',
                sourceType: null
            });

            expect(message.agent[0].who.reference).toBe('Observation/obs-456');
        });

        test('sets source.site to requestId', () => {
            const message = producer._createMessage({
                requestId: 'my-request-id',
                id: 'patient-1',
                timestamp: '2024-01-15',
                eventType: 'C',
                resourceType: 'Patient',
                eventName: 'Patient Create',
                sourceType: null
            });

            expect(message.source.site).toBe('my-request-id');
        });

        test('sets purposeOfEvent with correct event name and system', () => {
            const message = producer._createMessage({
                requestId: 'req-1',
                id: 'patient-1',
                timestamp: '2024-01-15',
                eventType: 'D',
                resourceType: 'Patient',
                eventName: 'Patient Delete',
                sourceType: null
            });

            expect(message.purposeOfEvent[0].coding[0].code).toBe('Patient Delete');
            expect(message.purposeOfEvent[0].coding[0].system).toBe('https://www.icanbwell.com/event-purpose');
        });
    });

    describe('onResourceChangeAsync', () => {
        test('adds Create event to the message map', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: 'testSource',
                eventType: 'C'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
            expect(map.has('patient-1')).toBe(true);
        });

        test('adds Update event to the message map', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: 'testSource',
                eventType: 'U'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
            const message = map.get('patient-1');
            expect(message.action).toBe('U');
        });

        test('adds Delete event to the message map', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'D'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
            const message = map.get('patient-1');
            expect(message.action).toBe('D');
        });

        test('does NOT overwrite Create event with Update for the same resource id', async () => {
            // First: create event
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            // Then: update event for same resource
            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-16',
                sourceType: null,
                eventType: 'U'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
            // Create event should remain (not overwritten by update)
            expect(map.get('patient-1').action).toBe('C');
        });

        test('does NOT overwrite Create event with Delete for the same resource id', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-16',
                sourceType: null,
                eventType: 'D'
            });

            const map = producer.getFhirResourceMessageMap();
            // Create stays since existing entry has action 'C'
            expect(map.get('patient-1').action).toBe('C');
        });

        test('overwrites Update event with another Update', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'U'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-16',
                sourceType: 'newSource',
                eventType: 'U'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
            // Second update overwrites first since first is not a 'C'
            expect(map.get('patient-1').source.site).toBe('req-2');
        });

        test('overwrites Update event with Delete', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'U'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-16',
                sourceType: null,
                eventType: 'D'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.get('patient-1').action).toBe('D');
        });

        test('handles multiple different resource ids independently', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-2',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'U'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-3',
                id: 'obs-1',
                resourceType: 'Observation',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'D'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(3);
            expect(map.get('patient-1').action).toBe('C');
            expect(map.get('patient-2').action).toBe('U');
            expect(map.get('obs-1').action).toBe('D');
        });

        test('uses id as map key (string conversion)', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: '12345',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.has('12345')).toBe(true);
        });

        test('generates correct event name from EVENT_NAME_MAP for C', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'p-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            const message = producer.getFhirResourceMessageMap().get('p-1');
            expect(message.purposeOfEvent[0].coding[0].code).toBe('Patient Create');
        });

        test('generates correct event name from EVENT_NAME_MAP for U', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'p-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'U'
            });

            const message = producer.getFhirResourceMessageMap().get('p-1');
            expect(message.purposeOfEvent[0].coding[0].code).toBe('Patient Change');
        });

        test('generates correct event name from EVENT_NAME_MAP for D', async () => {
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'p-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'D'
            });

            const message = producer.getFhirResourceMessageMap().get('p-1');
            expect(message.purposeOfEvent[0].coding[0].code).toBe('Patient Delete');
        });
    });

    describe('afterSaveAsync', () => {
        test('processes resource for kafka-enabled resource type', async () => {
            const doc = { id: 'patient-1' };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
        });

        test('skips resource not in kafkaEnabledResources', async () => {
            const doc = { id: 'encounter-1' };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Encounter', // Not in kafkaEnabledResources
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(0);
        });

        test('extracts sourceType from doc.extension', async () => {
            const doc = {
                id: 'patient-1',
                extension: [
                    {
                        url: 'https://www.icanbwell.com/sourceType',
                        valueString: 'mySourceType'
                    }
                ]
            };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            const message = map.get('patient-1');
            expect(message.source.type.code).toBe('mySourceType');
        });

        test('handles doc with extension array missing sourceType url', async () => {
            const doc = {
                id: 'patient-1',
                extension: [
                    {
                        url: 'https://www.icanbwell.com/otherExtension',
                        valueString: 'something'
                    }
                ]
            };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            const message = map.get('patient-1');
            // No sourceType means source.type should not be set
            expect(message.source.type).toBeUndefined();
        });

        test('handles doc without extension property', async () => {
            const doc = { id: 'patient-1' };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'U',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
        });

        test('handles doc with null extension', async () => {
            const doc = { id: 'patient-1', extension: null };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
        });

        test('handles doc with empty extension array', async () => {
            const doc = { id: 'patient-1', extension: [] };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
        });

        test('triggers flush when message map reaches batch size', async () => {
            mockConfigManager.postRequestBatchSize = 2;
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { id: 'patient-1' }
            });

            await producer.afterSaveAsync({
                requestId: 'req-2',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { id: 'patient-2' }
            });

            // After hitting batch size, flush should have sent messages
            expect(mockKafkaClient.sendMessagesAsync).toHaveBeenCalled();
        });

        test('does not trigger flush when below batch size', async () => {
            mockConfigManager.postRequestBatchSize = 100;
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { id: 'patient-1' }
            });

            expect(mockKafkaClient.sendMessagesAsync).not.toHaveBeenCalled();
        });

        test('wraps errors in RethrownError', async () => {
            // Force error by making doc.extension getter throw
            const doc = {
                id: 'patient-1',
                get extension() {
                    throw new Error('Extension access error');
                }
            };

            await expect(
                producer.afterSaveAsync({
                    requestId: 'req-1',
                    eventType: 'C',
                    resourceType: 'Patient',
                    doc
                })
            ).rejects.toThrow('Error in ChangeEventProducer.afterSaveAsync()');
        });

        test('calls logTraceSystemEventAsync with event details', async () => {
            const { logTraceSystemEventAsync } = require('../../../operations/common/systemEventLogging');
            const doc = { id: 'patient-1' };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            expect(logTraceSystemEventAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'fireEventsAsync_Patient',
                    message: 'Fire Events'
                })
            );
        });
    });

    describe('flushAsync', () => {
        test('clears map when ENABLE_EVENTS_KAFKA is not set', async () => {
            delete process.env.ENABLE_EVENTS_KAFKA;

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            expect(producer.getFhirResourceMessageMap().size).toBe(1);
            await producer.flushAsync();
            expect(producer.getFhirResourceMessageMap().size).toBe(0);
            expect(mockKafkaClient.sendMessagesAsync).not.toHaveBeenCalled();
        });

        test('does nothing when map is empty and ENABLE_EVENTS_KAFKA is set', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.flushAsync();

            expect(mockKafkaClient.sendMessagesAsync).not.toHaveBeenCalled();
        });

        test('sends messages to kafka with correct topic when ENABLE_EVENTS_KAFKA is set', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.flushAsync();

            expect(mockKafkaClient.sendMessagesAsync).toHaveBeenCalledWith(
                'fhir.resource.change',
                expect.any(Array)
            );
        });

        test('sends messages with correct structure', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.flushAsync();

            const messages = mockKafkaClient.sendMessagesAsync.mock.calls[0][1];
            expect(messages).toHaveLength(1);
            expect(messages[0].key).toBe('patient-1');
            expect(messages[0].fhirVersion).toBe('R4');
            expect(messages[0].requestId).toBeDefined();
            expect(typeof messages[0].value).toBe('string');
            // value should be valid JSON
            expect(() => JSON.parse(messages[0].value)).not.toThrow();
        });

        test('clears map after successful kafka send', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.flushAsync();

            expect(producer.getFhirResourceMessageMap().size).toBe(0);
        });

        test('handles kafka send error gracefully without throwing', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';
            mockKafkaClient.sendMessagesAsync.mockRejectedValue(new Error('Kafka unavailable'));

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            // Should not throw
            await expect(producer.flushAsync()).resolves.not.toThrow();
        });

        test('logs error when kafka send fails', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';
            const { logSystemErrorAsync } = require('../../../operations/common/systemEventLogging');
            mockKafkaClient.sendMessagesAsync.mockRejectedValue(new Error('Connection refused'));

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.flushAsync();

            expect(logSystemErrorAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'KafkaClient',
                    message: 'Connection refused'
                })
            );
        });

        test('sends multiple messages for multiple resources', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-2',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'U'
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-3',
                id: 'obs-1',
                resourceType: 'Observation',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'D'
            });

            await producer.flushAsync();

            const messages = mockKafkaClient.sendMessagesAsync.mock.calls[0][1];
            expect(messages).toHaveLength(3);

            const keys = messages.map(m => m.key);
            expect(keys).toContain('patient-1');
            expect(keys).toContain('patient-2');
            expect(keys).toContain('obs-1');
        });

        test('logs trace event after successful flush with message count', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';
            const { logTraceSystemEventAsync } = require('../../../operations/common/systemEventLogging');

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: null,
                eventType: 'C'
            });

            await producer.flushAsync();

            expect(logTraceSystemEventAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'changeEventProducer',
                    message: 'Finished',
                    args: expect.objectContaining({
                        numberOfMessagesBefore: 1,
                        numberOfMessagesAfter: 0,
                        resourceTopic: 'fhir.resource.change'
                    })
                })
            );
        });
    });
});
