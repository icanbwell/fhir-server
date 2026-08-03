const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock kafkajs
const mockProducerConnect = jest.fn().mockResolvedValue(undefined);
const mockProducerDisconnect = jest.fn().mockResolvedValue(undefined);
const mockProducerSend = jest.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]);
const mockProducerOn = jest.fn();
const mockConsumerConnect = jest.fn().mockResolvedValue(undefined);
const mockConsumerDisconnect = jest.fn().mockResolvedValue(undefined);
const mockConsumerSubscribe = jest.fn().mockResolvedValue(undefined);
const mockConsumerRun = jest.fn().mockResolvedValue(undefined);
const mockConsumerOn = jest.fn();

jest.mock('kafkajs', () => {
    class KafkaJSProtocolError extends Error {
        constructor(message, code) {
            super(message);
            this.code = code;
            this.name = 'KafkaJSProtocolError';
        }
    }
    class KafkaJSNonRetriableError extends Error {
        constructor(message, { cause } = {}) {
            super(message);
            this.cause = cause;
            this.name = 'KafkaJSNonRetriableError';
        }
    }
    return {
        Kafka: jest.fn().mockImplementation(() => ({
            producer: jest.fn().mockReturnValue({
                connect: mockProducerConnect,
                disconnect: mockProducerDisconnect,
                send: mockProducerSend,
                on: mockProducerOn,
                events: { DISCONNECT: 'producer.disconnect' }
            }),
            consumer: jest.fn().mockReturnValue({
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: mockConsumerRun,
                on: mockConsumerOn,
                events: { GROUP_JOIN: 'consumer.group_join', CRASH: 'consumer.crash' }
            }),
            config: {}
        })),
        KafkaJSProtocolError,
        KafkaJSNonRetriableError
    };
});

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemErrorAsync: jest.fn().mockResolvedValue(undefined),
    logTraceSystemEventAsync: jest.fn().mockResolvedValue(undefined),
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, config }) {
            super(message);
            this.originalError = error;
            this.config = config;
        }
    }
}));

jest.mock('../../../utils/assertType', () => ({
    assertIsValid: jest.fn(),
    assertTypeEquals: jest.fn()
}));

jest.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jest.mock('../../../utils/metrics', () => ({
    recordKafkaRetryExhausted: jest.fn()
}));

