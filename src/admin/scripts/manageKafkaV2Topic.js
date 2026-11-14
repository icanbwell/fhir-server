#!/usr/bin/env node
/**
 * Create / describe / delete a Kafka topic using KafkaClientV2.
 *
 * KafkaClientV2 builds the kafkajs client with this server's broker/auth
 * configuration (SASL/SCRAM, MSK IAM, SSL) from environment variables, so the
 * topic is managed against the exact same cluster the server talks to.
 *
 * Required environment variables (same as the server uses):
 *   KAFKA_V2_URLS            comma-separated broker list (e.g. localhost:9092)
 *   KAFKA_V2_CLIENT_ID       optional, defaults to 'fhir-server'
 *   KAFKA_V2_SSL             true to use SSL
 *   KAFKA_V2_SASL            true to use SASL, plus KAFKA_V2_SASL_* vars
 *   KAFKA_V2_AUTH_TYPE       'iam' for MSK IAM, plus KAFKA_V2_AWS_REGION
 *
 * Usage:
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic <name> [--describe | --delete | --update]
 *
 * All topics are namespaced under the `fhir_server.` prefix. You may pass the
 * short name (`auditevents`) or the fully-qualified name
 * (`fhir_server.auditevents`) — both resolve to `fhir_server.auditevents`.
 *
 * Options:
 *   --topic       (required) topic name to manage (prefixed with fhir_server.)
 *   --describe     describe the topic's partition metadata and its retention.ms /
 *                  max.message.bytes (value and source) instead of creating
 *   --delete       delete the topic instead of creating
 *   --update       update retention.ms and/or max.message.bytes on an existing topic, keeping its
 *                  other overrides. Only the flags you pass are changed; with neither flag,
 *                  max.message.bytes is set to its default (2mb), as before.
 *   --grow         raise an existing topic's partition count to --partitions (required with
 *                  --grow). Kafka cannot shrink a topic, so a lower target fails; an equal
 *                  target is a no-op. Needs kafka-cluster:AlterTopic on the topic. Run it while
 *                  nothing is in flight, then restart the consumers of the topic before
 *                  producing again: kafkajs consumers do not pick up new partitions until they
 *                  rejoin the group. A consumer that subscribes with fromBeginning: false starts a
 *                  new partition (no committed offset) at the latest offset and skips messages
 *                  written to it earlier; the bulk-import worker subscribes with
 *                  fromBeginning: true, so it does not.
 *   --partitions   number of partitions when creating (default: 30), or the target when growing
 *   --retention-ms retention period in ms when creating (default: 7 days) or updating (--retention-ms=-1 = infinite)
 *   --max-message-bytes max.message.bytes when creating/updating (default: 2mb)
 *
 * Examples:
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic auditevents            # fhir_server.auditevents
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic auditevents --describe
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic auditevents --delete
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic auditevents --update --max-message-bytes 4194304
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic resource-history.events --update --retention-ms 1209600000
 *   node src/admin/scripts/manageKafkaV2Topic.js --topic bulk_import.events --grow --partitions 30
 */

const { parseArgs } = require('node:util');
const { ConfigResourceTypes, ConfigSource } = require('kafkajs');

const { KafkaClientV2 } = require('../../utils/kafkaClientV2');
const { ConfigManager } = require('../../utils/configManager');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');

// Prefix every log line so this script's output is easy to grep out of the
// shared server logs (mirrors the reference's logger.child({ script })).
const LOG_PREFIX = '[manageKafkaV2Topic]';
const log = {
    info: (message, args) => logInfo(`${LOG_PREFIX} ${message}`, args),
    warn: (message, args) => logWarn(`${LOG_PREFIX} ${message}`, args),
    error: (message, args) => logError(`${LOG_PREFIX} ${message}`, args)
};

const KAFKA_PARTITION_COUNT = 30;
const KAFKA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KAFKA_MAX_MESSAGE_BYTES = 2 * 1024 * 1024; // 2mb
// Metadata reads (and the pause between them) used to confirm a partition grow took effect.
const GROW_VERIFY_ATTEMPTS = 6;
const GROW_VERIFY_DELAY_MS = 2000;

// All topics managed by this script live under a single namespace.
const TOPIC_PREFIX = 'fhir_server.';

