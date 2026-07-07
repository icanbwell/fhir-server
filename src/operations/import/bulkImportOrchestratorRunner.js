const { S3Client: S3, HeadObjectCommand } = require('@aws-sdk/client-s3');
const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { KafkaClientV2 } = require('../../utils/kafkaClientV2');
const { BulkImportEventProducer } = require('./bulkImportEventProducer');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const { logInfo, logError } = require('../common/logging');

class BulkImportOrchestratorRunner {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     * @property {KafkaClientV2} kafkaClientV2
     * @property {BulkImportEventProducer} bulkImportEventProducer
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     *
     * @param {ConstructorParams}
     */
    constructor({ configManager, kafkaClientV2, bulkImportEventProducer, databaseQueryFactory, databaseUpdateFactory }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.kafkaClientV2 = kafkaClientV2;
        assertTypeEquals(kafkaClientV2, KafkaClientV2);

        this.bulkImportEventProducer = bulkImportEventProducer;
        assertTypeEquals(bulkImportEventProducer, BulkImportEventProducer);

        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);
    }

    /**
     * Parses a TaskCreated CloudEvent message
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseCloudEvent(messageValue) {
        const envelope = JSON.parse(messageValue);
        if (envelope.type !== 'TaskCreated') {
            throw new Error(`Unexpected event type: ${envelope.type}`);
        }
        if (!envelope.data || !envelope.data.taskId) {
            throw new Error('Invalid TaskCreated event: missing taskId');
        }
        return envelope.data;
    }

    /**
     * Loads the Task resource by ID
     * @param {string} taskId
     * @returns {Promise<Object|null>}
     */
    async loadTaskAsync(taskId) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        return databaseQueryManager.findOneAsync({
            query: { id: taskId }
        });
    }

    /**
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @returns {Promise<void>}
     */
    async updateTaskStatusAsync(task, status, statusReason) {
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        const updated = task.clone();
        updated.status = status;
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        if (statusReason) {
            if (!updated.statusReason) {
                updated.statusReason = {};
            }
            updated.statusReason.text = statusReason;
        }

        await databaseUpdateManager.updateOneAsync({ doc: updated });
    }

    /**
     * HEADs each S3 file to get file sizes and validate they exist
     * @param {Array<{ url: string }>} inputs
     * @returns {Promise<Array<{ url: string, fileSize: number }>>}
     */
    async headS3FilesAsync(inputs) {
        const region = this.configManager.awsRegion || 'us-east-1';
        const s3 = new S3({ region });
        const minBytes = this.configManager.bulkImportMinFileSizeMb * 1024 * 1024;
        const maxBytes = this.configManager.bulkImportMaxFileSizeGb * 1024 * 1024 * 1024;

        const results = [];
        for (const input of inputs) {
            const match = input.url.match(/^s3:\/\/([^/]+)\/(.+)$/);
            if (!match) {
                throw new Error(`Invalid S3 URI: "${input.url}"`);
            }
            const bucket = match[1];
            const key = match[2];

            let fileSize;
            try {
                const response = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                fileSize = response.ContentLength;
            } catch (e) {
                throw new Error(`Cannot access S3 file "${input.url}": ${e.name}: ${e.message}`);
            }

            if (fileSize < minBytes) {
                throw new Error(
                    `File "${input.url}" is ${(fileSize / (1024 * 1024)).toFixed(1)} MB, ` +
                    `below the minimum of ${this.configManager.bulkImportMinFileSizeMb} MB`
                );
            }
            if (fileSize > maxBytes) {
                throw new Error(
                    `File "${input.url}" is ${(fileSize / (1024 * 1024 * 1024)).toFixed(1)} GB, ` +
                    `above the maximum of ${this.configManager.bulkImportMaxFileSizeGb} GB`
                );
            }

            results.push({ url: input.url, fileSize });
        }
        return results;
    }

    /**
     * Handles a single TaskCreated Kafka message:
     * HEADs S3 files for sizes, then publishes byte-range messages
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleMessageAsync(message) {
        let eventData;
        try {
            eventData = this.parseCloudEvent(message.value);
        } catch (e) {
            logError('Failed to parse TaskCreated Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const { taskId, inputs, requestId, scope, user } = eventData;

        logInfo('Orchestrator received TaskCreated event', { taskId, inputCount: inputs.length });

        const task = await this.loadTaskAsync(taskId);
        if (!task) {
            logError('Task not found for orchestrator message', { taskId });
            return;
        }

        let inputsWithSizes;
        try {
            inputsWithSizes = await this.headS3FilesAsync(inputs);
        } catch (e) {
            logError('S3 validation failed for import task', { taskId, error: e.message });
            await this.updateTaskStatusAsync(task, 'failed', e.message);
            return;
        }

        const messageCount = await this.bulkImportEventProducer.publishImportEventsAsync({
            taskId,
            inputs: inputsWithSizes,
            requestId,
            scope,
            user
        });

        logInfo('Orchestrator published byte-range messages', {
            taskId,
            messageCount
        });
    }
}

module.exports = { BulkImportOrchestratorRunner };
