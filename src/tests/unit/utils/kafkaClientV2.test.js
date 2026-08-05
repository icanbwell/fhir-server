/**
 * Unit tests for KafkaClientV2
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock kafkajs
const mockProducerConnect = jestObj.fn().mockResolvedValue(undefined);
const mockProducerDisconnect = jestObj.fn().mockResolvedValue(undefined);
const mockProducerSend = jestObj.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]);
const mockProducerOn = jestObj.fn();
const mockConsumerConnect = jestObj.fn().mockResolvedValue(undefined);
const mockConsumerDisconnect = jestObj.fn().mockResolvedValue(undefined);
const mockConsumerSubscribe = jestObj.fn().mockResolvedValue(undefined);
const mockConsumerRun = jestObj.fn().mockResolvedValue(undefined);
const mockConsumerOn = jestObj.fn();
const mockAdminClient = { connect: jestObj.fn(), disconnect: jestObj.fn() };

jestObj.mock('kafkajs', () => {
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
        Kafka: jestObj.fn().mockImplementation(() => ({
            producer: jestObj.fn().mockReturnValue({
                connect: mockProducerConnect,
                disconnect: mockProducerDisconnect,
                send: mockProducerSend,
                on: mockProducerOn,
                events: { DISCONNECT: 'producer.disconnect' }
            }),
            consumer: jestObj.fn().mockReturnValue({
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: mockConsumerRun,
                on: mockConsumerOn,
                events: { GROUP_JOIN: 'consumer.group_join', CRASH: 'consumer.crash' }
            }),
            admin: jestObj.fn().mockReturnValue(mockAdminClient),
            config: { clientId: 'test-client' }
        })),
        KafkaJSProtocolError,
        KafkaJSNonRetriableError
    };
});

jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemErrorAsync: jestObj.fn().mockResolvedValue(undefined),
    logTraceSystemEventAsync: jestObj.fn().mockResolvedValue(undefined),
    logSystemEventAsync: jestObj.fn().mockResolvedValue(undefined)
}));

jestObj.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, config }) {
            super(message);
            this.originalError = error;
            this.config = config;
        }
    }
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn(),
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../utils/metrics', () => ({
    recordKafkaRetryExhausted: jestObj.fn()
}));

const { KafkaClientV2 } = require('../../../utils/kafkaClientV2');
const { KafkaJSProtocolError, KafkaJSNonRetriableError } = require('kafkajs');
const { recordKafkaRetryExhausted } = require('../../../utils/metrics');
const { logTraceSystemEventAsync, logSystemErrorAsync, logSystemEventAsync } = require('../../../operations/common/systemEventLogging');

describe('KafkaClientV2', () => {
    let kafkaClient;
    let mockConfigManagerInstance;
    let originalEnv;

    beforeEach(() => {
        jestObj.clearAllMocks();
        originalEnv = { ...process.env };

        mockProducerConnect.mockResolvedValue(undefined);
        mockProducerDisconnect.mockResolvedValue(undefined);
        mockProducerSend.mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]);
        mockConsumerConnect.mockResolvedValue(undefined);
        mockConsumerDisconnect.mockResolvedValue(undefined);
        mockConsumerSubscribe.mockResolvedValue(undefined);
        mockConsumerRun.mockResolvedValue(undefined);

        process.env.KAFKA_MAX_RETRY = '3';

        mockConfigManagerInstance = {
            kafkaV2AuthType: 'plain',
            kafkaV2UseSasl: false,
            kafkaV2AuthMechanism: 'plain',
            kafkaV2UserName: 'user',
            kafkaV2Password: 'pass',
            kafkaV2ClientId: 'test-client-v2',
            kafkaV2Brokers: ['broker1:9092', 'broker2:9092'],
            kafkaV2UseSsl: true,
            kafkaV2AwsRegion: 'us-east-1'
        };

        kafkaClient = new KafkaClientV2({ configManager: mockConfigManagerInstance });
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor and init', () => {
        test('initializes with correct config from configManager', () => {
            expect(kafkaClient.clientId).toBe('test-client-v2');
            expect(kafkaClient.brokers).toEqual(['broker1:9092', 'broker2:9092']);
            expect(kafkaClient.ssl).toBe(true);
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('registers DISCONNECT event handler that sets producerConnected to false', () => {
            expect(mockProducerOn).toHaveBeenCalledWith('producer.disconnect', expect.any(Function));

            // Simulate disconnect event
            const disconnectHandler = mockProducerOn.mock.calls[0][1];
            kafkaClient.producerConnected = true;
            disconnectHandler();
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('stores configManager reference', () => {
            expect(kafkaClient.configManager).toBe(mockConfigManagerInstance);
        });
    });

    describe('getConfigAsync', () => {
        test('returns config without SASL when authType is not iam and useSasl is false', () => {
            mockConfigManagerInstance.kafkaV2AuthType = 'plain';
            mockConfigManagerInstance.kafkaV2UseSasl = false;
            const config = kafkaClient.getConfigAsync();
            expect(config.sasl).toBeNull();
            expect(config.clientId).toBe('test-client-v2');
            expect(config.brokers).toEqual(['broker1:9092', 'broker2:9092']);
            expect(config.ssl).toBe(true);
        });

        test('returns config with SASL when kafkaV2UseSasl is true', () => {
            mockConfigManagerInstance.kafkaV2AuthType = 'plain';
            mockConfigManagerInstance.kafkaV2UseSasl = true;
            mockConfigManagerInstance.kafkaV2AuthMechanism = 'scram-sha-256';
            mockConfigManagerInstance.kafkaV2UserName = 'myuser';
            mockConfigManagerInstance.kafkaV2Password = 'mypass';
            const config = kafkaClient.getConfigAsync();
            expect(config.sasl).toEqual({
                mechanism: 'scram-sha-256',
                username: 'myuser',
                password: 'mypass'
            });
        });

        test('returns IAM SASL config when authType is iam', () => {
            mockConfigManagerInstance.kafkaV2AuthType = 'iam';
            const config = kafkaClient.getConfigAsync();
            expect(config.sasl).toBeDefined();
            expect(config.sasl.mechanism).toBe('oauthbearer');
            expect(config.sasl.oauthBearerProvider).toBeInstanceOf(Function);
            expect(config.ssl).toBe(true); // ssl forced to true for iam
        });

        test('forces ssl to true when authType is iam even if kafkaV2UseSsl is false', () => {
            mockConfigManagerInstance.kafkaV2AuthType = 'iam';
            mockConfigManagerInstance.kafkaV2UseSsl = false;
            const config = kafkaClient.getConfigAsync();
            expect(config.ssl).toBe(true);
        });

        test('returns null username/password when not provided with SASL', () => {
            mockConfigManagerInstance.kafkaV2AuthType = 'plain';
            mockConfigManagerInstance.kafkaV2UseSasl = true;
            mockConfigManagerInstance.kafkaV2UserName = '';
            mockConfigManagerInstance.kafkaV2Password = '';
            const config = kafkaClient.getConfigAsync();
            expect(config.sasl.username).toBeNull();
            expect(config.sasl.password).toBeNull();
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

    describe('sendCloudEventMessageAsync', () => {
        const topic = 'cloud-events-topic';
        const messages = [{ key: 'key1', value: '{"type":"test"}' }];

        test('sends messages successfully on first attempt', async () => {
            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(mockProducerConnect).toHaveBeenCalled();
            expect(mockProducerSend).toHaveBeenCalledWith({ topic, messages });
        });

        test('retries on KafkaJSNonRetriableError with error code 72', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found', 72);
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable', { cause: protocolError });
            nonRetriableError.cause = protocolError;

            mockProducerSend
                .mockRejectedValueOnce(nonRetriableError)
                .mockResolvedValueOnce([]);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            // Should have called send at least twice (first fail, then retry success)
            expect(mockProducerSend.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        test('throws on KafkaJSNonRetriableError with non-72 error code', async () => {
            const protocolError = new KafkaJSProtocolError('Some other error', 99);
            Object.defineProperty(protocolError, 'code', { value: 99 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable', { cause: protocolError });
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow();
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('throws on generic error without retry', async () => {
            const genericError = new Error('Network error');
            mockProducerSend.mockRejectedValue(genericError);

            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow('Network error');
            expect(kafkaClient.producerConnected).toBe(false);
        });

        test('records metric when retries exhausted', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(recordKafkaRetryExhausted).toHaveBeenCalledWith(topic, 72);
        });

        test('reorders brokers on retry', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            // After retry, brokers should be reordered
            expect(kafkaClient.brokers[0]).toBe('broker2:9092');
        });

        test('uses KAFKA_MAX_RETRY env var for max retries', async () => {
            process.env.KAFKA_MAX_RETRY = '1';
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            // With maxRetries=1, should only try once (iteration starts at 1, loop ends at 1)
            expect(mockProducerSend).toHaveBeenCalledTimes(1);
            expect(recordKafkaRetryExhausted).toHaveBeenCalledWith(topic, 72);
        });

        test('defaults to 3 retries when KAFKA_MAX_RETRY is not set', async () => {
            delete process.env.KAFKA_MAX_RETRY;
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(mockProducerSend).toHaveBeenCalledTimes(3);
        });

        test('logs system event on retry', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend
                .mockRejectedValueOnce(nonRetriableError)
                .mockResolvedValueOnce([]);

            await kafkaClient.sendCloudEventMessageAsync({ topic, messages });
            expect(logSystemEventAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'kafkaClientV2Retry',
                    message: 'Retrying sending the CloudEvent message by creating new client'
                })
            );
        });
    });

    describe('sendCloudEventMessageHelperAsync', () => {
        const topic = 'test-topic';
        const messages = [{ key: 'key1', value: '{"data": 1}' }];

        test('connects producer if not already connected', async () => {
            kafkaClient.producerConnected = false;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages });
            expect(mockProducerConnect).toHaveBeenCalled();
            expect(kafkaClient.producerConnected).toBe(true);
        });

        test('skips connect if producer already connected', async () => {
            kafkaClient.producerConnected = true;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages });
            expect(mockProducerConnect).not.toHaveBeenCalled();
        });

        test('sends messages via producer.send', async () => {
            kafkaClient.producerConnected = true;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages });
            expect(mockProducerSend).toHaveBeenCalledWith({ topic, messages });
        });

        test('throws RethrownError when producer connect fails', async () => {
            kafkaClient.producerConnected = false;
            mockProducerConnect.mockRejectedValue(new Error('Connection refused'));

            await expect(
                kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages })
            ).rejects.toThrow('Error in connecting producer to kafka v2');
        });

        test('logs trace events in DEBUG mode', async () => {
            process.env.LOGLEVEL = 'DEBUG';
            kafkaClient.producerConnected = true;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages });
            expect(logTraceSystemEventAsync).toHaveBeenCalledTimes(2);
            expect(logTraceSystemEventAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'kafkaClientV2',
                    message: 'Sending CloudEvent messages'
                })
            );
            expect(logTraceSystemEventAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'kafkaClientV2',
                    message: 'Sent CloudEvent messages'
                })
            );
        });

        test('does not log trace events when not in DEBUG mode', async () => {
            process.env.LOGLEVEL = 'INFO';
            kafkaClient.producerConnected = true;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages });
            expect(logTraceSystemEventAsync).not.toHaveBeenCalled();
        });

        test('logs error and rethrows when producer.send fails', async () => {
            kafkaClient.producerConnected = true;
            const sendError = new Error('Send failed');
            mockProducerSend.mockRejectedValue(sendError);

            await expect(
                kafkaClient.sendCloudEventMessageHelperAsync({ topic, messages })
            ).rejects.toThrow('Send failed');
            expect(logSystemErrorAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: 'kafkaClientV2',
                    message: 'Error sending CloudEvent messages',
                    error: sendError
                })
            );
        });
    });

    describe('waitForConsumerToJoinGroupAsync', () => {
        test('resolves on GROUP_JOIN event', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            consumer.on.mockImplementation((event, handler) => {
                if (event === 'group_join') {
                    setTimeout(() => handler({ payload: { memberId: '123' } }), 10);
                }
            });

            const result = await kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 5000 });
            expect(result).toEqual({ payload: { memberId: '123' } });
        });

        test('rejects on timeout with label', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 50, label: 'test-consumer' })
            ).rejects.toThrow('Timeout test-consumer');
        });

        test('rejects on timeout without label', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 50 })
            ).rejects.toThrow('Timeout');
        });

        test('rejects on CRASH event', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
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

        test('disconnects consumer on timeout', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 50 })
            ).rejects.toThrow();
            expect(consumer.disconnect).toHaveBeenCalled();
        });

        test('disconnects consumer on CRASH', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            consumer.on.mockImplementation((event, handler) => {
                if (event === 'crash') {
                    setTimeout(() => handler({ payload: { error: new Error('Crash') } }), 10);
                }
            });

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 5000 })
            ).rejects.toThrow();
            expect(consumer.disconnect).toHaveBeenCalled();
        });

        test('logs the crash error via logSystemErrorAsync', async () => {
            const { logSystemErrorAsync } = require('../../../operations/common/systemEventLogging');
            logSystemErrorAsync.mockClear();

            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            const crashError = new Error('Consumer crashed');
            consumer.on.mockImplementation((event, handler) => {
                if (event === 'crash') {
                    setTimeout(() => handler({ payload: { error: crashError } }), 10);
                }
            });

            await expect(
                kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 5000, label: 'test-consumer' })
            ).rejects.toThrow('Consumer crashed');

            expect(logSystemErrorAsync).toHaveBeenCalledWith(
                expect.objectContaining({ error: crashError, message: expect.stringContaining('test-consumer') })
            );
        });

        test('logs but does not disconnect on a crash after the consumer already joined', async () => {
            const { logSystemErrorAsync } = require('../../../operations/common/systemEventLogging');
            logSystemErrorAsync.mockClear();

            const handlers = {};
            const consumer = {
                on: jestObj.fn((event, handler) => {
                    handlers[event] = handler;
                }),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            const joinPromise = kafkaClient.waitForConsumerToJoinGroupAsync(consumer, { maxWait: 5000 });

            // Consumer joins successfully — the promise settles here.
            handlers.group_join({ payload: {} });
            await joinPromise;
            expect(consumer.disconnect).not.toHaveBeenCalled();

            // A later crash (e.g. one kafkajs is already self-healing via restart: true) must
            // still be logged, but must NOT trigger a disconnect — that's the entrypoint's call
            // now, and disconnecting here could race with kafkajs's own in-process restart.
            const laterCrashError = new Error('Later crash after join');
            await handlers.crash({ payload: { error: laterCrashError, restart: true } });

            expect(logSystemErrorAsync).toHaveBeenCalledWith(
                expect.objectContaining({ error: laterCrashError })
            );
            expect(consumer.disconnect).not.toHaveBeenCalled();
        });

        test('uses default maxWait of 10000', async () => {
            const consumer = {
                on: jestObj.fn(),
                disconnect: jestObj.fn().mockResolvedValue(undefined),
                events: { GROUP_JOIN: 'group_join', CRASH: 'crash' }
            };

            // Resolve immediately to avoid waiting 10 seconds
            consumer.on.mockImplementation((event, handler) => {
                if (event === 'group_join') {
                    setTimeout(() => handler({ payload: {} }), 5);
                }
            });

            const result = await kafkaClient.waitForConsumerToJoinGroupAsync(consumer);
            expect(result).toEqual({ payload: {} });
        });
    });

    describe('receiveMessagesAsync', () => {
        test('subscribes and runs consumer with eachMessage handler', async () => {
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: mockConsumerRun
            };
            const onMessageAsync = jestObj.fn();
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

        test('fromBeginning defaults to false', async () => {
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: mockConsumerRun
            };
            await kafkaClient.receiveMessagesAsync({
                consumer,
                topic: 'test-topic',
                onMessageAsync: jestObj.fn()
            });
            expect(mockConsumerSubscribe).toHaveBeenCalledWith({ topics: ['test-topic'], fromBeginning: false });
        });

        test('throws RethrownError when consumer connect fails', async () => {
            const consumer = {
                connect: jestObj.fn().mockRejectedValue(new Error('Connection error')),
                disconnect: jestObj.fn()
            };
            await expect(
                kafkaClient.receiveMessagesAsync({ consumer, topic: 'test', onMessageAsync: jestObj.fn() })
            ).rejects.toThrow('Error in receiveMessageAsync() v2');
        });

        test('eachMessage handler transforms message correctly', async () => {
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: jestObj.fn().mockImplementation(async ({ eachMessage }) => {
                    await eachMessage({
                        topic: 'test-topic',
                        partition: 0,
                        message: {
                            key: Buffer.from('msg-key'),
                            value: Buffer.from('msg-value'),
                            headers: {
                                ce_type: Buffer.from('com.example.event'),
                                ce_source: Buffer.from('/source')
                            }
                        },
                        heartbeat: jestObj.fn(),
                        pause: jestObj.fn()
                    });
                })
            };
            const onMessageAsync = jestObj.fn();
            await kafkaClient.receiveMessagesAsync({
                consumer,
                topic: 'test-topic',
                onMessageAsync
            });
            expect(onMessageAsync).toHaveBeenCalledWith({
                key: 'msg-key',
                value: 'msg-value',
                headers: [
                    { key: 'ce_type', value: 'com.example.event' },
                    { key: 'ce_source', value: '/source' }
                ]
            });
        });

        test('handles null header values', async () => {
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: jestObj.fn().mockImplementation(async ({ eachMessage }) => {
                    await eachMessage({
                        topic: 'test-topic',
                        partition: 0,
                        message: {
                            key: Buffer.from('key'),
                            value: Buffer.from('val'),
                            headers: { empty_header: null }
                        },
                        heartbeat: jestObj.fn(),
                        pause: jestObj.fn()
                    });
                })
            };
            const onMessageAsync = jestObj.fn();
            await kafkaClient.receiveMessagesAsync({
                consumer,
                topic: 'test-topic',
                onMessageAsync
            });
            expect(onMessageAsync).toHaveBeenCalledWith({
                key: 'key',
                value: 'val',
                headers: [{ key: 'empty_header', value: '' }]
            });
        });

        test('logs error and rethrows when consumer.run fails', async () => {
            const runError = new Error('Run failed');
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: jestObj.fn().mockRejectedValue(runError)
            };
            await expect(
                kafkaClient.receiveMessagesAsync({ consumer, topic: 'test', onMessageAsync: jestObj.fn() })
            ).rejects.toThrow('Run failed');
            expect(logSystemErrorAsync).toHaveBeenCalled();
            // Should still disconnect in finally block
            expect(mockConsumerDisconnect).toHaveBeenCalled();
        });

        test('disconnects consumer in finally block even after error', async () => {
            const consumer = {
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: jestObj.fn().mockRejectedValue(new Error('Subscribe failed')),
                run: mockConsumerRun
            };
            await expect(
                kafkaClient.receiveMessagesAsync({ consumer, topic: 'test', onMessageAsync: jestObj.fn() })
            ).rejects.toThrow('Subscribe failed');
            expect(mockConsumerDisconnect).toHaveBeenCalled();
        });
    });

    describe('removeConsumerAsync', () => {
        test('disconnects the consumer', async () => {
            const consumer = { disconnect: jestObj.fn().mockResolvedValue(undefined) };
            await kafkaClient.removeConsumerAsync({ consumer });
            expect(consumer.disconnect).toHaveBeenCalled();
        });
    });

    describe('createConsumerAsync', () => {
        test('creates consumer with groupId', async () => {
            const consumer = await kafkaClient.createConsumerAsync({ groupId: 'my-group' });
            expect(consumer).toBeDefined();
            expect(consumer.connect).toBeDefined();
        });
    });

    describe('createAdminClient', () => {
        test('creates admin client from kafka client', () => {
            const admin = kafkaClient.createAdminClient();
            expect(admin).toBe(mockAdminClient);
        });
    });

    describe('boundary conditions', () => {
        test('handles single broker reorder (returns same broker)', async () => {
            const singleBrokerConfig = {
                kafkaV2AuthType: 'plain',
                kafkaV2UseSasl: false,
                kafkaV2AuthMechanism: 'plain',
                kafkaV2UserName: 'user',
                kafkaV2Password: 'pass',
                kafkaV2ClientId: 'test-client-single',
                kafkaV2Brokers: ['single-broker:9092'],
                kafkaV2UseSsl: true,
                kafkaV2AwsRegion: 'us-east-1'
            };
            const singleClient = new KafkaClientV2({ configManager: singleBrokerConfig });

            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await singleClient.sendCloudEventMessageAsync({ topic: 'topic', messages: [] });
            expect(singleClient.brokers).toEqual(['single-broker:9092']);
        });

        test('handles empty messages array', async () => {
            kafkaClient.producerConnected = true;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic: 'topic', messages: [] });
            expect(mockProducerSend).toHaveBeenCalledWith({ topic: 'topic', messages: [] });
        });
    });
});