/**
 * Namespace a topic name under TOPIC_PREFIX. Idempotent: a name that already
 * starts with the prefix is returned unchanged, so `auditevents` and
 * `fhir_server.auditevents` both resolve to `fhir_server.auditevents`.
 * @param {string} topicName
 * @returns {string}
 */
function applyTopicPrefix(topicName) {
    return topicName.startsWith(TOPIC_PREFIX) ? topicName : `${TOPIC_PREFIX}${topicName}`;
}

/**
 * Parse an optional integer CLI flag. Returns the default when the flag is
 * absent, but throws when it is present yet not a valid integer — so a typo
 * like `--partitions 3x` fails loudly instead of silently parsing to 3 (as
 * parseInt would) or falling through to the default. `min` guards domain
 * constraints (e.g. Kafka requires at least 1 partition).
 * @param {string|undefined} raw raw flag value from parseArgs
 * @param {number} defaultValue value to use when the flag is omitted
 * @param {string} flagName flag name for the error message (without dashes)
 * @param {number} [min] minimum allowed value (inclusive)
 * @returns {number}
 */
function parseIntArg(raw, defaultValue, flagName, min = Number.NEGATIVE_INFINITY) {
    if (raw === undefined) {
        return defaultValue;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min) {
        throw new Error(
            `Invalid --${flagName} "${raw}": expected an integer${
                min > Number.NEGATIVE_INFINITY ? ` >= ${min}` : ''
            }`
        );
    }
    return parsed;
}

/**
 * Builds a connected admin client from a fresh KafkaClientV2.
 * Caller is responsible for calling disconnect() on the returned admin.
 * @param {ConfigManager} configManager
 * @returns {Promise<import('kafkajs').Admin>}
 */
async function connectAdmin(configManager) {
    const kafkaClientV2 = new KafkaClientV2({ configManager });
    const admin = kafkaClientV2.createAdminClient();
    await admin.connect();
    return admin;
}

/**
 * @param {ConfigManager} configManager
 * @param {string} topicName
 * @param {number} numPartitions
 * @param {number} retentionMs
 */
async function createKafkaTopic(
    configManager,
    topicName,
    numPartitions,
    retentionMs,
    maxMessageBytes = KAFKA_MAX_MESSAGE_BYTES
) {
    const admin = await connectAdmin(configManager);
    try {
        log.info('Creating Kafka topic', { topicName, numPartitions, retentionMs, maxMessageBytes });
        const created = await admin.createTopics({
            waitForLeaders: true,
            timeout: 30_000, // 30 seconds
            topics: [
                {
                    topic: topicName,
                    numPartitions,
                    configEntries: [
                        { name: 'retention.ms', value: retentionMs.toString() },
                        { name: 'max.message.bytes', value: maxMessageBytes.toString() }
                    ]
                }
            ]
        });

        if (created) {
            log.info('Topic created successfully', { topicName });
        } else {
            log.info('Topic already exists', { topicName });
        }
    } catch (err) {
        // Attach topic context to the failure before it bubbles to the outer
        // handler; rethrow so the process still exits non-zero.
        log.error('Failed to create Kafka topic', {
            topicName,
            numPartitions,
            retentionMs,
            error: err.message
        });
        throw err;
    } finally {
        await admin.disconnect();
    }
}

/**
 * Sets one or more topic-level configs (e.g. retention.ms, max.message.bytes) on an existing topic.
 *
 * kafkajs only supports the non-incremental AlterConfigs API, which replaces the
 * topic's full set of overrides — any override not sent is reset to the broker
 * default. So read the current topic-level overrides first and resend the ones not
 * being changed alongside the new values. Broker defaults are not resent, so they
 * are not pinned onto the topic.
 * @param {ConfigManager} configManager
 * @param {string} topicName
 * @param {Object<string, number|string>} configUpdates config name -> new value
 */
