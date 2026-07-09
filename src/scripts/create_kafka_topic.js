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
 *   node src/scripts/create_kafka_topic.js --topic <name> [--describe | --delete]
 *
 * Options:
 *   --topic       (required) topic name to manage
 *   --describe     describe the topic's partition metadata instead of creating
 *   --delete       delete the topic instead of creating
 *   --partitions   number of partitions when creating (default: 30)
 *   --retention-ms retention period in ms when creating (default: 7 days)
 *
 * Examples:
 *   node src/scripts/create_kafka_topic.js --topic fhir.resource.changes
 *   node src/scripts/create_kafka_topic.js --topic fhir.resource.changes --describe
 *   node src/scripts/create_kafka_topic.js --topic fhir.resource.changes --delete
 */

const { parseArgs } = require('node:util');

const { KafkaClientV2 } = require('../utils/kafkaClientV2');
const { ConfigManager } = require('../utils/configManager');
const { logInfo, logError, logWarn } = require('../operations/common/logging');

// Prefix every log line so this script's output is easy to grep out of the
// shared server logs (mirrors the reference's logger.child({ script })).
const LOG_PREFIX = '[create_kafka_topic]';
const log = {
    info: (message, args) => logInfo(`${LOG_PREFIX} ${message}`, args),
    warn: (message, args) => logWarn(`${LOG_PREFIX} ${message}`, args),
    error: (message, args) => logError(`${LOG_PREFIX} ${message}`, args)
};

const KAFKA_PARTITION_COUNT = 30;
const KAFKA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KAFKA_MAX_MESSAGE_BYTES = 2 * 1024 * 1024; // 2mb

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
        const topic = metadata.topics.find((t) => t.name === topicName);

        if (!topic) {
            log.warn('Topic does not exist', { topicName });
            return;
        }

        log.info('Topic metadata', {
            topicName,
            partitionCount: topic.partitions.length,
            partitions: topic.partitions.map((p) => ({
                partitionId: p.partitionId,
                leader: p.leader,
                replicas: p.replicas,
                isr: p.isr
            }))
        });
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

    const topicName = values.topic;
    if (!topicName) {
        log.error('--topic is required', {
            usage: 'node src/scripts/create_kafka_topic.js --topic <name> [--describe | --delete] [--partitions N]'
        });
        process.exit(1);
    }

    const numPartitions = parseInt(values.partitions, 10) || KAFKA_PARTITION_COUNT;
    const retentionMs = parseInt(values['retention-ms'], 10) || KAFKA_RETENTION_MS;

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

// Only auto-run when invoked directly (node src/scripts/create_kafka_topic.js),
// not when imported by tests.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            log.error('Kafka topic script failed', { error });
            process.exit(1);
        });
}

module.exports = {
    createKafkaTopic,
    describeKafkaTopic,
    deleteKafkaTopic,
    main,
    KAFKA_PARTITION_COUNT,
    KAFKA_RETENTION_MS,
    KAFKA_MAX_MESSAGE_BYTES
};
