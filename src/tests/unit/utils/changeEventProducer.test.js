/**
 * Unit tests for ChangeEventProducer
 * Tests for bugs: undefined event names, incorrect RethrownError usage, null doc handling
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../utils/uid.util', () => ({
    generateUUID: jest.fn().mockReturnValue('test-uuid-123')
}));
jest.mock('moment-timezone', () => {
    const mockMoment = {
        format: jest.fn().mockReturnValue('2024-01-15')
    };
    const momentFn = jest.fn().mockReturnValue(mockMoment);
    momentFn.utc = jest.fn().mockReturnValue(mockMoment);
    return momentFn;
});
jest.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn().mockResolvedValue(undefined),
    logSystemErrorAsync: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../fhir/classes/4_0_0/resources/auditEvent', () => {
    return jest.fn().mockImplementation((args) => ({ ...args, resourceType: 'AuditEvent' }));
});
jest.mock('../../../fhir/classes/4_0_0/complex_types/codeableConcept', () => {
    return jest.fn().mockImplementation((args) => args);
});
jest.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return jest.fn().mockImplementation((args) => args);
});
jest.mock('../../../fhir/classes/4_0_0/backbone_elements/auditEventAgent', () => {
    return jest.fn().mockImplementation((args) => args);
});
jest.mock('../../../fhir/classes/4_0_0/complex_types/reference', () => {
    return jest.fn().mockImplementation((args) => args);
});
jest.mock('../../../fhir/classes/4_0_0/backbone_elements/auditEventSource', () => {
    return jest.fn().mockImplementation((args) => args);
});
jest.mock('../../../fhir/classes/4_0_0/complex_types/period', () => {
    return jest.fn().mockImplementation((args) => args);
});
jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

describe('ChangeEventProducer', () => {
    let ChangeEventProducer;
    let producer;
    let mockKafkaClient;
    let mockResourceManager;
    let mockConfigManager;

    beforeEach(() => {
        jest.clearAllMocks();

        mockKafkaClient = {
            sendMessagesAsync: jest.fn().mockResolvedValue(undefined)
        };

        mockResourceManager = {};

        mockConfigManager = {
            kafkaEnabledResources: ['Patient', 'Consent'],
            postRequestBatchSize: 50
        };

        ChangeEventProducer = require('../../../utils/changeEventProducer').ChangeEventProducer;

        producer = new ChangeEventProducer({
            kafkaClient: mockKafkaClient,
            resourceManager: mockResourceManager,
            fhirResourceChangeTopic: 'test-topic',
            configManager: mockConfigManager
        });
    });

    describe('onResourceChangeAsync', () => {
        test('should create message with valid event type C', async () => {
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

        test('should create message with valid event type U', async () => {
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
        });

        test('BUG: undefined event name when eventType is not in EVENT_NAME_MAP', async () => {
            // EVENT_NAME_MAP only has C, U, D keys
            // If an invalid eventType is passed, EVENT_NAME_MAP[eventType] returns undefined
            // This produces an eventName like "Patient undefined"
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: 'testSource',
                eventType: 'X' // Invalid event type
            });

            const map = producer.getFhirResourceMessageMap();
            const message = map.get('patient-1');
            // The purposeOfEvent coding should contain the event name
            // Bug: eventName will be "Patient undefined" instead of a valid name
            const eventCoding = message.purposeOfEvent[0].coding[0];
            expect(eventCoding.code).toBe('Patient undefined');
            // This demonstrates the bug - the code should either validate
            // eventType or have a fallback, not produce "undefined" in the event name
        });

        test('should not overwrite Create event with Update event for same key', async () => {
            // First add a Create event
            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: 'testSource',
                eventType: 'C'
            });

            // Now try to add an Update event for the same resource
            await producer.onResourceChangeAsync({
                requestId: 'req-2',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-16',
                sourceType: 'testSource',
                eventType: 'U'
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
            // The Create event should still be there (not overwritten by Update)
            const message = map.get('patient-1');
            expect(message.action).toBe('C');
        });
    });

    describe('afterSaveAsync', () => {
        test('should process resource with extensions for sourceType', async () => {
            const doc = {
                id: 'patient-1',
                extension: [
                    {
                        url: 'https://www.icanbwell.com/sourceType',
                        valueString: 'testSourceType'
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
            expect(map.size).toBe(1);
        });

        test('should handle doc without extensions', async () => {
            const doc = {
                id: 'patient-1'
            };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(1);
        });

        test('should skip resource not in kafkaEnabledResources', async () => {
            const doc = {
                id: 'obs-1'
            };

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Observation', // Not in kafkaEnabledResources
                doc
            });

            const map = producer.getFhirResourceMessageMap();
            expect(map.size).toBe(0);
        });

        // EXPECTED: correct behavior (will fail until bug is fixed)
        test('RethrownError should receive Error object, not e.stack string', async () => {
            // When afterSaveAsync throws, it should wrap with RethrownError({error: e})
            // not RethrownError({error: e.stack}). The Error object preserves the full
            // error context including stack, message, and any custom properties.

            // Force an error by making doc.extension.some throw
            const doc = {
                id: 'patient-1',
                get extension() {
                    throw new Error('Simulated extension access error');
                }
            };

            try {
                await producer.afterSaveAsync({
                    requestId: 'req-1',
                    eventType: 'C',
                    resourceType: 'Patient',
                    doc
                });
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(e.constructor.name).toBe('RethrownError');
                // The original_error should be an Error instance, not a string
                expect(e.originalError instanceof Error).toBe(true);
                expect(typeof e.originalError).toBe('object');
            }
        });

        test('should flush when message map reaches batch size', async () => {
            // Set batch size to 2
            mockConfigManager.postRequestBatchSize = 2;

            // Set ENABLE_EVENTS_KAFKA to trigger actual flush
            const originalEnv = process.env.ENABLE_EVENTS_KAFKA;
            process.env.ENABLE_EVENTS_KAFKA = '1';

            try {
                const doc1 = { id: 'patient-1' };
                const doc2 = { id: 'patient-2' };

                await producer.afterSaveAsync({
                    requestId: 'req-1',
                    eventType: 'C',
                    resourceType: 'Patient',
                    doc: doc1
                });

                await producer.afterSaveAsync({
                    requestId: 'req-2',
                    eventType: 'C',
                    resourceType: 'Patient',
                    doc: doc2
                });

                // After batch size reached, flush should have been called
                expect(mockKafkaClient.sendMessagesAsync).toHaveBeenCalled();
            } finally {
                if (originalEnv === undefined) {
                    delete process.env.ENABLE_EVENTS_KAFKA;
                } else {
                    process.env.ENABLE_EVENTS_KAFKA = originalEnv;
                }
            }
        });

        test('BUG: crashes when doc.extension is truthy but not an array', async () => {
            // doc.extension is checked with doc.extension && doc.extension.some(...)
            // If extension is not an array (e.g., an object), .some() will throw
            const doc = {
                id: 'patient-1',
                extension: 'not-an-array' // Invalid: should be array
            };

            // This should throw because .some() is called on a string
            await expect(
                producer.afterSaveAsync({
                    requestId: 'req-1',
                    eventType: 'C',
                    resourceType: 'Patient',
                    doc
                })
            ).rejects.toThrow();
        });
    });

    describe('flushAsync', () => {
        test('should clear map when ENABLE_EVENTS_KAFKA is not set', async () => {
            delete process.env.ENABLE_EVENTS_KAFKA;

            await producer.onResourceChangeAsync({
                requestId: 'req-1',
                id: 'patient-1',
                resourceType: 'Patient',
                timestamp: '2024-01-15',
                sourceType: 'testSource',
                eventType: 'C'
            });

            expect(producer.getFhirResourceMessageMap().size).toBe(1);

            await producer.flushAsync();

            expect(producer.getFhirResourceMessageMap().size).toBe(0);
            expect(mockKafkaClient.sendMessagesAsync).not.toHaveBeenCalled();
        });

        test('should skip flush when map is empty and ENABLE_EVENTS_KAFKA is set', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';
            try {
                await producer.flushAsync();
                expect(mockKafkaClient.sendMessagesAsync).not.toHaveBeenCalled();
            } finally {
                delete process.env.ENABLE_EVENTS_KAFKA;
            }
        });

        test('should send messages to kafka when ENABLE_EVENTS_KAFKA is set', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';
            try {
                await producer.onResourceChangeAsync({
                    requestId: 'req-1',
                    id: 'patient-1',
                    resourceType: 'Patient',
                    timestamp: '2024-01-15',
                    sourceType: 'testSource',
                    eventType: 'C'
                });

                await producer.flushAsync();

                expect(mockKafkaClient.sendMessagesAsync).toHaveBeenCalledWith(
                    'test-topic',
                    expect.arrayContaining([
                        expect.objectContaining({
                            key: 'patient-1',
                            fhirVersion: 'R4'
                        })
                    ])
                );
                expect(producer.getFhirResourceMessageMap().size).toBe(0);
            } finally {
                delete process.env.ENABLE_EVENTS_KAFKA;
            }
        });

        test('should handle kafka send error gracefully', async () => {
            process.env.ENABLE_EVENTS_KAFKA = '1';
            try {
                mockKafkaClient.sendMessagesAsync.mockRejectedValue(
                    new Error('Kafka connection failed')
                );

                await producer.onResourceChangeAsync({
                    requestId: 'req-1',
                    id: 'patient-1',
                    resourceType: 'Patient',
                    timestamp: '2024-01-15',
                    sourceType: 'testSource',
                    eventType: 'C'
                });

                // flushAsync should not throw even when kafka fails
                await expect(producer.flushAsync()).resolves.not.toThrow();
            } finally {
                delete process.env.ENABLE_EVENTS_KAFKA;
            }
        });
    });
});