async function updateKafkaTopicConfig(configManager, topicName, configUpdates) {
    const updateNames = Object.keys(configUpdates);
    if (updateNames.length === 0) {
        throw new Error(`No config updates given for topic ${topicName}`);
    }
    const admin = await connectAdmin(configManager);
    try {
        const { resources } = await admin.describeConfigs({
            resources: [{ type: ConfigResourceTypes.TOPIC, name: topicName }],
            includeSynonyms: false
        });
        const overrides = resources[0].configEntries.filter(
            (e) => e.configSource === ConfigSource.TOPIC_CONFIG
        );
        const sensitive = overrides.find((e) => e.isSensitive);
        if (sensitive) {
            // Sensitive values come back null, so they can't be resent and would be wiped.
            throw new Error(
                `Topic ${topicName} has sensitive override ${sensitive.configName}; refusing to alter`
            );
        }
        const previousValues = Object.fromEntries(
            updateNames.map((name) => {
                const previous = overrides.find((e) => e.configName === name);
                return [name, previous ? previous.configValue : '(broker default)'];
            })
        );
        const configEntries = overrides
            .filter((e) => !updateNames.includes(e.configName))
            .map((e) => ({ name: e.configName, value: e.configValue }));
        for (const name of updateNames) {
            configEntries.push({ name, value: String(configUpdates[name]) });
        }

        log.info('Updating Kafka topic config', {
            topicName,
            previousValues,
            configUpdates,
            configEntries
        });
        await admin.alterConfigs({
            validateOnly: false,
            resources: [{ type: ConfigResourceTypes.TOPIC, name: topicName, configEntries }]
        });
        log.info('Topic config updated successfully', { topicName });
    } catch (err) {
        if (err && err.type === 'UNKNOWN_TOPIC_OR_PARTITION') {
            log.warn('Topic does not exist', { topicName });
            return;
        }
        log.error('Failed to update Kafka topic config', { topicName, error: err.message });
        throw err;
    } finally {
        await admin.disconnect();
    }
}

/**
 * Sets max.message.bytes on an existing topic, keeping its other overrides.
 * @param {ConfigManager} configManager
 * @param {string} topicName
 * @param {number} maxMessageBytes
 */
async function updateKafkaTopicMaxMessageBytes(configManager, topicName, maxMessageBytes) {
    await updateKafkaTopicConfig(configManager, topicName, { 'max.message.bytes': maxMessageBytes });
}

/**
 * Raises an existing topic's partition count. Kafka cannot remove partitions, so a target below
 * the current count is rejected, and an equal target is a no-op. Unlike describe/delete, a missing
 * topic is an error here: growing something that does not exist should fail the run, not pass.
 * Messages already in the topic stay on their partition; only new messages are keyed across the
 * larger set, so grow while the consumer group has nothing in flight, and restart its consumers
 * afterwards (see --grow above).
 *
 * The new count is confirmed by polling metadata: the controller applies CreatePartitions and
 * pushes the new metadata to the other brokers asynchronously, so a single read right after the
 * call can still return the old count even though the partitions were added.
 * @param {ConfigManager} configManager
 * @param {string} topicName
 * @param {number} targetPartitions
 * @param {Object} [options]
 * @param {number} [options.verifyAttempts] metadata reads before giving up on the new count
 * @param {number} [options.verifyDelayMs] delay between those reads
 */
async function growKafkaTopic(
    configManager,
    topicName,
    targetPartitions,
    { verifyAttempts = GROW_VERIFY_ATTEMPTS, verifyDelayMs = GROW_VERIFY_DELAY_MS } = {}
) {
    const admin = await connectAdmin(configManager);
    try {
        const countPartitions = async () => {
            const metadata = await admin.fetchTopicMetadata({ topics: [topicName] });
            const topic = metadata.topics.find((t) => t.name === topicName);
            return topic ? topic.partitions.length : 0;
        };

        const currentPartitions = await countPartitions();
        if (currentPartitions === 0) {
            throw new Error(`Topic ${topicName} has no partitions in metadata; refusing to grow`);
        }
        if (targetPartitions < currentPartitions) {
            throw new Error(
                `Cannot shrink ${topicName} from ${currentPartitions} to ${targetPartitions} partitions`
            );
        }
        if (targetPartitions === currentPartitions) {
            log.info('Topic already has the target partition count; nothing to do', {
                topicName,
                partitions: currentPartitions
            });
            return;
        }

        log.info('Growing Kafka topic', { topicName, currentPartitions, targetPartitions });
        await admin.createPartitions({
            timeout: 30_000, // 30 seconds
            topicPartitions: [{ topic: topicName, count: targetPartitions }]
        });

        let resultingPartitions = await countPartitions();
        for (let attempt = 1; resultingPartitions < targetPartitions && attempt < verifyAttempts; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, verifyDelayMs));
            resultingPartitions = await countPartitions();
        }
        if (resultingPartitions !== targetPartitions) {
            throw new Error(
                `Grew ${topicName} but metadata reports ${resultingPartitions} partitions, expected ${targetPartitions}`
            );
        }
        log.info('Topic grown successfully', {
            topicName,
            previousPartitions: currentPartitions,
            partitions: resultingPartitions
        });
        log.warn(
            'Restart the consumers of this topic before producing to it again: they do not pick up ' +
                'new partitions until they rejoin the group. A fromBeginning: false consumer also ' +
                'starts a new partition at its latest offset and skips earlier messages',
            { topicName }
        );
    } catch (err) {
        log.error('Failed to grow Kafka topic', { topicName, targetPartitions, error: err.message });
        throw err;
    } finally {
        await admin.disconnect();
    }
}

