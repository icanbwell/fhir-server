const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { HistorySyncConsumer } = require('../../../consumers/historySync/historySyncConsumer');

describe('HistorySyncConsumer', () => {
    let consumer;
    let mockKafkaClient;
    let mockHistorySyncJob;
    let mockConfigManager;
    let sentMessages;

    beforeEach(async () => {
        await commonBeforeEach();

        sentMessages = [];

        mockKafkaClient = {
            createConsumerAsync: jest.fn(async () => ({
                connect: jest.fn(),
                subscribe: jest.fn(),
                run: jest.fn(),
                disconnect: jest.fn(),
                commitOffsets: jest.fn()
            })),
            sendMessagesAsync: jest.fn(async (topic, messages) => {
                sentMessages.push({ topic, messages });
            })
        };

        mockHistorySyncJob = {
            executeAsync: jest.fn(async () => {}),
            shuttingDown: false
        };

        mockConfigManager = {
            historySyncConsumerGroup: 'test-consumer-group',
            historySyncKafkaTopic: 'test.history.commands',
            historySyncDlqTopic: 'test.history.dlq',
            historySyncMaxRetries: 2
        };

        consumer = new HistorySyncConsumer({
            kafkaClient: mockKafkaClient,
            historySyncJob: mockHistorySyncJob,
            configManager: mockConfigManager
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('_handleMessageAsync', () => {
        const mockHeartbeat = jest.fn();

        function createMessage(value) {
            return {
                value: Buffer.from(JSON.stringify(value)),
                offset: '0'
            };
        }

        test('should execute job for valid command', async () => {
            await consumer.startAsync();

            const command = { jobId: 'job-1', resourceType: 'Patient' };
            await consumer._handleMessageAsync({
                message: createMessage(command),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockHistorySyncJob.executeAsync).toHaveBeenCalledWith(command);
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip invalid JSON messages', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: { value: Buffer.from('not-json'), offset: '0' },
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockHistorySyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages without jobId', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ resourceType: 'Patient' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockHistorySyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages without resourceType', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockHistorySyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages with invalid resourceType', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1', resourceType: 'NotARealResource' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockHistorySyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages with AuditEvent resourceType', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1', resourceType: 'AuditEvent' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockHistorySyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should retry on failure and send to DLQ after exhaustion', async () => {
            await consumer.startAsync();

            mockHistorySyncJob.executeAsync = jest.fn(async () => {
                throw new Error('Job failed');
            });

            const command = { jobId: 'job-fail', resourceType: 'Patient' };
            await consumer._handleMessageAsync({
                message: createMessage(command),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            // Should have retried maxRetries times
            expect(mockHistorySyncJob.executeAsync).toHaveBeenCalledTimes(2);

            // Should have sent to DLQ
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].topic).toBe('test.history.dlq');

            const dlqValue = JSON.parse(sentMessages[0].messages[0].value);
            expect(dlqValue.originalCommand.jobId).toBe('job-fail');
            expect(dlqValue.error).toBe('Job failed');

            // Should still commit offset
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });
    });

    describe('shutdownAsync', () => {
        test('should set shuttingDown flags and disconnect', async () => {
            await consumer.startAsync();

            await consumer.shutdownAsync();

            expect(consumer.shuttingDown).toBe(true);
            expect(mockHistorySyncJob.shuttingDown).toBe(true);
            expect(consumer.consumer.disconnect).toHaveBeenCalled();
        });
    });

    describe('startAsync', () => {
        test('should create consumer with correct group and topic', async () => {
            await consumer.startAsync();

            expect(mockKafkaClient.createConsumerAsync).toHaveBeenCalledWith({
                groupId: 'test-consumer-group'
            });
        });
    });
});
