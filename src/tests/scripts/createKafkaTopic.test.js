// Unit tests for the create_kafka_topic script. The repo has no Kafka broker in
// jest (Kafka is mocked everywhere), so KafkaClientV2 is mocked to hand back a
// fake kafkajs Admin client whose methods are jest.fn()s. We assert the script
// calls the admin API with the right arguments and always disconnects.

const { describe, test, beforeEach, expect, jest } = require('@jest/globals');

jest.mock('../../utils/kafkaClientV2');

const { KafkaClientV2 } = require('../../utils/kafkaClientV2');
const {
    createKafkaTopic,
    describeKafkaTopic,
    deleteKafkaTopic,
    parseIntArg,
    KAFKA_PARTITION_COUNT,
    KAFKA_RETENTION_MS,
    KAFKA_MAX_MESSAGE_BYTES
} = require('../../scripts/create_kafka_topic');

// A stand-in ConfigManager. The script only reads it to build KafkaClientV2
// (which is mocked) and to log brokers/authType, so a plain object suffices.
const fakeConfigManager = {
    kafkaV2Brokers: ['localhost:9092'],
    kafkaV2AuthType: ''
};

/**
 * Wire up a fake Admin client and make new KafkaClientV2() return it via
 * createAdminClient(). Returns the admin so tests can assert on / control it.
 * @param {Object} [overrides] override individual admin method impls
 */
function mockAdmin(overrides = {}) {
    const admin = {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        createTopics: jest.fn().mockResolvedValue(true),
        deleteTopics: jest.fn().mockResolvedValue(undefined),
        fetchTopicMetadata: jest.fn().mockResolvedValue({ topics: [] }),
        ...overrides
    };
    KafkaClientV2.mockImplementation(() => ({
        createAdminClient: () => admin
    }));
    return admin;
}