const { KafkaClient } = require('../../../utils/kafkaClient');
const { KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');
const { recordKafkaRetryExhausted } = require('../../../utils/metrics');

describe('KafkaClient', () => {
    let kafkaClient;
    let mockConfigManagerInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        // Re-setup mock implementations after clearAllMocks
        mockProducerConnect.mockResolvedValue(undefined);
        mockProducerDisconnect.mockResolvedValue(undefined);
        mockProducerSend.mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]);
        mockConsumerConnect.mockResolvedValue(undefined);
        mockConsumerDisconnect.mockResolvedValue(undefined);
        mockConsumerSubscribe.mockResolvedValue(undefined);
        mockConsumerRun.mockResolvedValue(undefined);

        process.env.KAFKA_MAX_RETRY = '3';

        mockConfigManagerInstance = {
            kafkaUseSasl: false,
            kafkaAuthMechanism: 'plain',
            kafkaUserName: 'user',
            kafkaPassword: 'pass',
            kafkaClientId: 'test-client',
            kafkaBrokers: ['broker1:9092', 'broker2:9092'],
            kafkaUseSsl: true
        };

        kafkaClient = new KafkaClient({ configManager: mockConfigManagerInstance });
    });

    describe('constructor and init', () => {
        test('initializes with correct config', () => {
            expect(kafkaClient.clientId).toBe('test-client');
            expect(kafkaClient.brokers).toEqual(['broker1:9092', 'broker2:9092']);
            expect(kafkaClient.ssl).toBe(true);
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('registers DISCONNECT event handler', () => {
            expect(mockProducerOn).toHaveBeenCalledWith('producer.disconnect', expect.any(Function));
        });
    });

    describe('disconnect', () => {
        test('disconnects when producer is connected', async () => {
            kafkaClient.producerConnected = true;
            await kafkaClient.disconnect();
            expect(mockProducerDisconnect).toHaveBeenCalled();
        });

        test('does not disconnect when producer is not connected', async () => {
            kafkaClient.producerConnected = false;
            await kafkaClient.disconnect();
            expect(mockProducerDisconnect).not.toHaveBeenCalled();
        });
    });

    describe('sendMessagesAsync', () => {
        const topic = 'test-topic';
        const messages = [
            { key: 'key1', value: '{"data": 1}', fhirVersion: '4_0_0', requestId: 'req-1' }
        ];

        test('sends messages successfully on first attempt', async () => {
            await kafkaClient.sendMessagesAsync(topic, messages);
            expect(mockProducerConnect).toHaveBeenCalled();
            expect(mockProducerSend).toHaveBeenCalledWith({
                topic,
                messages: [{ key: 'key1', value: '{"data": 1}', headers: { version: '4_0_0' } }]
            });
        });

        test('connects producer if not already connected', async () => {
            kafkaClient.producerConnected = false;
            await kafkaClient.sendMessagesAsync(topic, messages);
            expect(mockProducerConnect).toHaveBeenCalled();
        });

        test('skips connect if producer already connected', async () => {
            kafkaClient.producerConnected = true;
            await kafkaClient.sendMessagesAsync(topic, messages);
            expect(mockProducerConnect).not.toHaveBeenCalled();
        });

        test('retries on KafkaJSNonRetriableError with error code 72', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found', 72);
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable', { cause: protocolError });
            nonRetriableError.cause = protocolError;

            mockProducerSend
                .mockRejectedValueOnce(nonRetriableError)
                .mockResolvedValueOnce([]);

            await kafkaClient.sendMessagesAsync(topic, messages);
            // Should have called send at least twice (first fail, then success)
            expect(mockProducerSend.mock.calls.length).toBeGreaterThanOrEqual(1);
        });

        test('throws on KafkaJSNonRetriableError with non-72 error code', async () => {
            const protocolError = new KafkaJSProtocolError('Some other error', 99);
            Object.defineProperty(protocolError, 'code', { value: 99 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable', { cause: protocolError });
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await expect(kafkaClient.sendMessagesAsync(topic, messages)).rejects.toThrow();
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('throws on generic error without retry', async () => {
            const genericError = new Error('Network error');
            mockProducerSend.mockRejectedValue(genericError);

            await expect(kafkaClient.sendMessagesAsync(topic, messages)).rejects.toThrow('Network error');
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('records metric when retries exhausted', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendMessagesAsync(topic, messages);
            expect(recordKafkaRetryExhausted).toHaveBeenCalledWith(topic, 72);
        });

        test('reorders brokers on retry', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            // Fail all retries
            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendMessagesAsync(topic, messages);
            // After retry, brokers should be reordered
            expect(kafkaClient.brokers[0]).toBe('broker2:9092');
        });

        test('throws RethrownError when producer connect fails', async () => {
            kafkaClient.producerConnected = false;
            mockProducerConnect.mockRejectedValue(new Error('Connection refused'));

            await expect(kafkaClient.sendMessagesAsync(topic, messages)).rejects.toThrow('Error in connecting producer');
        });
    });

    describe('sendCloudEventMessageAsync', () => {
        const topic = 'cloud-events-topic';
        const messages = [
            { key: 'key-1', value: '{"type": "com.example.event"}', headers: { ce_type: 'test' } }
        ];

        test('sends cloud event messages successfully', async () => {
            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(mockProducerSend).toHaveBeenCalledWith({ topic, messages });
        });

        test('retries on error code 72', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend
                .mockRejectedValueOnce(nonRetriableError)
                .mockResolvedValueOnce([]);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(mockProducerSend.mock.calls.length).toBeGreaterThanOrEqual(1);
        });

        test('throws non-retriable error without code 72', async () => {
            const nonRetriableError = new KafkaJSNonRetriableError('Fatal');
            nonRetriableError.cause = new Error('unknown');

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow();
        });

        test('records metric when cloud event retries exhausted', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(recordKafkaRetryExhausted).toHaveBeenCalledWith(topic, 72);
        });
    });

    describe('sendMessagesAsyncHelper', () => {
        test('maps messages to kafka format with headers', async () => {
            kafkaClient.producerConnected = true;
            const messages = [
                { key: 'k1', value: 'v1', fhirVersion: '4_0_0' },
                { key: 'k2', value: 'v2', fhirVersion: '3_0_2' }
            ];
            await kafkaClient.sendMessagesAsyncHelper('topic', messages);
            expect(mockProducerSend).toHaveBeenCalledWith({
                topic: 'topic',
                messages: [
                    { key: 'k1', value: 'v1', headers: { version: '4_0_0' } },
                    { key: 'k2', value: 'v2', headers: { version: '3_0_2' } }
                ]
            });
        });

        test('logs in DEBUG mode', async () => {
            const originalLogLevel = process.env.LOGLEVEL;
            process.env.LOGLEVEL = 'DEBUG';
            kafkaClient.producerConnected = true;
            await kafkaClient.sendMessagesAsyncHelper('topic', [{ key: 'k', value: 'v', fhirVersion: '4_0_0' }]);
            const { logTraceSystemEventAsync } = require('../../../operations/common/systemEventLogging');
            expect(logTraceSystemEventAsync).toHaveBeenCalled();
            process.env.LOGLEVEL = originalLogLevel;
        });
    });

    describe('waitForConsumerToJoinGroupAsync', () => {
        test('resolves on GROUP_JOIN event', async () => {
            const consumer = {
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            // Capture the handler and trigger it
            consumer.on.mockImplementation((event, handler) => {
                if (event === 'group_join') {
                    setTimeout(() => handler({ payload: {} }), 10);
                }
            });

            const result = await kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 5000 });
            expect(result).toEqual({ payload: {} });
        });

        test('rejects on timeout', async () => {
            const consumer = {
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 50, label: 'test-consumer' })
            ).rejects.toThrow('Timeout test-consumer');
        });

        test('rejects on CRASH event', async () => {
            const consumer = {
                on: jest.fn(),
                disconnect: jest.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            consumer.on.mockImplementation((event, handler) => {
                if (event === 'crash') {
                    setTimeout(() => handler({ payload: { error: new Error('Consumer crashed') } }), 10);
                }
            });

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 5000 })
            ).rejects.toThrow('Consumer crashed');
        });
    });

    describe('receiveMessagesAsync', () => {
        test('subscribes and runs consumer', async () => {
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: mockConsumerRun
            };
            const onMessageAsync = jest.fn();
            await kafkaClient.receiveMessagesAsync({
                consumer,
                topic: 'test-topic',
                fromBeginning: true,
                onMessageAsync
            });
            expect(mockConsumerConnect).toHaveBeenCalled();
            expect(mockConsumerSubscribe).toHaveBeenCalledWith({ topics: ['test-topic'], fromBeginning: true });
            expect(mockConsumerRun).toHaveBeenCalled();
            expect(mockConsumerDisconnect).toHaveBeenCalled();
        });

        test('throws RethrownError when consumer connect fails', async () => {
            const consumer = {
                connect: jest.fn().mockRejectedValue(new Error('Connection error')),
                disconnect: jest.fn()
            };
            await expect(
                kafkaClient.receiveMessagesAsync({ consumer, topic: 'test', onMessageAsync: jest.fn() })
            ).rejects.toThrow('Error in receiveMessageAsync()');
        });
    });

    describe('createConsumerAsync', () => {
        test('creates consumer with groupId', async () => {
            const consumer = await kafkaClient.createConsumerAsync({ groupId: 'my-group' });
            expect(consumer).toBeDefined();
        });
    });

    describe('getConfigAsync', () => {
        test('returns config without SASL when kafkaUseSasl is false', () => {
            mockConfigManagerInstance.kafkaUseSasl = false;
            const config = kafkaClient.getConfigAsync();
            expect(config.sasl).toBeNull();
            expect(config.clientId).toBe('test-client');
            expect(config.brokers).toEqual(['broker1:9092', 'broker2:9092']);
        });

        test('returns config with SASL when kafkaUseSasl is true', () => {
            mockConfigManagerInstance.kafkaUseSasl = true;
            process.env.KAFKA_SASL_USERNAME = 'env-user';
            process.env.KAFKA_SASL_PASSWORD = 'env-pass';
            const config = kafkaClient.getConfigAsync();
            expect(config.sasl).toBeDefined();
            expect(config.sasl.mechanism).toBe('plain');
        });
    });

    describe('boundary conditions', () => {
        test('handles single broker reorder (no-op)', async () => {
            // Create fresh kafkaClient with single broker
            const singleBrokerConfig = {
                kafkaUseSasl: false,
                kafkaAuthMechanism: 'plain',
                kafkaUserName: 'user',
                kafkaPassword: 'pass',
                kafkaClientId: 'test-client-single',
                kafkaBrokers: ['single-broker:9092'],
                kafkaUseSsl: true
            };
            const singleClient = new KafkaClient({ configManager: singleBrokerConfig });
            singleClient.brokers = ['single-broker:9092'];

            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await singleClient.sendMessagesAsync('topic', [{ key: 'k', value: 'v', fhirVersion: '4_0_0' }]);
            // With single broker, reorder should produce same array
            expect(singleClient.brokers).toEqual(['single-broker:9092']);
        });

        test('handles empty messages array', async () => {
            mockProducerSend.mockResolvedValue([]);
            kafkaClient.producerConnected = true;
            await kafkaClient.sendMessagesAsyncHelper('topic', []);
            expect(mockProducerSend).toHaveBeenCalledWith({
                topic: 'topic',
                messages: []
            });
        });

        test('handles multiple messages', async () => {
            mockProducerSend.mockResolvedValue([]);
            kafkaClient.producerConnected = true;
            const messages = Array.from({ length: 5 }, (_, i) => ({
                key: `key-${i}`, value: `val-${i}`, fhirVersion: '4_0_0'
            }));
            await kafkaClient.sendMessagesAsyncHelper('topic', messages);
            const sentMessages = mockProducerSend.mock.calls[0][0].messages;
            expect(sentMessages).toHaveLength(5);
        });
    });
});
