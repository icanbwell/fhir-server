'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');

/**
 * src/admin/scripts/manageKafkaV2Topic.js is well-suited to direct unit testing: it exports its
 * pure helpers (parseIntArg, applyTopicPrefix) and its three admin operations
 * (createKafkaTopic/describeKafkaTopic/deleteKafkaTopic) directly, and guards its CLI entry point
 * behind `if (require.main === module)` so requiring it in Jest never auto-runs main().
 *
 * Each operation connects an admin client, does its work in a try, and disconnects in a finally
 * -- including on the error path -- and both describe/delete treat UNKNOWN_TOPIC_OR_PARTITION as
 * a benign "already gone" signal rather than a fatal error. Those are the branches this suite
 * targets.
 */

const SCRIPT_PATH = '../../../admin/scripts/manageKafkaV2Topic';
const KAFKA_CLIENT_PATH = '../../../utils/kafkaClientV2';
const CONFIG_MANAGER_PATH = '../../../utils/configManager';
const LOGGING_PATH = '../../../operations/common/logging';

function buildFakeAdmin (overrides = {}) {
    return {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        createTopics: jest.fn().mockResolvedValue(true),
        fetchTopicMetadata: jest.fn().mockResolvedValue({ topics: [] }),
        deleteTopics: jest.fn().mockResolvedValue(undefined),
        describeConfigs: jest.fn().mockResolvedValue({ resources: [{ configEntries: [] }] }),
        alterConfigs: jest.fn().mockResolvedValue(undefined),
        createPartitions: jest.fn().mockResolvedValue(true),
        ...overrides
    };
}

/**
 * Requires the script fresh with KafkaClientV2/ConfigManager/logging mocked.
 * @param {Object} fakeAdmin the admin client the mocked KafkaClientV2 should hand back
 */
function loadScript (fakeAdmin) {
    jest.resetModules();

    const MockKafkaClientV2 = jest.fn().mockImplementation(function () {
        this.createAdminClient = jest.fn(() => fakeAdmin);
    });
    const MockConfigManager = jest.fn().mockImplementation(function () {
        this.kafkaV2Brokers = ['broker-1:9092'];
        this.kafkaV2AuthType = undefined;
    });
    const logMocks = { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() };

    jest.doMock(KAFKA_CLIENT_PATH, () => ({ KafkaClientV2: MockKafkaClientV2 }));
    jest.doMock(CONFIG_MANAGER_PATH, () => ({ ConfigManager: MockConfigManager }));
    jest.doMock(LOGGING_PATH, () => logMocks);
    // Node's util.parseArgs resolves its default `args` from the process's original launch argv
    // (captured before Jest's own CLI args are stripped), not from a live re-read of
    // `process.argv` -- reassigning `process.argv` in a test has no effect on it. Route the real
    // parseArgs through an explicit `args: process.argv.slice(2)` so main()'s CLI-arg branching
    // can still be driven from tests without touching src/admin/scripts/manageKafkaV2Topic.js itself.
    jest.doMock('node:util', () => {
        const actualUtil = jest.requireActual('node:util');
        return {
            ...actualUtil,
            parseArgs: (config) => actualUtil.parseArgs({ ...config, args: process.argv.slice(2) })
        };
    });

    const scriptModule = require(SCRIPT_PATH);
    return { scriptModule, MockKafkaClientV2, MockConfigManager, logMocks };
}