describe('create_kafka_topic script', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createKafkaTopic', () => {
        test('creates the topic with the given partitions and retention', async () => {
            const admin = mockAdmin();

            await createKafkaTopic(fakeConfigManager, 'my.topic', 6, 1000);

            expect(admin.connect).toHaveBeenCalledTimes(1);
            expect(admin.createTopics).toHaveBeenCalledTimes(1);
            const arg = admin.createTopics.mock.calls[0][0];
            expect(arg.waitForLeaders).toBe(true);
            expect(arg.topics).toEqual([
                {
                    topic: 'my.topic',
                    numPartitions: 6,
                    configEntries: [
                        { name: 'retention.ms', value: '1000' },
                        { name: 'max.message.bytes', value: KAFKA_MAX_MESSAGE_BYTES.toString() }
                    ]
                }
            ]);
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('passes retention.ms as a string (kafkajs requires string config values)', async () => {
            const admin = mockAdmin();

            await createKafkaTopic(fakeConfigManager, 'my.topic', KAFKA_PARTITION_COUNT, KAFKA_RETENTION_MS);

            const retentionEntry = admin.createTopics.mock.calls[0][0].topics[0].configEntries.find(
                (e) => e.name === 'retention.ms'
            );
            expect(retentionEntry.value).toBe(KAFKA_RETENTION_MS.toString());
            expect(typeof retentionEntry.value).toBe('string');
        });

        test('resolves cleanly when the topic already exists (createTopics returns false)', async () => {
            const admin = mockAdmin({ createTopics: jest.fn().mockResolvedValue(false) });

            await expect(
                createKafkaTopic(fakeConfigManager, 'existing.topic', KAFKA_PARTITION_COUNT, KAFKA_RETENTION_MS)
            ).resolves.toBeUndefined();
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('disconnects even when createTopics throws', async () => {
            const admin = mockAdmin({
                createTopics: jest.fn().mockRejectedValue(new Error('broker down'))
            });

            await expect(
                createKafkaTopic(fakeConfigManager, 'my.topic', KAFKA_PARTITION_COUNT, KAFKA_RETENTION_MS)
            ).rejects.toThrow('broker down');
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });
    });

    describe('describeKafkaTopic', () => {
        test('fetches metadata for the topic', async () => {
            const admin = mockAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue({
                    topics: [
                        {
                            name: 'my.topic',
                            partitions: [{ partitionId: 0, leader: 1, replicas: [1], isr: [1] }]
                        }
                    ]
                })
            });

            await describeKafkaTopic(fakeConfigManager, 'my.topic');

            expect(admin.fetchTopicMetadata).toHaveBeenCalledWith({ topics: ['my.topic'] });
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('returns gracefully when the topic does not exist (fetchTopicMetadata throws UNKNOWN_TOPIC_OR_PARTITION)', async () => {
            // Real kafkajs throws rather than resolving to { topics: [] } for a
            // missing topic, so the missing-topic path must be a caught throw.
            const err = Object.assign(new Error('nope'), { type: 'UNKNOWN_TOPIC_OR_PARTITION' });
            const admin = mockAdmin({ fetchTopicMetadata: jest.fn().mockRejectedValue(err) });

            await expect(describeKafkaTopic(fakeConfigManager, 'missing.topic')).resolves.toBeUndefined();
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('rethrows non-UNKNOWN_TOPIC_OR_PARTITION errors', async () => {
            const admin = mockAdmin({
                fetchTopicMetadata: jest.fn().mockRejectedValue(new Error('broker down'))
            });

            await expect(describeKafkaTopic(fakeConfigManager, 'my.topic')).rejects.toThrow('broker down');
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });
    });

    describe('deleteKafkaTopic', () => {
        test('deletes the topic', async () => {
            const admin = mockAdmin();

            await deleteKafkaTopic(fakeConfigManager, 'my.topic');

            expect(admin.deleteTopics).toHaveBeenCalledWith({ topics: ['my.topic'], timeout: 30_000 });
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('swallows UNKNOWN_TOPIC_OR_PARTITION when deleting a missing topic', async () => {
            const err = Object.assign(new Error('nope'), { type: 'UNKNOWN_TOPIC_OR_PARTITION' });
            const admin = mockAdmin({ deleteTopics: jest.fn().mockRejectedValue(err) });

            await expect(deleteKafkaTopic(fakeConfigManager, 'missing.topic')).resolves.toBeUndefined();
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('rethrows non-UNKNOWN_TOPIC_OR_PARTITION errors', async () => {
            const admin = mockAdmin({
                deleteTopics: jest.fn().mockRejectedValue(new Error('broker down'))
            });

            await expect(deleteKafkaTopic(fakeConfigManager, 'my.topic')).rejects.toThrow('broker down');
            expect(admin.disconnect).toHaveBeenCalledTimes(1);
        });
    });

    describe('defaults', () => {
        test('default retention is 7 days and default partition count is 30', () => {
            expect(KAFKA_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
            expect(KAFKA_PARTITION_COUNT).toBe(30);
        });
    });

    describe('parseIntArg', () => {
        test('returns the default when the flag is absent', () => {
            expect(parseIntArg(undefined, 30, 'partitions', 1)).toBe(30);
        });

        test('returns the parsed integer when valid', () => {
            expect(parseIntArg('6', 30, 'partitions', 1)).toBe(6);
        });

        test('accepts an explicit value equal to the minimum', () => {
            expect(parseIntArg('1', 30, 'partitions', 1)).toBe(1);
        });

        test('accepts explicit 0 and -1 when the minimum allows (retention.ms)', () => {
            expect(parseIntArg('0', KAFKA_RETENTION_MS, 'retention-ms', -1)).toBe(0);
            expect(parseIntArg('-1', KAFKA_RETENTION_MS, 'retention-ms', -1)).toBe(-1);
        });

        test('throws on a value below the minimum (0 partitions)', () => {
            expect(() => parseIntArg('0', 30, 'partitions', 1)).toThrow('Invalid --partitions');
        });

        test('throws on non-numeric input instead of silently defaulting', () => {
            expect(() => parseIntArg('abc', 30, 'partitions', 1)).toThrow('Invalid --partitions');
        });

        test('throws on partial-numeric input (parseInt would silently return 3)', () => {
            expect(() => parseIntArg('3x', 30, 'partitions', 1)).toThrow('Invalid --partitions');
        });

        test('throws on non-integer numeric input', () => {
            expect(() => parseIntArg('6.5', 30, 'partitions', 1)).toThrow('Invalid --partitions');
        });
    });
});