/**
 * @param {ConfigManager} configManager
 * @param {string} topicName
 */
// Topic configs reported by --describe.
const DESCRIBED_TOPIC_CONFIGS = ['retention.ms', 'max.message.bytes'];

/**
 * Reads the DESCRIBED_TOPIC_CONFIGS of a topic as { value, source } per config name, where source
 * is the kafkajs ConfigSource name (TOPIC_CONFIG for a topic override, DEFAULT_CONFIG and the
 * *_BROKER_CONFIG values for inherited ones). A failed read (e.g. the role lacks
 * DescribeTopicDynamicConfiguration) is logged and reported as { error } instead of failing the
 * describe, so the partition metadata is still reported.
 * @param {import('kafkajs').Admin} admin
 * @param {string} topicName
 * @returns {Promise<Object<string, {value?: string, source?: string, error?: string}>>}
 */
async function describeTopicConfigs(admin, topicName) {
    try {
        const { resources } = await admin.describeConfigs({
            resources: [{ type: ConfigResourceTypes.TOPIC, name: topicName, configNames: DESCRIBED_TOPIC_CONFIGS }],
            includeSynonyms: false
        });
        const entries = resources[0].configEntries;
        return Object.fromEntries(
            DESCRIBED_TOPIC_CONFIGS.map((name) => {
                const entry = entries.find((e) => e.configName === name);
                if (!entry) {
                    return [name, { value: undefined, source: undefined }];
                }
                const source = Object.keys(ConfigSource).find((key) => ConfigSource[key] === entry.configSource);
                return [name, { value: entry.configValue, source: source || String(entry.configSource) }];
            })
        );
    } catch (err) {
        log.warn('Could not read topic configs', { topicName, error: err.message });
        return Object.fromEntries(DESCRIBED_TOPIC_CONFIGS.map((name) => [name, { error: err.message }]));
    }
}

async function describeKafkaTopic(configManager, topicName) {
    const admin = await connectAdmin(configManager);
    try {
        log.info('Describing Kafka topic', { topicName });
        const metadata = await admin.fetchTopicMetadata({ topics: [topicName] });
        // kafkajs always returns the requested topic here (it throws
        // UNKNOWN_TOPIC_OR_PARTITION below when the topic is missing), so this
        // find never misses — but guard defensively rather than index blindly.
        const topic = metadata.topics.find((t) => t.name === topicName);
        const configs = await describeTopicConfigs(admin, topicName);

        log.info('Topic metadata', {
            topicName,
            retentionMs: configs['retention.ms'],
            maxMessageBytes: configs['max.message.bytes'],
            partitionCount: topic ? topic.partitions.length : 0,
            partitions: (topic ? topic.partitions : []).map((p) => ({
                partitionId: p.partitionId,
                leader: p.leader,
                replicas: p.replicas,
                isr: p.isr
            }))
        });
    } catch (err) {
        // fetchTopicMetadata throws (rather than returning an empty list) when
        // the topic does not exist — same signal deleteKafkaTopic handles.
        if (err && err.type === 'UNKNOWN_TOPIC_OR_PARTITION') {
            log.warn('Topic does not exist', { topicName });
            return;
        }
        throw err;
    } finally {
        await admin.disconnect();
    }
}