describe('scripts/manageKafkaV2Topic.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('applyTopicPrefix', () => {
        test('adds the fhir_server. prefix to an unprefixed name', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(scriptModule.applyTopicPrefix('auditevents')).toBe('fhir_server.auditevents');
        });

        test('is idempotent: an already-prefixed name is returned unchanged', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(scriptModule.applyTopicPrefix('fhir_server.auditevents')).toBe('fhir_server.auditevents');
        });
    });

    describe('parseIntArg', () => {
        test('returns the default when raw is undefined', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(scriptModule.parseIntArg(undefined, 30, 'partitions')).toBe(30);
        });

        test('parses a valid integer string', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(scriptModule.parseIntArg('12', 30, 'partitions')).toBe(12);
        });

        test('throws on a non-integer string instead of silently truncating like parseInt', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(() => scriptModule.parseIntArg('3x', 30, 'partitions')).toThrow(/Invalid --partitions "3x"/);
        });

        test('throws when the value is below the given minimum', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(() => scriptModule.parseIntArg('0', 30, 'partitions', 1)).toThrow(/>= 1/);
        });

        test('accepts the boundary minimum value itself', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(scriptModule.parseIntArg('1', 30, 'partitions', 1)).toBe(1);
        });

        test('accepts a negative retention-ms value (min=-1, "infinite" retention)', () => {
            const { scriptModule } = loadScript(buildFakeAdmin());
            expect(scriptModule.parseIntArg('-1', 604800000, 'retention-ms', -1)).toBe(-1);
        });
    });

    describe('createKafkaTopic', () => {
        test('creates the topic with the requested partitions/retention and the fixed max.message.bytes', async () => {
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);
            const configManager = new MockConfigManager();

            await scriptModule.createKafkaTopic(configManager, 'fhir_server.auditevents', 30, 604800000);

            expect(fakeAdmin.connect).toHaveBeenCalledTimes(1);
            expect(fakeAdmin.createTopics).toHaveBeenCalledWith({
                waitForLeaders: true,
                timeout: 30_000,
                topics: [
                    {
                        topic: 'fhir_server.auditevents',
                        numPartitions: 30,
                        configEntries: [
                            { name: 'retention.ms', value: '604800000' },
                            { name: 'max.message.bytes', value: String(scriptModule.KAFKA_MAX_MESSAGE_BYTES) }
                        ]
                    }
                ]
            });
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('logs "already exists" (rather than "created") when createTopics resolves false', async () => {
            const fakeAdmin = buildFakeAdmin({ createTopics: jest.fn().mockResolvedValue(false) });
            const { scriptModule, MockConfigManager, logMocks } = loadScript(fakeAdmin);

            await scriptModule.createKafkaTopic(new MockConfigManager(), 'fhir_server.x', 30, 1000);

            const infoMessages = logMocks.logInfo.mock.calls.map((call) => call[0]);
            expect(infoMessages.some((m) => m.includes('already exists'))).toBe(true);
            expect(infoMessages.some((m) => m.includes('created successfully'))).toBe(false);
        });

        test('disconnects the admin client even when createTopics throws, and rethrows', async () => {
            const failure = new Error('broker unreachable');
            const fakeAdmin = buildFakeAdmin({ createTopics: jest.fn().mockRejectedValue(failure) });
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);

            await expect(
                scriptModule.createKafkaTopic(new MockConfigManager(), 'fhir_server.x', 30, 1000)
            ).rejects.toThrow('broker unreachable');
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });
    });

    describe('describeKafkaTopic', () => {
        test('fetches and logs partition metadata for an existing topic', async () => {
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue({
                    topics: [{ name: 'fhir_server.x', partitions: [{ partitionId: 0, leader: 1, replicas: [1], isr: [1] }] }]
                })
            });
            const { scriptModule, MockConfigManager, logMocks } = loadScript(fakeAdmin);

            await scriptModule.describeKafkaTopic(new MockConfigManager(), 'fhir_server.x');

            expect(fakeAdmin.fetchTopicMetadata).toHaveBeenCalledWith({ topics: ['fhir_server.x'] });
            const metadataLog = logMocks.logInfo.mock.calls.find((call) => call[0].includes('Topic metadata'));
            expect(metadataLog[1].partitionCount).toBe(1);
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('logs retention.ms and max.message.bytes with their source', async () => {
            const { ConfigSource } = require('kafkajs');
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue({ topics: [{ name: 'fhir_server.x', partitions: [] }] }),
                describeConfigs: jest.fn().mockResolvedValue({
                    resources: [{
                        configEntries: [
                            { configName: 'retention.ms', configValue: '604800000', configSource: ConfigSource.TOPIC_CONFIG },
                            { configName: 'max.message.bytes', configValue: '1048588', configSource: ConfigSource.DEFAULT_CONFIG }
                        ]
                    }]
                })
            });
            const { scriptModule, MockConfigManager, logMocks } = loadScript(fakeAdmin);

            await scriptModule.describeKafkaTopic(new MockConfigManager(), 'fhir_server.x');

            const metadataLog = logMocks.logInfo.mock.calls.find((call) => call[0].includes('Topic metadata'));
            expect(metadataLog[1].retentionMs).toEqual({ value: '604800000', source: 'TOPIC_CONFIG' });
            expect(metadataLog[1].maxMessageBytes).toEqual({ value: '1048588', source: 'DEFAULT_CONFIG' });
        });

        test('still logs partition metadata when describeConfigs fails', async () => {
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue({ topics: [{ name: 'fhir_server.x', partitions: [{ partitionId: 0 }] }] }),
                describeConfigs: jest.fn().mockRejectedValue(new Error('not authorized'))
            });
            const { scriptModule, MockConfigManager, logMocks } = loadScript(fakeAdmin);

            await scriptModule.describeKafkaTopic(new MockConfigManager(), 'fhir_server.x');

            const metadataLog = logMocks.logInfo.mock.calls.find((call) => call[0].includes('Topic metadata'));
            expect(metadataLog[1].partitionCount).toBe(1);
            expect(metadataLog[1].retentionMs).toEqual({ error: 'not authorized' });
            expect(logMocks.logWarn).toHaveBeenCalled();
        });

        test('treats UNKNOWN_TOPIC_OR_PARTITION as "does not exist" and does not rethrow', async () => {
            const notFoundError = Object.assign(new Error('not found'), { type: 'UNKNOWN_TOPIC_OR_PARTITION' });
            const fakeAdmin = buildFakeAdmin({ fetchTopicMetadata: jest.fn().mockRejectedValue(notFoundError) });
            const { scriptModule, MockConfigManager, logMocks } = loadScript(fakeAdmin);

            await expect(scriptModule.describeKafkaTopic(new MockConfigManager(), 'fhir_server.missing')).resolves.toBeUndefined();
            expect(logMocks.logWarn).toHaveBeenCalled();
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('rethrows errors that are not UNKNOWN_TOPIC_OR_PARTITION', async () => {
            const otherError = Object.assign(new Error('boom'), { type: 'SOME_OTHER_ERROR' });
            const fakeAdmin = buildFakeAdmin({ fetchTopicMetadata: jest.fn().mockRejectedValue(otherError) });
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);

            await expect(scriptModule.describeKafkaTopic(new MockConfigManager(), 'fhir_server.x')).rejects.toThrow('boom');
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });
    });

    describe('updateKafkaTopicConfig', () => {
        test('changes retention.ms and resends the other topic overrides unchanged', async () => {
            const { ConfigSource } = require('kafkajs');
            const fakeAdmin = buildFakeAdmin({
                describeConfigs: jest.fn().mockResolvedValue({
                    resources: [{
                        configEntries: [
                            { configName: 'retention.ms', configValue: '604800000', configSource: ConfigSource.TOPIC_CONFIG },
                            { configName: 'max.message.bytes', configValue: '2097152', configSource: ConfigSource.TOPIC_CONFIG },
                            { configName: 'cleanup.policy', configValue: 'delete', configSource: ConfigSource.DEFAULT_CONFIG }
                        ]
                    }]
                })
            });
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);

            await scriptModule.updateKafkaTopicConfig(new MockConfigManager(), 'fhir_server.x', { 'retention.ms': 1209600000 });

            expect(fakeAdmin.alterConfigs.mock.calls[0][0].resources[0].configEntries).toEqual([
                { name: 'max.message.bytes', value: '2097152' },
                { name: 'retention.ms', value: '1209600000' }
            ]);
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('rejects an empty update without connecting', async () => {
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);

            await expect(scriptModule.updateKafkaTopicConfig(new MockConfigManager(), 'fhir_server.x', {}))
                .rejects.toThrow('No config updates given');
            expect(fakeAdmin.connect).not.toHaveBeenCalled();
        });
    });

    describe('growKafkaTopic', () => {
        const topicName = 'fhir_server.bulk_import.events';
        const metadataWith = (count) => ({
            topics: [{ name: topicName, partitions: Array.from({ length: count }, (_, i) => ({ partitionId: i })) }]
        });
        const configManager = {};
        const noDelay = { verifyDelayMs: 0 };

        test('raises the partition count with createPartitions and verifies the result', async () => {
            const fetchTopicMetadata = jest.fn()
                .mockResolvedValueOnce(metadataWith(3))
                .mockResolvedValueOnce(metadataWith(30));
            const fakeAdmin = buildFakeAdmin({ fetchTopicMetadata });
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.growKafkaTopic(configManager, topicName, 30, noDelay);

            expect(fakeAdmin.createPartitions).toHaveBeenCalledWith({
                timeout: 30_000,
                topicPartitions: [{ topic: topicName, count: 30 }]
            });
            expect(fakeAdmin.disconnect).toHaveBeenCalled();
        });

        test('is a no-op when the topic already has the target count', async () => {
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue(metadataWith(30))
            });
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.growKafkaTopic(configManager, topicName, 30, noDelay);

            expect(fakeAdmin.createPartitions).not.toHaveBeenCalled();
            expect(fakeAdmin.disconnect).toHaveBeenCalled();
        });

        test('refuses to shrink: Kafka cannot remove partitions', async () => {
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue(metadataWith(30))
            });
            const { scriptModule } = loadScript(fakeAdmin);

            await expect(scriptModule.growKafkaTopic(configManager, topicName, 10, noDelay))
                .rejects.toThrow('Cannot shrink');
            expect(fakeAdmin.createPartitions).not.toHaveBeenCalled();
            expect(fakeAdmin.disconnect).toHaveBeenCalled();
        });

        test('fails (rather than passing quietly) when the topic does not exist', async () => {
            const err = Object.assign(new Error('missing'), { type: 'UNKNOWN_TOPIC_OR_PARTITION' });
            const fakeAdmin = buildFakeAdmin({ fetchTopicMetadata: jest.fn().mockRejectedValue(err) });
            const { scriptModule } = loadScript(fakeAdmin);

            await expect(scriptModule.growKafkaTopic(configManager, topicName, 30, noDelay)).rejects.toThrow('missing');
            expect(fakeAdmin.createPartitions).not.toHaveBeenCalled();
        });

        test('rethrows broker errors (e.g. missing AlterTopic) and still disconnects', async () => {
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue(metadataWith(3)),
                createPartitions: jest.fn().mockRejectedValue(new Error('Not authorized'))
            });
            const { scriptModule } = loadScript(fakeAdmin);

            await expect(scriptModule.growKafkaTopic(configManager, topicName, 30, noDelay))
                .rejects.toThrow('Not authorized');
            expect(fakeAdmin.disconnect).toHaveBeenCalled();
        });

        test('keeps polling metadata until the brokers report the new count', async () => {
            const fetchTopicMetadata = jest.fn()
                .mockResolvedValueOnce(metadataWith(3))
                .mockResolvedValueOnce(metadataWith(3))
                .mockResolvedValueOnce(metadataWith(3))
                .mockResolvedValueOnce(metadataWith(30));
            const fakeAdmin = buildFakeAdmin({ fetchTopicMetadata });
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.growKafkaTopic(configManager, topicName, 30, noDelay);

            expect(fetchTopicMetadata).toHaveBeenCalledTimes(4);
            expect(fakeAdmin.createPartitions).toHaveBeenCalledTimes(1);
        });

        test('fails when metadata still reports the old count after createPartitions', async () => {
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn().mockResolvedValue(metadataWith(3))
            });
            const { scriptModule } = loadScript(fakeAdmin);

            await expect(scriptModule.growKafkaTopic(configManager, topicName, 30, noDelay))
                .rejects.toThrow('expected 30');
        });
    });

    describe('deleteKafkaTopic', () => {
        test('deletes the topic and disconnects', async () => {
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);

            await scriptModule.deleteKafkaTopic(new MockConfigManager(), 'fhir_server.x');

            expect(fakeAdmin.deleteTopics).toHaveBeenCalledWith({ topics: ['fhir_server.x'], timeout: 30_000 });
            expect(fakeAdmin.disconnect).toHaveBeenCalledTimes(1);
        });

        test('treats UNKNOWN_TOPIC_OR_PARTITION as "already gone" and does not rethrow', async () => {
            const notFoundError = Object.assign(new Error('not found'), { type: 'UNKNOWN_TOPIC_OR_PARTITION' });
            const fakeAdmin = buildFakeAdmin({ deleteTopics: jest.fn().mockRejectedValue(notFoundError) });
            const { scriptModule, MockConfigManager, logMocks } = loadScript(fakeAdmin);

            await expect(scriptModule.deleteKafkaTopic(new MockConfigManager(), 'fhir_server.missing')).resolves.toBeUndefined();
            expect(logMocks.logWarn).toHaveBeenCalled();
        });

        test('rethrows other errors from deleteTopics', async () => {
            const otherError = new Error('permission denied');
            const fakeAdmin = buildFakeAdmin({ deleteTopics: jest.fn().mockRejectedValue(otherError) });
            const { scriptModule, MockConfigManager } = loadScript(fakeAdmin);

            await expect(scriptModule.deleteKafkaTopic(new MockConfigManager(), 'fhir_server.x')).rejects.toThrow('permission denied');
        });
    });

    describe('main', () => {
        const originalArgv = process.argv;

        afterEach(() => {
            process.argv = originalArgv;
        });

        test('exits 1 and logs an error when --topic is missing', async () => {
            process.argv = ['node', 'manageKafkaV2Topic.js'];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule, logMocks } = loadScript(fakeAdmin);
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('__exit__'); });

            await expect(scriptModule.main()).rejects.toThrow('__exit__');
            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(logMocks.logError).toHaveBeenCalled();
            expect(fakeAdmin.connect).not.toHaveBeenCalled();
        });

        test('routes to deleteKafkaTopic (with the topic prefix applied) when --delete is set', async () => {
            process.argv = ['node', 'manageKafkaV2Topic.js', '--topic', 'auditevents', '--delete'];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.deleteTopics).toHaveBeenCalledWith({ topics: ['fhir_server.auditevents'], timeout: 30_000 });
            expect(fakeAdmin.createTopics).not.toHaveBeenCalled();
        });

        test('routes to describeKafkaTopic when --describe is set', async () => {
            process.argv = ['node', 'manageKafkaV2Topic.js', '--topic', 'fhir_server.auditevents', '--describe'];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.fetchTopicMetadata).toHaveBeenCalledWith({ topics: ['fhir_server.auditevents'] });
            expect(fakeAdmin.createTopics).not.toHaveBeenCalled();
            expect(fakeAdmin.deleteTopics).not.toHaveBeenCalled();
        });

        test('defaults to createKafkaTopic with the documented default partitions/retention when no flag is set', async () => {
            process.argv = ['node', 'manageKafkaV2Topic.js', '--topic', 'auditevents'];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.createTopics).toHaveBeenCalledWith(expect.objectContaining({
                topics: [expect.objectContaining({
                    topic: 'fhir_server.auditevents',
                    numPartitions: scriptModule.KAFKA_PARTITION_COUNT,
                    configEntries: expect.arrayContaining([
                        { name: 'retention.ms', value: String(scriptModule.KAFKA_RETENTION_MS) }
                    ])
                })]
            }));
        });

        test('routes to the max.message.bytes update when --update is set', async () => {
            process.argv = [
                'node', 'manageKafkaV2Topic.js', '--topic', 'auditevents', '--update', '--max-message-bytes', '4194304'
            ];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.alterConfigs).toHaveBeenCalledWith(expect.objectContaining({
                resources: [expect.objectContaining({
                    name: 'fhir_server.auditevents',
                    configEntries: [{ name: 'max.message.bytes', value: '4194304' }]
                })]
            }));
            expect(fakeAdmin.createTopics).not.toHaveBeenCalled();
        });

        test.each([
            {
                flags: ['--retention-ms', '1209600000'],
                expected: [{ name: 'retention.ms', value: '1209600000' }]
            },
            {
                // parseArgs only accepts a dash-leading value in the --name=value form
                flags: ['--retention-ms=-1'],
                expected: [{ name: 'retention.ms', value: '-1' }]
            },
            {
                flags: ['--retention-ms', '1209600000', '--max-message-bytes', '4194304'],
                expected: [
                    { name: 'retention.ms', value: '1209600000' },
                    { name: 'max.message.bytes', value: '4194304' }
                ]
            },
            {
                flags: [],
                expected: [{ name: 'max.message.bytes', value: '2097152' }]
            }
        ])('--update $flags changes only the passed configs', async ({ flags, expected }) => {
            process.argv = ['node', 'manageKafkaV2Topic.js', '--topic', 'auditevents', '--update', ...flags];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.alterConfigs.mock.calls[0][0].resources[0].configEntries).toEqual(expected);
        });

        test('routes to growKafkaTopic with the prefixed topic and the --partitions target when --grow is set', async () => {
            process.argv = [
                'node', 'manageKafkaV2Topic.js', '--topic', 'bulk_import.events', '--grow', '--partitions', '30'
            ];
            const fakeAdmin = buildFakeAdmin({
                fetchTopicMetadata: jest.fn()
                    .mockResolvedValueOnce({ topics: [{ name: 'fhir_server.bulk_import.events', partitions: [{}, {}, {}] }] })
                    .mockResolvedValueOnce({
                        topics: [{ name: 'fhir_server.bulk_import.events', partitions: Array.from({ length: 30 }, () => ({})) }]
                    })
            });
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.createPartitions).toHaveBeenCalledWith(expect.objectContaining({
                topicPartitions: [{ topic: 'fhir_server.bulk_import.events', count: 30 }]
            }));
            expect(fakeAdmin.createTopics).not.toHaveBeenCalled();
        });

        test('exits 1 when --grow is given without an explicit --partitions target', async () => {
            process.argv = ['node', 'manageKafkaV2Topic.js', '--topic', 'bulk_import.events', '--grow'];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('__exit__'); });

            await expect(scriptModule.main()).rejects.toThrow('__exit__');
            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(fakeAdmin.createPartitions).not.toHaveBeenCalled();
        });

        test('parameter sensitivity: --partitions overrides the default partition count', async () => {
            process.argv = ['node', 'manageKafkaV2Topic.js', '--topic', 'auditevents', '--partitions', '7'];
            const fakeAdmin = buildFakeAdmin();
            const { scriptModule } = loadScript(fakeAdmin);

            await scriptModule.main();

            expect(fakeAdmin.createTopics).toHaveBeenCalledWith(expect.objectContaining({
                topics: [expect.objectContaining({ numPartitions: 7 })]
            }));
        });
    });
});
