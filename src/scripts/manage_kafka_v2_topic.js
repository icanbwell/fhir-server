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
 *   node src/scripts/manage_kafka_v2_topic.js --topic <name> [--describe | --delete]
 *
 * All topics are namespaced under the `fhir_server.` prefix. You may pass the
 * short name (`auditevents`) or the fully-qualified name
 * (`fhir_server.auditevents`) — both resolve to `fhir_server.auditevents`.
 *
 * Options:
 *   --topic       (required) topic name to manage (prefixed with fhir_server.)
 *   --describe     describe the topic's partition metadata instead of creating
 *   --delete       delete the topic instead of creating
 *   --partitions   number of partitions when creating (default: 30)
 *   --retention-ms retention period in ms when creating (default: 7 days)
 *
 * Examples:
 *   node src/scripts/manage_kafka_v2_topic.js --topic auditevents            # fhir_server.auditevents
 *   node src/scripts/manage_kafka_v2_topic.js --topic auditevents --describe
 *   node src/scripts/manage_kafka_v2_topic.js --topic auditevents --delete
 */

const { parseArgs } = require('node:util');

const { KafkaClientV2 } = require('../utils/kafkaClientV2');
const { ConfigManager } = require('../utils/configManager');
const { logInfo, logError, logWarn } = require('../operations/common/logging');

// Prefix every log line so this script's output is easy to grep out of the
// shared server logs (mirrors the reference's logger.child({ script })).
const LOG_PREFIX = '[manage_kafka_v2_topic]';
const log = {
    info: (message, args) => logInfo(`${LOG_PREFIX} ${message}`, args),
    warn: (message, args) => logWarn(`${LOG_PREFIX} ${message}`, args),
    error: (message, args) => logError(`${LOG_PREFIX} ${message}`, args)
};

const KAFKA_PARTITION_COUNT = 30;
const KAFKA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KAFKA_MAX_MESSAGE_BYTES = 2 * 1024 * 1024; // 2mb

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
async function createKafkaTopic(configManager, topicName, numPartitions, retentionMs) {
    const admin = await connectAdmin(configManager);
    try {
        log.info('Creating Kafka topic', { topicName, numPartitions, retentionMs });
        const created = await admin.createTopics({
            waitForLeaders: true,
            timeout: 30_000, // 30 seconds
            topics: [
                {
                    topic: topicName,
                    numPartitions,
                    configEntries: [
                        { name: 'retention.ms', value: retentionMs.toString() },
                        { name: 'max.message.bytes', value: KAFKA_MAX_MESSAGE_BYTES.toString() }
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
 * @param {ConfigManager} configManager
 * @param {string} topicName
 */
async function describeKafkaTopic(configManager, topicName) {
    const admin = await connectAdmin(configManager);
    try {
        log.info('Describing Kafka topic', { topicName });
        const metadata = await admin.fetchTopicMetadata({ topics: [topicName] });
        // kafkajs always returns the requested topic here (it throws
        // UNKNOWN_TOPIC_OR_PARTITION below when the topic is missing), so this
        // find never misses — but guard defensively rather than index blindly.
        const topic = metadata.topics.find((t) => t.name === topicName);

        log.info('Topic metadata', {
            topicName,
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
            partitions: { type: 'string' },
            'retention-ms': { type: 'string' }
        }
    });

    if (!values.topic) {
        log.error('--topic is required', {
            usage: 'node src/scripts/manage_kafka_v2_topic.js --topic <name> [--describe | --delete] [--partitions N]'
        });
        process.exit(1);
    }
    const topicName = applyTopicPrefix(values.topic);

    // Kafka requires >= 1 partition. retention.ms allows -1 (infinite) and 0,
    // so it has no minimum beyond being an integer.
    const numPartitions = parseIntArg(values.partitions, KAFKA_PARTITION_COUNT, 'partitions', 1);
    const retentionMs = parseIntArg(values['retention-ms'], KAFKA_RETENTION_MS, 'retention-ms', -1);

    const configManager = new ConfigManager();
    log.info('Script started', {
        brokers: configManager.kafkaV2Brokers,
        authType: configManager.kafkaV2AuthType || 'none',
        topicName
    });

    if (values.delete) {
        await deleteKafkaTopic(configManager, topicName);
    } else if (values.describe) {
        await describeKafkaTopic(configManager, topicName);
    } else {
        await createKafkaTopic(configManager, topicName, numPartitions, retentionMs);
    }
}

// Only auto-run when invoked directly (node src/scripts/manage_kafka_v2_topic.js),
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
    deleteKafkaTopic,
    parseIntArg,
    applyTopicPrefix,
    main,
    TOPIC_PREFIX,
    KAFKA_PARTITION_COUNT,
    KAFKA_RETENTION_MS,
    KAFKA_MAX_MESSAGE_BYTES
};
