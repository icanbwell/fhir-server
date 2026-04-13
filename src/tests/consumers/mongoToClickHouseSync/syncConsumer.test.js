const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { SyncConsumer } = require('../../../consumers/mongoToClickHouseSync/syncConsumer');

describe('SyncConsumer', () => {
    let consumer;
    let mockKafkaClient;
    let mockSyncJob;
    let mockConfigManager;
    let mockSyncProfileRegistry;
    let sentMessages;

    const mockResourceHistoryProfile = {
        syncType: 'resourceHistory',
        validateCommand: (command) => {
            if (!command.jobId) {
                return { valid: false, reason: 'missing jobId' };
            }
            if (!command.resourceType) {
                return { valid: false, reason: 'missing resourceType' };
            }
            if (command.resourceType === 'AuditEvent') {
                return { valid: false, reason: 'AuditEvent does not have a history collection' };
            }
            if (command.resourceType === 'NotARealResource') {
                return { valid: false, reason: 'invalid resourceType' };
            }
            return { valid: true };
        }
    };

    const mockAuditEventProfile = {
        syncType: 'auditEvent',
        validateCommand: (command) => {
            if (!command.jobId) {
                return { valid: false, reason: 'missing jobId' };
            }
            return { valid: true };
        }
    };

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

        mockSyncJob = {
            executeAsync: jest.fn(async () => {}),
            shuttingDown: false
        };

        mockConfigManager = {
            historySyncConsumerGroup: 'test-consumer-group',
            historySyncKafkaTopic: 'test.sync.commands',
            historySyncDlqTopic: 'test.sync.dlq',
            historySyncMaxRetries: 2
        };

        mockSyncProfileRegistry = new Map();
        mockSyncProfileRegistry.set('resourceHistory', mockResourceHistoryProfile);
        mockSyncProfileRegistry.set('auditEvent', mockAuditEventProfile);

        consumer = new SyncConsumer({
            kafkaClient: mockKafkaClient,
            syncJob: mockSyncJob,
            syncProfileRegistry: mockSyncProfileRegistry,
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

        test('should execute job for valid resourceHistory command (backward compat, no syncType)', async () => {
            await consumer.startAsync();

            const command = { jobId: 'job-1', resourceType: 'Patient' };
            await consumer._handleMessageAsync({
                message: createMessage(command),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).toHaveBeenCalledWith(command, mockResourceHistoryProfile);
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should execute job for explicit syncType: resourceHistory', async () => {
            await consumer.startAsync();

            const command = { jobId: 'job-1', syncType: 'resourceHistory', resourceType: 'Patient' };
            await consumer._handleMessageAsync({
                message: createMessage(command),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).toHaveBeenCalledWith(command, mockResourceHistoryProfile);
        });

        test('should route auditEvent syncType to auditEvent profile', async () => {
            await consumer.startAsync();

            const command = { jobId: 'job-1', syncType: 'auditEvent', collection: 'AuditEvent_4_0_0' };
            await consumer._handleMessageAsync({
                message: createMessage(command),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).toHaveBeenCalledWith(command, mockAuditEventProfile);
        });

        test('should skip unknown syncType', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1', syncType: 'unknownType' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip invalid JSON messages', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: { value: Buffer.from('not-json'), offset: '0' },
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages failing profile validation (missing jobId)', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ resourceType: 'Patient' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages failing profile validation (missing resourceType)', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip messages with invalid resourceType', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1', resourceType: 'NotARealResource' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should skip AuditEvent for resourceHistory profile', async () => {
            await consumer.startAsync();

            await consumer._handleMessageAsync({
                message: createMessage({ jobId: 'job-1', resourceType: 'AuditEvent' }),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            expect(mockSyncJob.executeAsync).not.toHaveBeenCalled();
            expect(consumer.consumer.commitOffsets).toHaveBeenCalled();
        });

        test('should retry on failure and send to DLQ after exhaustion', async () => {
            await consumer.startAsync();

            mockSyncJob.executeAsync = jest.fn(async () => {
                throw new Error('Job failed');
            });

            const command = { jobId: 'job-fail', resourceType: 'Patient' };
            await consumer._handleMessageAsync({
                message: createMessage(command),
                partition: 0,
                heartbeat: mockHeartbeat
            });

            // Should have retried maxRetries times
            expect(mockSyncJob.executeAsync).toHaveBeenCalledTimes(2);

            // Should have sent to DLQ
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].topic).toBe('test.sync.dlq');

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
            expect(mockSyncJob.shuttingDown).toBe(true);
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