/**
 * @param {ConfigManager} configManager
 * @param {string} topicName
 */
async function deleteKafkaTopic(configManager, topicName) {
    const admin = await connectAdmin(configManager);
    try {
        log.info('Deleting Kafka topic', { topicName });
        await admin.deleteTopics({ topics: [topicName], timeout: 30_000 });
        log.info('Topic deleted successfully', { topicName });
    } catch (err) {
        if (err && err.type === 'UNKNOWN_TOPIC_OR_PARTITION') {
            log.warn('Topic does not exist', { topicName });
            return;
        }
        throw err;
    } finally {
        await admin.disconnect();
    }
}

async function main() {
    const { values } = parseArgs({
        options: {
            topic: { type: 'string' },
            describe: { type: 'boolean', default: false },
            delete: { type: 'boolean', default: false },
            update: { type: 'boolean', default: false },
            grow: { type: 'boolean', default: false },
            partitions: { type: 'string' },
            'retention-ms': { type: 'string' },
            'max-message-bytes': { type: 'string' }
        }
    });

    if (!values.topic) {
        log.error('--topic is required', {
            usage: 'node src/admin/scripts/manageKafkaV2Topic.js --topic <name> [--describe | --delete | --update | --grow] [--partitions N] [--retention-ms N] [--max-message-bytes N]'
        });
        process.exit(1);
    }
    const topicName = applyTopicPrefix(values.topic);

    // Kafka requires >= 1 partition. retention.ms allows -1 (infinite) and 0,
    // so it has no minimum beyond being an integer.
    const numPartitions = parseIntArg(values.partitions, KAFKA_PARTITION_COUNT, 'partitions', 1);
    const retentionMs = parseIntArg(values['retention-ms'], KAFKA_RETENTION_MS, 'retention-ms', -1);
    const maxMessageBytes = parseIntArg(
        values['max-message-bytes'],
        KAFKA_MAX_MESSAGE_BYTES,
        'max-message-bytes',
        1
    );

    if (values.grow && values.partitions === undefined) {
        log.error('--grow requires an explicit --partitions target', {
            usage: 'node src/admin/scripts/manageKafkaV2Topic.js --topic <name> --grow --partitions N'
        });
        process.exit(1);
    }

    const configManager = new ConfigManager();
    log.info('Script started', {
        brokers: configManager.kafkaV2Brokers,
        authType: configManager.kafkaV2AuthType || 'none',
        topicName
    });

    if (values.grow) {
        await growKafkaTopic(configManager, topicName, numPartitions);
    } else if (values.delete) {
        await deleteKafkaTopic(configManager, topicName);
    } else if (values.describe) {
        await describeKafkaTopic(configManager, topicName);
    } else if (values.update) {
        // Only change the configs the caller passed. With neither flag, keep the
        // original behaviour of resetting max.message.bytes to its default.
        const configUpdates = {};
        if (values['retention-ms'] !== undefined) {
            configUpdates['retention.ms'] = retentionMs;
        }
        if (values['max-message-bytes'] !== undefined || values['retention-ms'] === undefined) {
            configUpdates['max.message.bytes'] = maxMessageBytes;
        }
        await updateKafkaTopicConfig(configManager, topicName, configUpdates);
    } else {
        await createKafkaTopic(configManager, topicName, numPartitions, retentionMs, maxMessageBytes);
    }
}

// Only auto-run when invoked directly (node src/admin/scripts/manageKafkaV2Topic.js),
// not when imported by tests.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            // Log message/stack explicitly: a bare Error serializes to {} in the
            // JSON logger because its fields are non-enumerable, which would hide
            // the reason (e.g. the --partitions validation message).
            log.error('Kafka topic script failed', { error: error.message, stack: error.stack });
            process.exit(1);
        });
}

module.exports = {
    createKafkaTopic,
    describeKafkaTopic,
    growKafkaTopic,
    deleteKafkaTopic,
    updateKafkaTopicMaxMessageBytes,
    updateKafkaTopicConfig,
    parseIntArg,
    applyTopicPrefix,
    main,
    TOPIC_PREFIX,
    KAFKA_PARTITION_COUNT,
    KAFKA_RETENTION_MS,
    KAFKA_MAX_MESSAGE_BYTES
};
