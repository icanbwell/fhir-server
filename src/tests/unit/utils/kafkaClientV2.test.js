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
        KafkaJSNonRetriableError,
        CompressionTypes: jestObj.requireActual('kafkajs').CompressionTypes,
        CompressionCodecs: jestObj.requireActual('kafkajs').CompressionCodecs
    };
});

jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logSystemErrorAsync: jestObj.fn().mockResolvedValue(undefined),
    logTraceSystemEventAsync: jestObj.fn().mockResolvedValue(undefined),
    logSystemEventAsync: jestObj.fn().mockResolvedValue(undefined)
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn(),
    logWarn: jestObj.fn()
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
const { trace, context: otelContext, propagation } = require('@opentelemetry/api');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');

// The global propagator defaults to a no-op unless the real OTel SDK is initialized (which this
// bare test process never does) -- register the real W3C propagator so the trace-context
// tests below actually exercise header parsing instead of silently no-op-ing.
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
const { recordKafkaRetryExhausted } = require('../../../utils/metrics');
const { logTraceSystemEventAsync, logSystemErrorAsync, logSystemEventAsync } = require('../../../operations/common/systemEventLogging');
const { logError, logWarn } = require('../../../operations/common/logging');

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
            kafkaV2AwsRegion: 'us-east-1',
            kafkaConsumerSessionTimeoutMs: 31000,
            kafkaConsumerHeartbeatIntervalMs: 3000,
            kafkaConsumerRebalanceTimeoutMs: 301000,
            kafkaConsumerMaxProcessingTimeMs: 60000
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
            // Headers is always added (even if empty, absent an active trace context in
            // this test env) -- see the trace-context injection in sendCloudEventMessageHelperAsync.
            expect(mockProducerSend).toHaveBeenCalledWith({
                topic,
                messages: messages.map((m) => ({ ...m, headers: {} }))
            });
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

        test('records metric and throws when retries exhausted', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            // Must reject rather than resolve -- a caller relying on "resolves means it was
            // actually sent" (e.g. sendToDeadLetterTopicAsync) would otherwise treat exhausted
            // retries as success and lose the message.
            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow();
            expect(recordKafkaRetryExhausted).toHaveBeenCalledWith(topic, 72);
        });

        test('reorders brokers on retry', async () => {
            const protocolError = new KafkaJSProtocolError('Listener not found');
            Object.defineProperty(protocolError, 'code', { value: 72 });
            const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
            nonRetriableError.cause = protocolError;

            mockProducerSend.mockRejectedValue(nonRetriableError);

            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow();
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

            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow();
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

            await expect(kafkaClient.sendCloudEventMessageAsync({ topic, messages })).rejects.toThrow();
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
            // Headers is always added (even if empty, absent an active trace context in
            // this test env) -- see the trace-context injection above producer.send's call.
            expect(mockProducerSend).toHaveBeenCalledWith({
                topic,
                messages: messages.map((m) => ({ ...m, headers: {} }))
            });
        });

        test('passes the compression type through to producer.send', async () => {
            kafkaClient.producerConnected = true;
            const { CompressionTypes } = jestObj.requireActual('kafkajs');
            await kafkaClient.sendCloudEventMessageHelperAsync({
                topic,
                messages,
                compression: CompressionTypes.ZSTD
            });
            expect(mockProducerSend).toHaveBeenCalledWith(
                expect.objectContaining({ compression: CompressionTypes.ZSTD })
            );
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
            // A pre-join crash is this listener's own responsibility -- no entrypoint-level
            // CRASH listener exists yet to log it, so this is the only logError call site for it.
            expect(logError).toHaveBeenCalled();
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
            // logError is deliberately NOT called here -- once the join has settled, the
            // entrypoint's own post-join CRASH listener is the one responsible for logError
            // (with job-specific context), so this listener logging it too would just be a
            // second, differently-worded write for the same crash.
            expect(logError).not.toHaveBeenCalled();
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
        test('subscribes and runs consumer with eachMessage handler, and does not disconnect a successfully-started long-running consumer', async () => {
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
            // consumer.run() resolves as soon as the background fetch loop starts, not when
            // consumption "finishes" -- disconnecting here would tear down a healthy,
            // just-started consumer moments after it starts (the actual production bug).
            expect(mockConsumerDisconnect).not.toHaveBeenCalled();
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

        // These two tests verify the context VALUE passed to context.with() directly (via a spy)
        // rather than reading context.active() from inside onMessageAsync -- @opentelemetry/api's
        // context propagation across async boundaries only works once a real ContextManager is
        // registered (e.g. AsyncHooksContextManager, which the real OTel SDK registers on startup
        // via @opentelemetry/context-async-hooks). That's not initialized in this bare test
        // process, so context.with()/.active() alone can't be used to observe propagation here --
        // but trace.setSpanContext/getSpan are pure reads/writes on a given Context value and
        // don't need a ContextManager, so asserting on the value itself is both simpler and
        // independent of whether a ContextManager happens to be registered.
        test('Extracts trace context from headers into the active context when nothing is already active', async () => {
            const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
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
                            headers: { traceparent: Buffer.from(traceparent) }
                        },
                        heartbeat: jestObj.fn(),
                        pause: jestObj.fn()
                    });
                })
            };
            const withSpy = jestObj.spyOn(otelContext, 'with');
            await kafkaClient.receiveMessagesAsync({ consumer, topic: 'test-topic', onMessageAsync: jestObj.fn() });

            expect(trace.getSpanContext(withSpy.mock.calls[0][0])).toMatchObject({
                traceId: '11111111111111111111111111111111',
                spanId: '2222222222222222'
            });
            withSpy.mockRestore();
        });

        test('Does not override an already-active span (e.g. from auto-instrumentation) with one extracted from headers', async () => {
            // Simulates @opentelemetry/instrumentation-kafkajs already having extracted from these
            // same raw headers and activated its own consumer span before eachMessage runs.
            const activeSpanContext = {
                traceId: '33333333333333333333333333333333',
                spanId: '4444444444444444',
                traceFlags: 1
            };
            const activeContext = trace.setSpanContext(otelContext.active(), activeSpanContext);
            const activeSpy = jestObj.spyOn(otelContext, 'active').mockReturnValue(activeContext);

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
                            // Original producer's traceparent -- must NOT win over the already-active span.
                            headers: { traceparent: Buffer.from('00-11111111111111111111111111111111-2222222222222222-01') }
                        },
                        heartbeat: jestObj.fn(),
                        pause: jestObj.fn()
                    });
                })
            };
            const withSpy = jestObj.spyOn(otelContext, 'with');
            await kafkaClient.receiveMessagesAsync({ consumer, topic: 'test-topic', onMessageAsync: jestObj.fn() });

            expect(trace.getSpanContext(withSpy.mock.calls[0][0])).toMatchObject(activeSpanContext);
            withSpy.mockRestore();
            activeSpy.mockRestore();
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
            // Should still disconnect after a failed subscribe/run -- that's a genuine setup
            // failure, unlike a successful run() resolving.
            expect(mockConsumerDisconnect).toHaveBeenCalled();
        });

        test('disconnects consumer after a subscribe/run setup error', async () => {
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

        describe('retry and dead-letter behavior', () => {
            let mockHeartbeat;

            beforeEach(() => {
                mockHeartbeat = jestObj.fn().mockResolvedValue(undefined);
            });

            const makeConsumer = (message = {
                key: Buffer.from('msg-key'),
                value: Buffer.from('msg-value'),
                headers: {}
            }) => ({
                connect: mockConsumerConnect,
                disconnect: mockConsumerDisconnect,
                subscribe: mockConsumerSubscribe,
                run: jestObj.fn().mockImplementation(async ({ eachMessage }) => {
                    await eachMessage({ topic: 'test-topic', partition: 0, message, heartbeat: mockHeartbeat, pause: jestObj.fn() });
                })
            });

            test('without deadLetterTopic, a failure propagates with no retry (unchanged behavior)', async () => {
                const onMessageAsync = jestObj.fn().mockRejectedValue(new Error('boom'));
                await expect(
                    kafkaClient.receiveMessagesAsync({ consumer: makeConsumer(), topic: 'test-topic', onMessageAsync })
                ).rejects.toThrow('boom');
                expect(onMessageAsync).toHaveBeenCalledTimes(1);
                expect(mockProducerSend).not.toHaveBeenCalled();
            });

            test('with deadLetterTopic, succeeds on first attempt with no retry and no DLT publish', async () => {
                const onMessageAsync = jestObj.fn().mockResolvedValue(undefined);
                await kafkaClient.receiveMessagesAsync({
                    consumer: makeConsumer(),
                    topic: 'test-topic',
                    onMessageAsync,
                    deadLetterTopic: 'test-topic.dlt'
                });
                expect(onMessageAsync).toHaveBeenCalledTimes(1);
                expect(mockProducerSend).not.toHaveBeenCalled();
            });

            test('retries up to maxRetries and succeeds without publishing to the DLT', async () => {
                const onMessageAsync = jestObj.fn()
                    .mockRejectedValueOnce(new Error('transient'))
                    .mockRejectedValueOnce(new Error('transient'))
                    .mockResolvedValueOnce(undefined);
                await kafkaClient.receiveMessagesAsync({
                    consumer: makeConsumer(),
                    topic: 'test-topic',
                    onMessageAsync,
                    deadLetterTopic: 'test-topic.dlt',
                    maxRetries: 3,
                    retryInitialDelayMs: 1
                });
                expect(onMessageAsync).toHaveBeenCalledTimes(3);
                expect(mockProducerSend).not.toHaveBeenCalled();
            });

            test('calls heartbeat before every attempt, not just during the backoff delay', async () => {
                const onMessageAsync = jestObj.fn()
                    .mockRejectedValueOnce(new Error('transient'))
                    .mockResolvedValueOnce(undefined);
                await kafkaClient.receiveMessagesAsync({
                    consumer: makeConsumer(),
                    topic: 'test-topic',
                    onMessageAsync,
                    deadLetterTopic: 'test-topic.dlt',
                    retryInitialDelayMs: 1
                });
                // One heartbeat per attempt (initial + 1 retry) so a slow handler doesn't
                // silently drift the consumer toward its session timeout across retries.
                expect(mockHeartbeat).toHaveBeenCalledTimes(2);
            });

            test('rejects (does not silently commit) when the dead-letter publish itself exhausts its own retries', async () => {
                // Regression test: sendCloudEventMessageAsync has a code-72 retry path that
                // used to resolve normally once its own retries were exhausted, instead of
                // throwing -- if that happened during a DLT publish, the message would be lost
                // silently with no error and no record anywhere. It must reject instead.
                const onMessageAsync = jestObj.fn().mockRejectedValue(new Error('poison message'));
                const protocolError = new KafkaJSProtocolError('Listener not found');
                Object.defineProperty(protocolError, 'code', { value: 72 });
                const nonRetriableError = new KafkaJSNonRetriableError('Non retriable');
                nonRetriableError.cause = protocolError;
                mockProducerSend.mockRejectedValue(nonRetriableError);

                await expect(
                    kafkaClient.receiveMessagesAsync({
                        consumer: makeConsumer(),
                        topic: 'test-topic',
                        onMessageAsync,
                        deadLetterTopic: 'test-topic.dlt',
                        maxRetries: 1,
                        retryInitialDelayMs: 1
                    })
                ).rejects.toThrow();
            });

            test('publishes to the dead-letter topic and does not throw once retries are exhausted', async () => {
                const persistentError = new Error('poison message');
                const onMessageAsync = jestObj.fn().mockRejectedValue(persistentError);

                await expect(
                    kafkaClient.receiveMessagesAsync({
                        consumer: makeConsumer({
                            key: Buffer.from('poison-key'),
                            value: Buffer.from('poison-value'),
                            headers: {}
                        }),
                        topic: 'test-topic',
                        onMessageAsync,
                        deadLetterTopic: 'test-topic.dlt',
                        maxRetries: 2,
                        retryInitialDelayMs: 1
                    })
                ).resolves.toBeUndefined();

                // Initial attempt + 2 retries = 3 calls total.
                expect(onMessageAsync).toHaveBeenCalledTimes(3);
                expect(mockProducerSend).toHaveBeenCalledWith(expect.objectContaining({
                    topic: 'test-topic.dlt',
                    messages: [expect.objectContaining({ key: 'poison-key' })]
                }));
                const dltPayload = JSON.parse(mockProducerSend.mock.calls[0][0].messages[0].value);
                expect(dltPayload.originalValue).toBe('poison-value');
                expect(dltPayload.error.message).toBe('poison message');
            });

            test('rethrows (offset must not commit) when the dead-letter publish itself fails', async () => {
                const onMessageAsync = jestObj.fn().mockRejectedValue(new Error('poison message'));
                mockProducerSend.mockRejectedValueOnce(new Error('broker unavailable'));

                await expect(
                    kafkaClient.receiveMessagesAsync({
                        consumer: makeConsumer(),
                        topic: 'test-topic',
                        onMessageAsync,
                        deadLetterTopic: 'test-topic.dlt',
                        maxRetries: 1,
                        retryInitialDelayMs: 1
                    })
                ).rejects.toThrow('broker unavailable');
            });

            describe.each(['REBALANCE_IN_PROGRESS', 'ILLEGAL_GENERATION', 'NOT_COORDINATOR_FOR_GROUP', 'UNKNOWN_MEMBER_ID'])(
                'group-membership error %s from heartbeat',
                (type) => {
                    const makeGroupError = () => Object.assign(new Error('The group is rebalancing'), { type });

                    test('is rethrown without retrying or dead-lettering so the offset is not committed', async () => {
                        // Regression: a heartbeat that fails because the group is rebalancing says nothing
                        // about the message. Dead-lettering it committed the offset and silently dropped a
                        // bulk-import range, leaving its Task in-progress forever.
                        const groupError = makeGroupError();
                        mockHeartbeat.mockRejectedValue(groupError);
                        const onMessageAsync = jestObj.fn().mockResolvedValue(undefined);

                        await expect(
                            kafkaClient.receiveMessagesAsync({
                                consumer: makeConsumer(),
                                topic: 'test-topic',
                                onMessageAsync,
                                deadLetterTopic: 'test-topic.dlt',
                                maxRetries: 3,
                                retryInitialDelayMs: 1
                            })
                        ).rejects.toBe(groupError);

                        expect(mockHeartbeat).toHaveBeenCalledTimes(1);
                        expect(onMessageAsync).not.toHaveBeenCalled();
                        expect(mockProducerSend).not.toHaveBeenCalled();
                    });
                }
            );

            test('still retries a heartbeat failure that is not a group-membership error', async () => {
                mockHeartbeat
                    .mockRejectedValueOnce(new Error('network blip'))
                    .mockResolvedValue(undefined);
                const onMessageAsync = jestObj.fn().mockResolvedValue(undefined);

                await kafkaClient.receiveMessagesAsync({
                    consumer: makeConsumer(),
                    topic: 'test-topic',
                    onMessageAsync,
                    deadLetterTopic: 'test-topic.dlt',
                    retryInitialDelayMs: 1
                });

                expect(onMessageAsync).toHaveBeenCalledTimes(1);
                expect(mockProducerSend).not.toHaveBeenCalled();
            });

            test('rethrows a persistent heartbeat failure of any type instead of dead-lettering', async () => {
                // A coordinator-unavailable or connection error from heartbeat() is not the message's fault.
                const heartbeatError = Object.assign(new Error('coordinator not available'), {
                    type: 'GROUP_COORDINATOR_NOT_AVAILABLE'
                });
                mockHeartbeat.mockRejectedValue(heartbeatError);
                const onMessageAsync = jestObj.fn().mockResolvedValue(undefined);

                await expect(
                    kafkaClient.receiveMessagesAsync({
                        consumer: makeConsumer(),
                        topic: 'test-topic',
                        onMessageAsync,
                        deadLetterTopic: 'test-topic.dlt',
                        maxRetries: 2,
                        retryInitialDelayMs: 1
                    })
                ).rejects.toBe(heartbeatError);

                expect(onMessageAsync).not.toHaveBeenCalled();
                expect(mockProducerSend).not.toHaveBeenCalled();
            });

            test('counts handler failures across rebalance redeliveries so a failing message still reaches the DLT', async () => {
                // Regression: a slow handler that outlasts the session timeout and then throws gets evicted,
                // the next heartbeat throws a group error, and kafkajs redelivers with a fresh retry budget.
                // Without a per-offset count the message loops forever and blocks its partition.
                let eachMessage;
                const consumer = {
                    connect: mockConsumerConnect,
                    disconnect: mockConsumerDisconnect,
                    subscribe: mockConsumerSubscribe,
                    run: jestObj.fn().mockImplementation(async (args) => {
                        eachMessage = args.eachMessage;
                    })
                };
                const message = { key: Buffer.from('k'), value: Buffer.from('v'), headers: {}, offset: '42' };
                const deliver = () => eachMessage({
                    topic: 'test-topic', partition: 0, message, heartbeat: mockHeartbeat, pause: jestObj.fn()
                });
                const onMessageAsync = jestObj.fn().mockRejectedValue(new Error('slow failure'));

                await kafkaClient.receiveMessagesAsync({
                    consumer,
                    topic: 'test-topic',
                    onMessageAsync,
                    deadLetterTopic: 'test-topic.dlt',
                    maxRetries: 3,
                    retryInitialDelayMs: 1
                });

                // First delivery: the handler fails once, then the next heartbeat reports a rebalance.
                mockHeartbeat
                    .mockResolvedValueOnce(undefined)
                    .mockRejectedValueOnce(Object.assign(new Error('rebalancing'), { type: 'REBALANCE_IN_PROGRESS' }));
                await expect(deliver()).rejects.toThrow('rebalancing');
                expect(mockProducerSend).not.toHaveBeenCalled();

                // Redelivery: only the remaining budget is spent before dead-lettering.
                mockHeartbeat.mockResolvedValue(undefined);
                await expect(deliver()).resolves.toBeUndefined();

                expect(onMessageAsync).toHaveBeenCalledTimes(4);
                expect(mockProducerSend).toHaveBeenCalledWith(expect.objectContaining({ topic: 'test-topic.dlt' }));
            });

            test('evicts the least recently updated offset, not the oldest inserted, when the failure tracker is full', async () => {
                let eachMessage;
                const consumer = {
                    connect: mockConsumerConnect,
                    disconnect: mockConsumerDisconnect,
                    subscribe: mockConsumerSubscribe,
                    run: jestObj.fn().mockImplementation(async (args) => {
                        eachMessage = args.eachMessage;
                    })
                };
                const onMessageAsync = jestObj.fn().mockRejectedValue(new Error('slow failure'));
                await kafkaClient.receiveMessagesAsync({
                    consumer,
                    topic: 'test-topic',
                    onMessageAsync,
                    deadLetterTopic: 'test-topic.dlt',
                    maxRetries: 3,
                    retryInitialDelayMs: 1
                });

                const deliver = (offset) => eachMessage({
                    topic: 'test-topic',
                    partition: 0,
                    message: { key: Buffer.from('k'), value: Buffer.from('v'), headers: {}, offset },
                    heartbeat: mockHeartbeat,
                    pause: jestObj.fn()
                });
                // One handler failure, then a rebalance, so the failure count is carried over.
                const failOnceThenRebalance = async (offset) => {
                    mockHeartbeat
                        .mockResolvedValueOnce(undefined)
                        .mockRejectedValueOnce(Object.assign(new Error('rebalancing'), { type: 'REBALANCE_IN_PROGRESS' }));
                    await expect(deliver(offset)).rejects.toThrow('rebalancing');
                };

                // Offset 0 is inserted first, then updated while the tracker is only half full (it holds
                // 1000 entries, MAX_TRACKED_OFFSETS in kafkaClientV2.js). It now has 2 failures and is the
                // most recently updated, even though it was inserted first.
                await failOnceThenRebalance('0');
                for (let offset = 1; offset <= 500; offset++) {
                    await failOnceThenRebalance(String(offset));
                }
                await failOnceThenRebalance('0');
                for (let offset = 501; offset < 1000; offset++) {
                    await failOnceThenRebalance(String(offset));
                }
                // A new offset overflows the tracker and must evict offset 1, not offset 0.
                await failOnceThenRebalance('1000');

                onMessageAsync.mockClear();
                mockHeartbeat.mockResolvedValue(undefined);
                await expect(deliver('0')).resolves.toBeUndefined();

                // 2 failures already counted, so only maxRetries - 2 retries remain: 2 attempts, not 4.
                expect(onMessageAsync).toHaveBeenCalledTimes(2);
                expect(mockProducerSend).toHaveBeenCalledWith(expect.objectContaining({ topic: 'test-topic.dlt' }));
            });

            describe('background heartbeat while a handler is running', () => {
                // kafkajs only heartbeats before and after eachMessage, so a handler running longer
                // than the session timeout (a bulk import range takes up to a few minutes) got its
                // member evicted and the whole fetched batch redelivered.
                beforeEach(() => {
                    jestObj.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
                });

                afterEach(() => {
                    jestObj.useRealTimers();
                });

                // A handler that stays pending until the test settles it.
                const startSlowHandler = (options = {}) => {
                    let settle;
                    const onMessageAsync = jestObj.fn(() => new Promise((resolve, reject) => {
                        settle = { resolve, reject };
                    }));
                    const received = kafkaClient.receiveMessagesAsync({
                        consumer: makeConsumer(),
                        topic: 'test-topic',
                        onMessageAsync,
                        retryInitialDelayMs: 1,
                        ...options
                    });
                    return {
                        received,
                        onMessageAsync,
                        finish: () => settle.resolve(),
                        fail: (error) => settle.reject(error)
                    };
                };

                // kafkajs only sends a heartbeat once a full interval has passed since the previous
                // one finished, so the timer ticks at a third of the 3000 ms interval (1000 ms)
                // instead of skipping every second tick.
                test.each([
                    // The dead-letter path also heartbeats once before its first attempt.
                    ['with a dead-letter topic', { deadLetterTopic: 'test-topic.dlt' }, 11],
                    ['without a dead-letter topic', {}, 10]
                ])('keeps heartbeating until the handler finishes, %s', async (_name, options, expectedHeartbeats) => {
                    const { received, finish } = startSlowHandler(options);

                    // Ticks at 1000, 2000, ... 10000 ms.
                    await jestObj.advanceTimersByTimeAsync(10500);
                    expect(mockHeartbeat).toHaveBeenCalledTimes(expectedHeartbeats);

                    finish();
                    await received;
                    mockHeartbeat.mockClear();
                    await jestObj.advanceTimersByTimeAsync(10000);
                    expect(mockHeartbeat).not.toHaveBeenCalled();
                });

                test('stops heartbeating and logs an error once the handler exceeds the maximum processing time', async () => {
                    // Otherwise a handler that never returns would keep its member, and so its
                    // partition, alive forever with no log or alert.
                    const { received, finish } = startSlowHandler();

                    // The configured maximum processing time is 60000 ms.
                    await jestObj.advanceTimersByTimeAsync(60500);
                    expect(logError).toHaveBeenCalledTimes(1);
                    expect(logError).toHaveBeenCalledWith(
                        expect.any(String),
                        expect.objectContaining({ topic: 'test-topic', partition: 0, maxProcessingMs: 60000 })
                    );

                    const heartbeatsAtCeiling = mockHeartbeat.mock.calls.length;
                    await jestObj.advanceTimersByTimeAsync(30000);
                    expect(mockHeartbeat).toHaveBeenCalledTimes(heartbeatsAtCeiling);

                    // The handler itself is left alone; if it does return, the message completes.
                    finish();
                    await expect(received).resolves.toBeUndefined();
                    expect(logError).toHaveBeenCalledTimes(1);
                });

                test('does not log a maximum processing time error when the handler finishes in time', async () => {
                    const { received, finish } = startSlowHandler();

                    await jestObj.advanceTimersByTimeAsync(5000);
                    finish();
                    await received;
                    await jestObj.advanceTimersByTimeAsync(120000);

                    expect(logError).not.toHaveBeenCalled();
                });

                test('stops heartbeating and rethrows when the handler throws', async () => {
                    const { received, fail } = startSlowHandler();

                    await jestObj.advanceTimersByTimeAsync(4500);
                    expect(mockHeartbeat).toHaveBeenCalledTimes(4);

                    fail(new Error('boom'));
                    await expect(received).rejects.toThrow('boom');
                    mockHeartbeat.mockClear();
                    await jestObj.advanceTimersByTimeAsync(10000);
                    expect(mockHeartbeat).not.toHaveBeenCalled();
                });

                test.each([
                    ['a group-membership error', Object.assign(new Error('The coordinator is not aware of this member'), { type: 'UNKNOWN_MEMBER_ID' })],
                    ['a generic error', new Error('socket closed')]
                ])('does not fail the handler and warns once when a background heartbeat fails with %s', async (_name, heartbeatError) => {
                    // A throw inside a bulk import range is reported as ImportRangeFailed and fails
                    // the whole Task, so a failed heartbeat must never reach the handler.
                    mockHeartbeat.mockRejectedValue(heartbeatError);
                    const { received, finish, onMessageAsync } = startSlowHandler();

                    await jestObj.advanceTimersByTimeAsync(10500);
                    finish();

                    await expect(received).resolves.toBeUndefined();
                    expect(onMessageAsync).toHaveBeenCalledTimes(1);
                    expect(mockHeartbeat).toHaveBeenCalledTimes(10);
                    expect(logWarn).toHaveBeenCalledTimes(1);
                    expect(logWarn).toHaveBeenCalledWith(
                        expect.any(String),
                        expect.objectContaining({
                            topic: 'test-topic',
                            partition: 0,
                            errorType: heartbeatError.type,
                            error: heartbeatError.message
                        })
                    );
                });
            });
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

        test('passes the configured session, rebalance and heartbeat timeouts to the consumer', async () => {
            await kafkaClient.createConsumerAsync({ groupId: 'my-group' });
            expect(kafkaClient.client.consumer).toHaveBeenCalledWith({
                groupId: 'my-group',
                sessionTimeout: 31000,
                rebalanceTimeout: 301000,
                heartbeatInterval: 3000
            });
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

            await expect(singleClient.sendCloudEventMessageAsync({ topic: 'topic', messages: [] })).rejects.toThrow();
            expect(singleClient.brokers).toEqual(['single-broker:9092']);
        });

        test('handles empty messages array', async () => {
            kafkaClient.producerConnected = true;
            await kafkaClient.sendCloudEventMessageHelperAsync({ topic: 'topic', messages: [] });
            expect(mockProducerSend).toHaveBeenCalledWith({ topic: 'topic', messages: [] });
        });
    });

    describe('zstd compression codec', () => {
        const { CompressionTypes, CompressionCodecs } = jestObj.requireActual('kafkajs');

        test('replaces kafkajs\'s "not implemented" ZSTD codec with a working round-trip', async () => {
            const codec = CompressionCodecs[CompressionTypes.ZSTD]();
            const payload = Buffer.from(JSON.stringify({ resourceType: 'AuditEvent', id: 'a'.repeat(1000) }));

            const compressed = await codec.compress({ buffer: payload });
            expect(compressed.length).toBeLessThan(payload.length);
            expect((await codec.decompress(compressed)).equals(payload)).toBe(true);
        });
    });

    describe('getKafkaCompressionType', () => {
        const { CompressionTypes } = jestObj.requireActual('kafkajs');
        const { getKafkaCompressionType } = require('../../../utils/kafkaClientV2');

        test('maps none/gzip/zstd case-insensitively', () => {
            expect(getKafkaCompressionType('none')).toBe(CompressionTypes.None);
            expect(getKafkaCompressionType('GZIP')).toBe(CompressionTypes.GZIP);
            expect(getKafkaCompressionType('zstd')).toBe(CompressionTypes.ZSTD);
        });

        test('throws on an unsupported compression name', () => {
            expect(() => getKafkaCompressionType('snappy')).toThrow('Unsupported Kafka compression "snappy"');
        });
    });
});
